/**
 * Offline backup verifier. It decrypts only to memory and validates restored
 * BSON dates, Fragment relations, metadata, and the encrypted file hash.
 * Never connects to MongoDB and never changes any database.
 * npm run verify:backup -- --file=C:\\backups\\fragmenthubdb-....age --identity=C:\\keys\\backup.key
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BACKUP_MAX_BYTES, decodeBackupSnapshot } from "../lib/mongodb/backup-snapshot";

function arg(prefix: string): string {
  const args = process.argv.slice(2);
  const match = args.filter((v) => v.startsWith(prefix));
  if (match.length !== 1 || args.length !== 2) throw new Error("BACKUP_VERIFY_ARGUMENTS");
  return match[0].slice(prefix.length);
}

async function decryptAge(archive: string, identity: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    const child = spawn("age", ["--decrypt", "--identity", identity, "--output", "-", archive],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], shell: false });
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > BACKUP_MAX_BYTES) {
        exceeded = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.on("error", () => reject(new Error("BACKUP_AGE_NOT_AVAILABLE")));
    child.on("close", (status) => {
      if (exceeded) reject(new Error("BACKUP_SIZE_LIMIT"));
      else if (status !== 0) reject(new Error("BACKUP_DECRYPT_FAILED"));
      else resolve(Buffer.concat(chunks));
    });
  });
}

async function main(): Promise<void> {
  const archive = arg("--file=");
  const identity = arg("--identity=");
  if (!path.isAbsolute(archive) || !path.isAbsolute(identity) ||
    !archive.endsWith(".age")) throw new Error("BACKUP_VERIFY_ARGUMENTS");
  const [archiveInfo, manifestInfo] = await Promise.all([stat(archive), stat(archive + ".json")]);
  if (archiveInfo.size > BACKUP_MAX_BYTES + 64 * 1024 || manifestInfo.size > 8 * 1024) {
    throw new Error("BACKUP_SIZE_LIMIT");
  }
  const [encrypted, metadata] = await Promise.all([
    readFile(archive), readFile(archive + ".json", "utf8"),
  ]);
  const manifest = JSON.parse(metadata);
  if (
    manifest.format !== "fragmenthubdb-encrypted-manifest" ||
    manifest.version !== 1 || manifest.encryption !== "age" ||
    manifest.method !== "mongodb-snapshot-transaction" ||
    manifest.encryptedFilename !== path.basename(archive) ||
    typeof manifest.sha256 !== "string" ||
    createHash("sha256").update(encrypted).digest("hex") !== manifest.sha256
  ) throw new Error("BACKUP_HASH_INVALID");
  const decrypted = await decryptAge(archive, identity);
  const { counts } = decodeBackupSnapshot(decrypted);
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) {
    throw new Error("BACKUP_COUNTS_MISMATCH");
  }
  console.log("BACKUP_VERIFIED", JSON.stringify(counts));
  console.log("READ_ONLY_VERIFICATION_COMPLETE. No MongoDB connection or restore.");
}
main().catch(() => {
  console.error("BACKUP_VERIFY_FAILED. The archive or identity is invalid.");
  process.exitCode = 1;
});
