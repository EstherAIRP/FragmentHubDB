/**
 * Explicit local backup command. Only encrypted output is written to disk.
 * Requires a DIFFERENT, read-only MongoDB credential from the Web app.
 * No remote writes, scheduling or changes to Atlas network settings.
 *
 * Usage: npm run backup:mongodb -- --create
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

import { BACKUP_DATABASE, captureBackupSnapshot, encodeBackupSnapshot } from "../lib/mongodb/backup-snapshot";

type Success = { encryptedFilename: string; sha256: string; counts: Record<string, number> };
function fail(code: string): never { throw new Error(code); }

async function encryptAge(contents: Buffer, recipient: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("age", ["--encrypt", "--recipient", recipient, "--output", destination],
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"], shell: false });
    let finished = false;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (error) reject(error); else resolve();
    };
    child.on("error", () => done(new Error("BACKUP_AGE_NOT_AVAILABLE")));
    child.on("close", (code) => done(code === 0 ? undefined : new Error("BACKUP_ENCRYPTION_FAILED")));
    child.stdin.on("error", () => { /* closed by failed age subprocess */ });
    child.stdin.end(contents);
  });
}

export async function main(): Promise<Success> {
  if (process.argv.length !== 3 || process.argv[2] !== "--create") {
    return fail("BACKUP_EXPLICIT_CREATE_FLAG_REQUIRED");
  }
  loadEnvConfig(process.cwd());
  const uri = process.env.FragmentHubDB_BACKUP_MONGODB_URI;
  const siteUri = process.env.FragmentHubDB_MONGODB_URI;
  const recipient = process.env.FragmentHubDB_BACKUP_AGE_RECIPIENT;
  const directory = process.env.FragmentHubDB_BACKUP_DIRECTORY;
  const database = process.env.FragmentHubDB_BACKUP_MONGODB_DATABASE;
  if (!uri || uri === siteUri || !recipient || !directory || database !== BACKUP_DATABASE) {
    return fail("BACKUP_CONFIGURATION_INVALID");
  }
  if (!/^age1[0-9a-z]{50,}$/.test(recipient)) return fail("BACKUP_RECIPIENT_INVALID");
  if (!path.isAbsolute(directory) || !(await stat(directory).catch(() => null))?.isDirectory()) {
    return fail("BACKUP_DIRECTORY_INVALID");
  }
  if (process.env.CI === "true") return fail("BACKUP_NOT_ALLOWED_IN_CI");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000, maxPoolSize: 2 });
  let plaintext: Buffer;
  let counts: Record<string, number>;
  try {
    await client.connect();
    const snapshot = await captureBackupSnapshot(client, database);
    plaintext = encodeBackupSnapshot(snapshot);
    counts = {
      fragments: snapshot.collections.fragments.length,
      metadata: snapshot.collections.metadata.length,
      chatgpt_proposals: snapshot.collections.chatgpt_proposals.length,
    };
  } finally {
    await client.close().catch(() => undefined);
  }

  const base = "fragmenthubdb-" + new Date().toISOString().replace(/[:.]/g, "-") +
    "-" + randomBytes(5).toString("hex") + ".age";
  const destination = path.join(directory, base);
  const temp = destination + ".partial";
  let saved = false;
  try {
    // The raw snapshot stays in memory, goes straight to age's stdin.
    await encryptAge(plaintext, recipient, temp);
    const encrypted = await readFile(temp);
    if (!encrypted.length) return fail("BACKUP_ENCRYPTION_EMPTY");
    const sha256 = createHash("sha256").update(encrypted).digest("hex");
    await rename(temp, destination);
    const manifest = {
      format: "fragmenthubdb-encrypted-manifest",
      version: 1,
      encryptedFilename: base,
      sha256,
      counts,
      method: "mongodb-snapshot-transaction",
      encryption: "age",
      createdAt: new Date().toISOString(),
    };
    await writeFile(destination + ".json", JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    saved = true;
    return { encryptedFilename: base, sha256, counts };
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
    if (!saved) {
      await rm(destination, { force: true }).catch(() => undefined);
      await rm(destination + ".json", { force: true }).catch(() => undefined);
    }
  }
}

main().then((result) => {
  console.log("BACKUP_COMPLETE", JSON.stringify(result));
}).catch(() => {
  // Do NOT output raw database or age exceptions (URI/secret leakage).
  console.error("BACKUP_FAILED. Check local configuration and backup storage.");
  process.exitCode = 1;
});
