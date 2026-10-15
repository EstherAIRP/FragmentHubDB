import { MongoError, MongoServerError, type ClientSession, type Collection } from "mongodb";

import type { Fragment } from "@/lib/fragment-schema";
import { formatFragmentId, nextFragmentId, parseFragmentId } from "@/lib/fragments/id";
import { nextUpdatedAt } from "@/lib/fragments/versioning";
import type { NewFragment } from "@/lib/fragments/local-store";
import {
  assertFragmentSemantics,
  FragmentDataValidationError,
} from "@/lib/fragments/semantic-validator";
import {
  planStatusBatch,
  type StatusBatchChange,
  type StatusBatchOutcome,
} from "@/lib/fragments/status-batch";
import {
  getMongoFragmentCollection,
} from "@/lib/mongodb/client";
import { parseMongoDocument, type MongoFragmentDocument } from "@/lib/mongodb/document";
import { withMongoFragmentWrite, type WriteEpoch } from "@/lib/mongodb/write-transaction";

export class MongoFragmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoFragmentConflictError";
  }
}

export async function listMongoFragments(): Promise<Fragment[]> {
  const collection = await getMongoFragmentCollection();
  const records = await collection.find({}).sort({ updated_at: -1, _id: 1 }).toArray();
  return records.map(parseMongoDocument);
}

export async function getMongoFragment(id: string): Promise<Fragment | null> {
  const collection = await getMongoFragmentCollection();
  const record = await collection.findOne({ _id: id });
  return record ? parseMongoDocument(record) : null;
}

/**
 * Shared canonical insertion: both human-confirmed Web and ChatGPT proposals
 * use this exact allocation + reference validation under the write epoch.
 */
export async function insertMongoFragmentInTransaction(
  input: NewFragment,
  collection: Collection<MongoFragmentDocument>,
  session: ClientSession,
  epoch: Collection<WriteEpoch>,
): Promise<Fragment> {
  const current = (await collection.find({}, { session }).toArray()).map(parseMongoDocument);
  const metadata = await epoch.findOne({ _id: "fragments" }, { session });
  const knownIds = current.map((fragment) => fragment.id);
  if (metadata?.highest_allocated !== undefined) {
    knownIds.push(formatFragmentId(metadata.highest_allocated));
  }
  const id = nextFragmentId(knownIds);
  const now = new Date().toISOString();
  const candidate = assertFragmentSemantics({
    ...input,
    id,
    created_at: now,
    updated_at: now,
  }, current);

  await epoch.updateOne(
    { _id: "fragments" },
    { $max: { highest_allocated: parseFragmentId(id) } },
    { session },
  );
  await collection.insertOne({ ...candidate, _id: id }, { session });
  return candidate;
}

/**
 * All writers acquire one database-wide transaction epoch before reading
 * references. This prevents concurrent changes from invalidating a snapshot.
 */
export async function createMongoFragment(input: NewFragment): Promise<Fragment> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await withMongoFragmentWrite((collection, session, epoch) =>
        insertMongoFragmentInTransaction(input, collection, session, epoch),
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) continue;
      throw error;
    }
  }
  throw new MongoFragmentConflictError(
    "Could not allocate a unique Fragment ID after 10 attempts.",
  );
}

/**
 * Optimistic concurrency and relationship validation share a transaction.
 * A stale expected_updated_at results in a 409, not a silent last-write-win.
 */
export async function replaceMongoFragment(
  id: string,
  replacement: Fragment,
  expectedUpdatedAt: string,
): Promise<Fragment> {
  return withMongoFragmentWrite(async (collection, session) => {
    const documents = await collection.find({}, { session }).toArray();
    const all = documents.map(parseMongoDocument);
    const current = all.find((fragment) => fragment.id === id);
    if (!current) throw new Error("Fragment does not exist.");

    if (current.updated_at !== expectedUpdatedAt) {
      throw new MongoFragmentConflictError("Fragment changed since it was loaded.");
    }

    const candidate = assertFragmentSemantics({
      ...replacement,
      id: current.id,
      created_at: current.created_at,
      updated_at: nextUpdatedAt([current.updated_at]),
    }, all.filter((fragment) => fragment.id !== id), { previous: current });

    if (current.type === "project" && candidate.type !== "project") {
      const children = all.filter((fragment) =>
        fragment.id !== id && fragment.project === id,
      );
      if (children.length > 0) {
        throw new FragmentDataValidationError(children.map((fragment) => ({
          code: "project_has_children",
          path: fragment.id,
          message: "Fragment " + fragment.id + " still uses " + id + " as its project.",
        })));
      }
    }

    const result = await collection.replaceOne(
      { _id: id, updated_at: expectedUpdatedAt },
      candidate,
      { session },
    );
    if (result.matchedCount !== 1) {
      throw new MongoFragmentConflictError("Fragment changed while saving.");
    }
    return candidate;
  });
}

/** Low-level primitive; the product must request explicit deletion separately. */
export async function deleteMongoFragment(
  id: string,
  expectedUpdatedAt: string,
): Promise<void> {
  await withMongoFragmentWrite(async (collection, session, epoch) => {
    const documents = await collection.find({}, { session }).toArray();
    const all = documents.map(parseMongoDocument);
    const current = all.find((fragment) => fragment.id === id);
    if (!current) throw new Error("Fragment does not exist.");
    if (current.updated_at !== expectedUpdatedAt) {
      throw new MongoFragmentConflictError("Fragment changed since it was loaded.");
    }

    const inbound = all.filter(
      (item) =>
        item.id !== id && (item.project === id || item.related.includes(id)),
    );
    if (inbound.length > 0) {
      throw new FragmentDataValidationError(
        inbound.map((item) => ({
          code: "inbound_reference",
          path: item.id,
          message: "Fragment " + item.id + " still references " + id + ".",
        })),
      );
    }

    // Preserve high-water IDs even after deleting the largest/current item.
    await epoch.updateOne(
      { _id: "fragments" },
      { $max: { highest_allocated: parseFragmentId(id) } },
      { session },
    );
    const result = await collection.deleteOne(
      { _id: id, updated_at: expectedUpdatedAt },
      { session },
    );
    if (result.deletedCount !== 1) {
      throw new MongoFragmentConflictError("Fragment changed while deleting.");
    }
  });
}

/**
 * All selected kanban moves commit as one MongoDB transaction. The write
 * epoch makes these atomic moves serializable with create, edit and delete.
 */
export async function applyMongoStatusBatch(
  changes: readonly StatusBatchChange[],
): Promise<StatusBatchOutcome> {
  try {
    return await withMongoFragmentWrite<StatusBatchOutcome>(async (collection, session) => {
      const documents = await collection.find({}, { session }).toArray();
      const snapshot = documents.map(parseMongoDocument);
      const byId = new Map(snapshot.map((item) => [item.id, item]));
      const time = nextUpdatedAt(
        changes.flatMap((change) => {
          const previous = byId.get(change.id);
          return previous ? [previous.updated_at] : [];
        }),
      );
      const plan = planStatusBatch(changes, snapshot, time);

      if (plan.kind === "conflict") {
        return { kind: "conflict", conflicts: plan.conflicts, reason: "stale" };
      }
      if (plan.kind !== "ready") return plan;

      for (const write of plan.writes) {
        const previous = byId.get(write.id)!;
        const result = await collection.replaceOne(
          { _id: write.id, updated_at: previous.updated_at },
          write.fragment,
          { session },
        );
        if (result.matchedCount !== 1) {
          throw new MongoFragmentConflictError("Concurrent status change.");
        }
      }

      return {
        kind: "committed",
        commit: "mongodb-transaction",
        fragments: plan.results,
      };
    });
  } catch (error) {
    if (
      error instanceof MongoFragmentConflictError ||
      (error instanceof MongoError &&
        error.hasErrorLabel("TransientTransactionError"))
    ) {
      return { kind: "conflict", conflicts: [], reason: "branch_moved" };
    }
    throw error;
  }
}
