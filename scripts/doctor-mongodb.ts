/**
 * Read-only Atlas readiness check for FragmentHubDB.
 * Does not create collections, indexes, or Fragment documents.
 *
 * Run: npm run doctor:mongodb
 */
import { execFileSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";
import { fragmentHubDbDatabaseName } from "../lib/mongodb/database-name";
import { diagnoseMongoDoctorError } from "../lib/mongodb/doctor-diagnostics";
import { validateMongoMetadata, type MongoMetadata } from "../lib/mongodb/metadata-health";
import { validateFragmentSemantics } from "../lib/fragments/semantic-validator";
import { closeMongoClient, getMongoClient } from "../lib/mongodb/client";
import { listMongoFragments } from "../lib/mongodb/fragment-store";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--strict")) {
    throw new Error("MongoDB doctor supports only --strict.");
  }
  const strict = args.includes("--strict");
  loadEnvConfig(process.cwd());
  const origin = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assertFragmentHubDbOrigin(origin);

  const client = await getMongoClient();
  await client.db("admin").command({ ping: 1 });

  const topology = await client.db("admin").command({ hello: 1 });
  const isReplicaSet = typeof topology.setName === "string";
  const isSharded = topology.msg === "isdbgrid";
  if (!isReplicaSet && !isSharded) {
    throw new Error("Atlas cluster is not a replica set or sharded cluster; transactions are unavailable.");
  }

  const fragments = await listMongoFragments();
  const issues = fragments.flatMap((fragment) =>
    validateFragmentSemantics(
      fragment,
      fragments.filter((candidate) => candidate.id !== fragment.id),
    ).map((issue) => fragment.id + ": " + issue.code + " (" + issue.path + ")"),
  );

  const databaseName = fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE);
  const metadata = await client.db(databaseName)
    .collection<MongoMetadata>("metadata")
    .findOne({ _id: "fragments" });
  const metadataIssues = validateMongoMetadata(fragments, metadata, strict);
  if (strict && fragments.length === 0) {
    metadataIssues.push("Strict readiness check requires at least one imported Fragment.");
  }

  console.log("Database:", databaseName);
  console.log("Ping: OK");
  console.log("Transactions: supported topology");
  console.log("Readable fragments:", fragments.length);
  console.log("Metadata:", metadata ? "present" : "not yet initialized");
  if (issues.length) {
    for (const issue of issues) console.error("Validation issue:", issue);
    throw new Error("Atlas contains invalid Fragment references or metadata.");
  }
  console.log("Fragment validation: OK");
  if (metadataIssues.length) {
    for (const issue of metadataIssues) console.error("Metadata issue:", issue);
    throw new Error("MongoDB transaction metadata is not ready for cutover.");
  }
  console.log(strict ? "STRICT READINESS: OK" : "Metadata consistency: OK");
  console.log("READ-ONLY CHECK COMPLETE. No data was written.");
}

main()
  .catch((error: unknown) => {
    // Never echo raw MongoDB driver errors or git output: these can expose
    // connection strings, credentials, hosts or internal deployment details.
    const diagnosis = diagnoseMongoDoctorError(error);
    console.error(`Atlas doctor [${diagnosis.code}]: ${diagnosis.guidance}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
