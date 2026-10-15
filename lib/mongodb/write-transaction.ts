import type { ClientSession, Collection } from "mongodb";

import { getMongoClient } from "@/lib/mongodb/client";
import { fragmentHubDbDatabaseName } from "@/lib/mongodb/database-name";
import type { MongoFragmentDocument } from "@/lib/mongodb/document";

export type WriteEpoch = { _id: "fragments"; version: number; highest_allocated?: number };

/**
 * Serialize Fragment mutations across serverless instances.
 *
 * A transaction snapshot alone permits write skew: another transaction can
 * create a child referencing a project while this one deletes that project.
 * Every participating writer first increments the same metadata document
 * inside its transaction, so concurrent writers conflict and are retried
 * against a fresh snapshot by withTransaction().
 *
 * The migration script is intentionally offline-only; writes must be frozen
 * while importing. Direct MongoDB tools bypass this safety mechanism.
 */
export async function withMongoFragmentWrite<T>(
  execute: (
    collection: Collection<MongoFragmentDocument>,
    session: ClientSession,
    epoch: Collection<WriteEpoch>,
  ) => Promise<T>,
): Promise<T> {
  const client = await getMongoClient();
  const database = client.db(
    fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE),
  );
  const collection = database.collection<MongoFragmentDocument>("fragments");
  const epoch = database.collection<WriteEpoch>("metadata");
  const session = client.startSession();

  try {
    const result = await session.withTransaction<T>(async () => {
      await epoch.updateOne(
        { _id: "fragments" },
        { $inc: { version: 1 } },
        { upsert: true, session },
      );
      return execute(collection, session, epoch);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    // Void mutations (such as deletion) legitimately return undefined.
    // The driver throws on an unsuccessful transaction.
    return result as T;
  } finally {
    await session.endSession();
  }
}
