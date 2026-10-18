import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import { isIP } from "node:net";
import { loadEnvConfig } from "@next/env";
import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";
import { getMongoClient, closeMongoClient } from "../lib/mongodb/client";
import { directWriteCollectionOptions } from "../lib/mongodb/collection-validator";
import {
  assertBootstrapTarget, initializeEmptyBootstrap, inspectBootstrap,
  type BootstrapMode,
} from "../lib/mongodb/direct-mongo-bootstrap";

function parseFlags(args: string[]) {
  const modes = args.filter((arg) =>
    ["--dry-run", "--inspect", "--apply"].includes(arg));
  if (modes.length > 1 || new Set(args).size !== args.length) {
    throw new Error("BOOTSTRAP_INVALID_FLAGS");
  }
  const mode = (modes.length ? modes[0].slice(2) : "dry-run") as BootstrapMode;
  const prefixes = ["--expected-host=", "--confirm-target=", "--dns="];
  if (prefixes.some((p) => args.filter((arg) => arg.startsWith(p)).length > 1) ||
      args.some((arg) => !modes.includes(arg) &&
        arg !== "--acknowledge-empty" &&
        !prefixes.some((p) => arg.startsWith(p)))) {
    throw new Error("BOOTSTRAP_INVALID_FLAGS");
  }
  const get = (p: string) => args.find((arg) => arg.startsWith(p))?.slice(p.length);
  const acknowledgedEmpty = args.includes("--acknowledge-empty");
  const expectedHost = get("--expected-host=");
  const confirmedDatabase = get("--confirm-target=");
  const dnsServer = get("--dns=");
  if (mode === "dry-run" && args.length !== modes.length ||
      mode === "inspect" && (acknowledgedEmpty || confirmedDatabase) ||
      mode === "apply" && !acknowledgedEmpty) {
    throw new Error("BOOTSTRAP_INVALID_MODE_FLAGS");
  }
  if (dnsServer && !isIP(dnsServer)) throw new Error("BOOTSTRAP_DNS_INVALID");
  return { mode, acknowledgedEmpty, expectedHost, confirmedDatabase, dnsServer };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const validatorHash = createHash("sha256")
    .update(JSON.stringify(directWriteCollectionOptions())).digest("hex");

  // No connection and no environment secrets are necessary for this mode.
  if (flags.mode === "dry-run") {
    console.log(JSON.stringify({
      status: "DRY_RUN_ONLY",
      collections: ["fragments", "metadata"],
      validator_sha256: validatorHash,
      writes_performed: 0,
      atlas_connected: false,
    }));
    return;
  }

  if (flags.dnsServer) dns.setServers([flags.dnsServer]);
  loadEnvConfig(process.cwd());
  if (process.env.FragmentHubDB_DATA_STORE !== "mongodb") {
    throw new Error("BOOTSTRAP_MONGODB_STORE_REQUIRED");
  }
  const database = process.env.FragmentHubDB_MONGODB_DATABASE ?? "";
  assertBootstrapTarget({
    ...flags,
    database,
    uri: process.env.FragmentHubDB_MONGODB_URI ?? "",
    ci: process.env.CI,
  });

  let origin = "";
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw new Error("BOOTSTRAP_ORIGIN_UNVERIFIED"); }
  assertFragmentHubDbOrigin(origin);

  const client = await getMongoClient();
  const topology = await client.db("admin").command({ hello: 1 });
  if (!topology.isWritablePrimary || !topology.setName) {
    throw new Error("BOOTSTRAP_REPLICA_PRIMARY_REQUIRED");
  }
  const target = client.db(database);
  if (flags.mode === "inspect") {
    const collections = await inspectBootstrap(target);
    console.log(JSON.stringify({
      status: "READ_ONLY_INSPECTION",
      database,
      collections,
      readyForEmptyBootstrap: collections.length === 0,
      writes_performed: 0,
    }));
    return;
  }

  // Double-check emptiness near the write; never replace or repair a DB.
  if ((await inspectBootstrap(target)).length !== 0) {
    throw new Error("BOOTSTRAP_DATABASE_NOT_EMPTY");
  }
  await initializeEmptyBootstrap(target);
  const names = await inspectBootstrap(target);
  const epoch = await target.collection("metadata").findOne({ _id: "fragments" });
  if (names.join(",") !== "fragments,metadata" ||
      epoch?.version !== 1 || epoch?.highest_allocated !== 0) {
    throw new Error("BOOTSTRAP_POSTCHECK_FAILED");
  }
  console.log(JSON.stringify({
    status: "TEST_DATABASE_BOOTSTRAPPED",
    database,
    collections: names,
    metadata_version: 1,
    highest_allocated: 0,
    validator_sha256: validatorHash,
  }));
}

main().catch((error: unknown) => {
  // Never include raw driver errors, URIs or credentials in CI logs.
  const code = error instanceof Error && /^BOOTSTRAP_[A-Z_]+$/.test(error.message)
    ? error.message : "BOOTSTRAP_FAILED_REVIEW_TARGET";
  console.error(code);
  process.exitCode = 1;
}).finally(async () => {
  await closeMongoClient().catch(() => undefined);
});
