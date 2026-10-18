import type { Db } from "mongodb";
import { directWriteCollectionOptions } from "@/lib/mongodb/collection-validator";

export type BootstrapMode = "dry-run" | "inspect" | "apply";
export const CI_DB = "fragmenthubdb_bootstrap_ci";
export const TEST_DB = "fragmenthubdb_test";

export type BootstrapTarget = {
  mode: BootstrapMode;
  database: string;
  uri: string;
  ci?: string;
  expectedHost?: string;
  confirmedDatabase?: string;
  acknowledgedEmpty?: boolean;
};

export function assertBootstrapTarget(target: BootstrapTarget): void {
  if (target.mode === "dry-run") return;
  if (target.database === CI_DB) {
    if (target.ci !== "true" ||
      !/^mongodb:\/\/127\.0\.0\.1:27017(?:\/|\?)/.test(target.uri)) {
      throw new Error("BOOTSTRAP_CI_TARGET_REQUIRED");
    }
  } else if (target.database === TEST_DB) {
    if (target.ci === "true") throw new Error("BOOTSTRAP_ATLAS_FORBIDDEN_IN_CI");
    let host = "";
    try {
      if (target.uri.startsWith("mongodb+srv://")) {
        host = new URL(target.uri).hostname.toLowerCase();
      }
    } catch { /* never echo a credential-bearing URI */ }
    if (!host.endsWith(".mongodb.net") ||
        !target.expectedHost ||
        host !== target.expectedHost.toLowerCase()) {
      throw new Error("BOOTSTRAP_ATLAS_HOST_CONFIRMATION_REQUIRED");
    }
  } else {
    throw new Error("BOOTSTRAP_TEST_DATABASE_ONLY");
  }
  if (target.mode === "apply" &&
      (target.confirmedDatabase !== target.database ||
       target.acknowledgedEmpty !== true)) {
    throw new Error("BOOTSTRAP_EXPLICIT_CONFIRMATION_REQUIRED");
  }
}

export async function inspectBootstrap(db: Db): Promise<string[]> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return collections.map((item) => item.name).sort();
}

/**
 * Restricted to a previously-verified empty test database.
 * This function never drops, alters or repairs pre-existing collections.
 * A partial failure is left untouched for manual inspection.
 */
export async function initializeEmptyBootstrap(db: Db): Promise<void> {
  if ((await inspectBootstrap(db)).length !== 0) {
    throw new Error("BOOTSTRAP_DATABASE_NOT_EMPTY");
  }
  const options = directWriteCollectionOptions();
  await db.createCollection("fragments", options.fragments);
  await db.createCollection("metadata", options.metadata);
  await db.collection("metadata").insertOne({
    _id: "fragments", version: 1, highest_allocated: 0,
  });
}
