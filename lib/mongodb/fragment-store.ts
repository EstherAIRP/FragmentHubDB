import { MongoError, MongoServerError } from "mongodb";

import type { Fragment } from "@/lib/fragment-schema";
import { parseMongoDocument } from "@/lib/mongodb/document";
import { nextFragmentId } from "@/lib/fragments/id";
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
  getMongoClient,
  getMongoFragmentCollection,
} from "@/lib/mongodb/client";

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
 * Unique _id makes allocation safe even when requests race.
 * As in the original file store, a collision causes a fresh allocation.
 */
export async function createMongoFragment(input: NewFragment): Promise<Fragment> {
  const collection = await getMongoFragmentCollection();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await listMongoFragments();
    const id = nextFragmentId(current.map((item) => item.id));
    const now = new Date().toISOString();
    const candidate = assertFragmentSemantics({
      ...input,
      id,
      created_at: now,
      updated_at: now,
    }, current);

    try {
      await collection.insertOne({ ...candidate, _id: candidate.id });
      return candidate;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique Fragment ID after 10 attempts.");
}

/**
 * Only replaces when updated_at still equals the value last seen by the user.
 * The database filter is the concurrency check, not a preceding read.
 */
export async function replaceMongoFragment(
  id: string,
  replacement: Fragment,
  expectedUpdatedAt: string,
): Promise<Fragment> {
  const collection = await getMongoFragmentCollection();
  const current = await getMongoFragment(id);
  if (!current) throw new Error("Fragment does not exist.");

  if (current.updated_at !== expectedUpdatedAt) {
    throw new MongoFragmentConflictError("Fragment changed since it was loaded.");
  }

  const all = await listMongoFragments();
  const changedAt = nextUpdatedAt([current.updated_at]);
  const candidate = assertFragmentSemantics({
    ...replacement,
    id: current.id,
    created_at: current.created_at,
    updated_at: changedAt,
  }, all.filter((fragment) => fragment.id !== id), { previous: current });

  if (current.type === "project" && candidate.type !== "project") {
    const children = all.filter((item) => item.id !== id && item.project === id);
    if (children.length) {
      throw new FragmentDataValidationError(
        children.map((item) => ({
          code: "project_has_children",
          path: item.id,
          message: "Fragment " + item.id + " still uses " + id + " as its project.",
        })),
      );
    }
  }

  const result = await collection.replaceOne(
    { _id: id, updated_at: expectedUpdatedAt },
    { ...candidate, _id: id },
  );
  if (result.matchedCount !== 1) {
    throw new MongoFragmentConflictError("Fragment changed while saving.");
  }
  return candidate;
}

/** Low-level primitive; the product must request explicit deletion separately. */
export async function deleteMongoFragment(
  id: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const collection = await getMongoFragmentCollection();
  const all = await listMongoFragments();
  const current = all.find((item) => item.id === id);
  if (!current) throw new Error("Fragment does not exist.");
  if (current.updated_at !== expectedUpdatedAt) {
    throw new MongoFragmentConflictError("Fragment changed since it was loaded.");
  }

  const inbound = all.filter(
    (item) =>
      item.id !== id && (item.project === id || item.related.includes(id)),
  );
  if (inbound.length) {
    throw new FragmentDataValidationError(
      inbound.map((item) => ({
        code: "inbound_reference",
        path: item.id,
        message: "Fragment " + item.id + " still references " + id + ".",
      })),
    );
  }

  const result = await collection.deleteOne({ _id: id, updated_at: expectedUpdatedAt });
  if (result.deletedCount !== 1) {
    throw new MongoFragmentConflictError("Fragment changed while deleting.");
  }
}

/**
 * One atomic Atlas transaction for all selected kanban status changes.
 * The shared planner preserves validation, missing/conflict/noop semantics.
 */
export async function applyMongoStatusBatch(
  changes: readonly StatusBatchChange[],
): Promise<StatusBatchOutcome> {
  const client = await getMongoClient();
  const collection = await getMongoFragmentCollection();
  const session = client.startSession();

  try {
    const outcome = await session.withTransaction<StatusBatchOutcome>(async () => {
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
          { ...write.fragment, _id: write.id },
          { session },
        );
        if (result.matchedCount !== 1) {
          throw new MongoFragmentConflictError("Concurrent status change.");
        }
      }

      // No Git commit is created by a MongoDB transaction.
      return {
        kind: "committed",
        commit: "mongodb-transaction",
        fragments: plan.results,
      };
    });

    if (!outcome) throw new Error("MongoDB transaction returned no outcome.");
    return outcome;
  } catch (error) {
    if (
      error instanceof MongoFragmentConflictError ||
      (error instanceof MongoError &&
        error.hasErrorLabel("TransientTransactionError"))
    ) {
      return { kind: "conflict", conflicts: [], reason: "branch_moved" };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
