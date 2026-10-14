/**
 * Non-destructive, idempotent migration from checked-out data/fragments/*.json.
 *
 * npm run migrate:mongodb             # dry-run; verifies both sides
 * npm run migrate:mongodb -- --apply  # inserts missing IDs; never overwrites
 *
 * Run against a freshly updated clone of the source branch. The old files
 * remain untouched for rollback. NEVER publish the exported JSON elsewhere.
 */
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

import { listLocalFragments } from "../lib/fragments/local-store";
import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";
import {
  assertFragmentSemantics,
} from "../lib/fragments/semantic-validator";
import {
  closeMongoClient,
  getMongoFragmentCollection,
} from "../lib/mongodb/client";
import { listMongoFragments } from "../lib/mongodb/fragment-store";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) {
    throw new Error("Only --apply is supported. Without flags the command is a dry run.");
  }

  const apply = args.includes("--apply");

  // Load .env.local for CLI use (the Next.js web runtime does this itself).
  loadEnvConfig(process.cwd());

  // Guard before touching Atlas, even for dry-run.
  let origin: string;
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Refusing MongoDB import: cannot verify git origin.");
  }
  assertFragmentHubDbOrigin(origin);

  const source = await listLocalFragments();
  if (source.length === 0) {
    throw new Error("No local fragments found. Check out the correct source branch first.");
  }

  const existing = await listMongoFragments();
  const byId = new Map(existing.map((fragment) => [fragment.id, fragment]));
  const pending = [];

  for (const fragment of source) {
    const stored = byId.get(fragment.id);
    if (stored) {
      if (!isDeepStrictEqual(stored, fragment)) {
        throw new Error("Migration conflict for " + fragment.id +
          ": Atlas contains different content. No data was overwritten.");
      }
    } else {
      pending.push(fragment);
    }
  }

  const combined = existing.concat(pending);
  for (const candidate of pending) {
    assertFragmentSemantics(
      candidate,
      combined.filter((other) => other.id !== candidate.id),
    );
  }

  console.log(
    "Source:", source.length,
    "Atlas:", existing.length,
    "Already identical:", source.length - pending.length,
    "To import:", pending.length,
  );

  if (!apply) {
    console.log("DRY RUN only. Re-run with --apply after reviewing counts.");
    return;
  }

  const collection = await getMongoFragmentCollection();
  for (const fragment of pending) {
    await collection.insertOne({ ...fragment, _id: fragment.id });
  }

  // Read back and compare every source fragment before declaring success.
  const after = new Map(
    (await listMongoFragments()).map((fragment) => [fragment.id, fragment]),
  );
  for (const fragment of source) {
    if (!isDeepStrictEqual(after.get(fragment.id), fragment)) {
      throw new Error("Post-import verification failed for " + fragment.id);
    }
  }

  console.log("Verified:", source.length, "source documents in Atlas.");
  console.log("Old JSON files were not deleted or modified.");
}

main()
  .catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
