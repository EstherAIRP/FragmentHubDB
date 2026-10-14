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
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

import { fragmentDirectory, listLocalFragments } from "../lib/fragments/local-store";
import { validateFragmentJsonSchema } from "../lib/fragments/json-schema-validator";
import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";
import { planMongoImport } from "../lib/fragments/migration-plan";
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

  // Reproducible imports must use committed source files, never local edits.
  const dirtyData = execFileSync("git", [
    "status", "--porcelain", "--", "data/fragments",
  ], { cwd: process.cwd(), encoding: "utf8" }).trim();
  if (dirtyData) {
    throw new Error("Refusing MongoDB import: data/fragments has uncommitted changes.");
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();

  const source = await listLocalFragments();

  // Check the raw JSON again: listLocalFragments uses Zod, which may strip
  // unknown keys, and a migration must never silently discard source data.
  for (const item of source) {
    const raw = JSON.parse(await fs.readFile(
      path.join(fragmentDirectory, item.id + ".json"), "utf8",
    ));
    const issues = validateFragmentJsonSchema(raw);
    if (issues.length > 0 || !isDeepStrictEqual(raw, item)) {
      throw new Error("MongoDB import refused: source file " + item.id +
        " does not match the canonical JSON schema.");
    }
  }

  const existing = await listMongoFragments();
  const plan = planMongoImport(source, existing);
  const pending = plan.pending;

  const combined = existing.concat(pending);
  // Validate the *entire* final dataset, including existing Atlas records.
  for (const candidate of combined) {
    assertFragmentSemantics(
      candidate,
      combined.filter((other) => other.id !== candidate.id),
    );
  }

  console.log(
    "Source commit:", sourceCommit,
    "Source:", plan.sourceCount,
    "Atlas:", plan.atlasCount,
    "Already identical:", plan.identicalCount,
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
    // Do not print raw driver exceptions: they may include connection details.
    if (error instanceof Error && /^(MongoDB import refused:|Refusing MongoDB import:)/.test(error.message)) {
      console.error("Migration failed:", error.message);
    } else {
      console.error("Migration failed. Check source validation, Atlas configuration and network access.");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
