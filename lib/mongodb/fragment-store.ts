import { MongoServerError } from "mongodb";

import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";
import { nextFragmentId } from "@/lib/fragments/id";
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
  type MongoFragmentDocument,
} from "@/lib/mongodb/client";

export class MongoFragmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoFragmentConflictError";
  }
}

function parseDocument(document: MongoFragmentDocument): Fragment {
  const { _id, ...raw } = document;
  const fragment = fragmentSchema.parse(raw);
  if (fragment.id !== _id) {
    throw new Error("MongoDB Fragment _id does not match the stored id.");
  }
  return fragment;
}

export async function listMongoFragments(): Promise<Fragment[]> {
  const collection = await getMongoFragmentCollection();
  const records = await collection.find({}).sort({ updated_at: -1, _id: 1 }).toArray();
  return records.map(parseDocument);
}

export async function getMongoFragment(id: string): Promise<Fragment | null> {
  const collection = await getMongoFragmentCollection();
  const record = await collection.findOne({ _id: id });
  return record ? parseDocument(record) : null;
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
    const candidate = fragmentSchema.parse({
      ...input,
      id,
      created_at: now,
      updated_at: now,
    });
    assertFragmentSemantics(candidate, current);

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
  const changedAt = new Date(
    Math.max(Date.now(), Date.parse(current.updated_at) + 1),
  ).toISOString();
  const candidate = fragmentSchema.parse({
    ...replacement,
    id: current.id,
    created_at: current.created_at,
    updated_at: changedAt,
  });
  assertFragmentSemantics(
    candidate,
    all.filter((fragment) => fragment.id !== id),
    { previous: current },
  );

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
      const snapshot = documents.map(parseDocument);
      const time = new Date(
        Math.max(Date.now(), ...snapshot.map((item) => Date.parse(item.updated_at) + 1)),
      ).toISOString();
      const plan = planStatusBatch(changes, snapshot, time);

      if (plan.kind === "conflict") {
        return { kind: "conflict", conflicts: plan.conflicts, reason: "stale" };
      }
      if (plan.kind !== "ready") return plan;

      const byId = new Map(snapshot.map((item) => [item.id, item]));
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
      (error instanceof MongoServerError &&
        error.hasErrorLabel("TransientTransactionError"))
    ) {
      return { kind: "conflict", conflicts: [], reason: "branch_moved" };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
