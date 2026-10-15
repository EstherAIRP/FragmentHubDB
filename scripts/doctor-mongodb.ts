/**
 * Read-only Atlas readiness check for FragmentHubDB.
 * Does not create collections, indexes, or Fragment documents.
 *
 * Run: npm run doctor:mongodb                   # strictly read-only
 *      npm run doctor:mongodb -- --write-test    # explicitly test DB only
 *      npm run doctor:mongodb -- --write-test --dns=8.8.8.8
 */
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import { isIP } from "node:net";

import { loadEnvConfig } from "@next/env";

import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";
import { fragmentHubDbDatabaseName } from "../lib/mongodb/database-name";
import { diagnoseMongoDoctorError } from "../lib/mongodb/doctor-diagnostics";
import { validateMongoMetadata, type MongoMetadata } from "../lib/mongodb/metadata-health";
import { validateFragmentSemantics } from "../lib/fragments/semantic-validator";
import { closeMongoClient, getMongoClient } from "../lib/mongodb/client";
import { listMongoFragments } from "../lib/mongodb/fragment-store";
import { assertMongoWriteProbeTarget, runMongoWriteProbe } from "../lib/mongodb/write-probe";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const writeTest = args.includes("--write-test");
  const dnsFlags = args.filter((arg) => arg.startsWith("--dns="));
  if (
    new Set(args).size !== args.length ||
    dnsFlags.length > 1 ||
    args.some((arg) =>
      arg !== "--strict" && arg !== "--write-test" && !arg.startsWith("--dns=")
    ) ||
    (strict && writeTest)
  ) {
    throw new Error("MongoDB doctor invalid flags: use --strict or --write-test, optionally --dns=<IP>.");
  }
  if (dnsFlags.length) {
    const server = dnsFlags[0].slice("--dns=".length);
    if (!isIP(server)) {
      throw new Error("MongoDB doctor invalid DNS IP address.");
    }
    // Local to this Node process; does not alter Windows or Vercel DNS.
    dns.setServers([server]);
  }

  loadEnvConfig(process.cwd());
  if (writeTest) {
    // Guard before ANY database connection. Never allow implicit/production DB.
    assertMongoWriteProbeTarget(
      process.env.FragmentHubDB_DATA_STORE,
      process.env.FragmentHubDB_MONGODB_DATABASE,
    );
  }
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
  if (writeTest) {
    // Only a uniquely named temporary collection in fragmenthubdb_test.
    const result = await runMongoWriteProbe(
      client,
      process.env.FragmentHubDB_DATA_STORE,
      process.env.FragmentHubDB_MONGODB_DATABASE,
    );
    console.log("TRANSACTION COMMIT:", result.transactionCommit ? "OK" : "FAILED");
    console.log("TRANSACTION ROLLBACK:", result.transactionRollback ? "OK" : "FAILED");
    console.log("TEMPORARY COLLECTION CLEANUP:", result.cleanup ? "OK" : "FAILED");
    console.log("WRITE TEST COMPLETE. Canonical Fragment data was untouched.");
  } else {
    console.log("READ-ONLY CHECK COMPLETE. No data was written.");
  }
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
