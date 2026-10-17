import { randomBytes } from "node:crypto";

import { MongoServerError, type MongoClient } from "mongodb";

/**
 * A deliberate, narrow permission test. This is NOT a Fragment write.
 * Never run against production, CI's canonical fixture DB or an implicit DB.
 */
export function assertMongoWriteProbeTarget(
  backend: string | undefined,
  configuredDatabase: string | undefined,
): "fragmenthubdb_test" {
  if (backend !== "mongodb" || configuredDatabase !== "fragmenthubdb_test") {
    throw new Error(
      "Refusing MongoDB write test: explicitly set " +
      "FragmentHubDB_DATA_STORE=mongodb and " +
      "FragmentHubDB_MONGODB_DATABASE=fragmenthubdb_test.",
    );
  }
  return configuredDatabase;
}

export type MongoWriteProbeResult = {
  transactionCommit: true;
  transactionRollback: true;
  cleanup: true;
};

/**
 * Create a cryptographically unique throwaway COLLECTION so cleanup cannot
 * delete someone else's documents. Commit one document, read it from outside
 * the session, abort a second transaction, verify rollback, then drop ONLY
 * the uniquely generated probe collection. Neither `fragments`, `metadata`,
 * nor `chatgpt_proposals` is ever accessed by this probe.
 *
 * If the process is killed or MongoDB becomes unavailable, a temporary
 * probe collection might remain. Never blanket-delete prefixed collections.
 */
export async function runMongoWriteProbe(
  client: MongoClient,
  backend: string | undefined,
  configuredDatabase: string | undefined,
): Promise<MongoWriteProbeResult> {
  const database = assertMongoWriteProbeTarget(backend, configuredDatabase);
  const db = client.db(database);
  const collectionName = "fragmenthubdb_write_probe_" +
    randomBytes(16).toString("hex");
  const collection = db.collection<{
    _id: string;
    purpose: "fragmenthubdb_doctor_only";
  }>(collectionName);
  const marker = randomBytes(16).toString("hex");
  const session = client.startSession();

  let completed = false;
  let operationError: unknown;
  let cleanupError: unknown;
  let cleanupCompleted = false;

  try {
    await session.withTransaction(async () => {
      await collection.insertOne(
        { _id: marker, purpose: "fragmenthubdb_doctor_only" },
        { session },
      );
      const inside = await collection.findOne({ _id: marker }, { session });
      if (inside?.purpose !== "fragmenthubdb_doctor_only") {
        throw new Error("Write probe: transactional readback failed.");
      }
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    // The first transaction must be visible to a new read after commit.
    const committed = await collection.findOne({ _id: marker });
    if (committed?.purpose !== "fragmenthubdb_doctor_only") {
      throw new Error("Write probe: committed document is not readable.");
    }

    const abortedMarker = randomBytes(16).toString("hex");
    const intentionalRollback = new Error("intentional doctor transaction rollback");
    try {
      await session.withTransaction(async () => {
        await collection.insertOne(
          { _id: abortedMarker, purpose: "fragmenthubdb_doctor_only" },
          { session },
        );
        throw intentionalRollback;
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
      throw new Error("Write probe: rollback was not triggered.");
    } catch (error) {
      if (error !== intentionalRollback) throw error;
    }

    if (await collection.findOne({ _id: abortedMarker })) {
      throw new Error("Write probe: transaction rollback left a document.");
    }
    if ((await collection.countDocuments()) !== 1) {
      throw new Error("Write probe: unexpected document count.");
    }
    completed = true;
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await session.endSession();
    } catch (error) {
      cleanupError = error;
    }

    // Never drop a shared collection, and never drop any other database.
    try {
      await collection.drop();
      cleanupCompleted = true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 26) {
        // Transaction failed before MongoDB created the probe collection.
        cleanupCompleted = true;
      } else {
        cleanupError = error;
      }
    }
  }

  if (!cleanupCompleted || cleanupError) {
    throw new Error("Write probe cleanup failed. Check the isolated test database.");
  }
  if (operationError) throw operationError;
  if (!completed) throw new Error("Write probe did not finish.");
  return {
    transactionCommit: true,
    transactionRollback: true,
    cleanup: true,
  };
}
