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
import { validateFragmentSemantics } from "../lib/fragments/semantic-validator";
import { closeMongoClient, getMongoClient } from "../lib/mongodb/client";
import { listMongoFragments } from "../lib/mongodb/fragment-store";

async function main(): Promise<void> {
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

  console.log("Database:", fragmentHubDbDatabaseName(process.env.FragmentHubDB_MONGODB_DATABASE));
  console.log("Ping: OK");
  console.log("Transactions: supported topology");
  console.log("Readable fragments:", fragments.length);
  if (issues.length) {
    for (const issue of issues) console.error("Validation issue:", issue);
    throw new Error("Atlas contains invalid Fragment references or metadata.");
  }
  console.log("Fragment validation: OK");
  console.log("READ-ONLY CHECK COMPLETE. No data was written.");
}

main()
  .catch((error: unknown) => {
    // Do not print connection strings, driver error bodies or credentials.
    if (error instanceof Error && /transactions are unavailable|invalid Fragment|Refusing MongoDB import/.test(error.message)) {
      console.error("Atlas check failed:", error.message);
    } else {
      console.error("Atlas connection or readiness check failed; verify credentials, topology and network access.");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient();
  });
