import assert from "node:assert/strict";
import test from "node:test";
import { BSON } from "mongodb";

import {
  BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_DATABASE,
  validateBackupSnapshot, encodeBackupSnapshot, decodeBackupSnapshot,
  type BackupSnapshot,
} from "../lib/mongodb/backup-snapshot";

function empty(): BackupSnapshot {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    database: BACKUP_DATABASE,
    capturedAt: "2026-10-15T12:00:00.000Z",
    collections: { fragments: [], metadata: [], chatgpt_proposals: [] },
  };
}

test("zero-record snapshot validates and round-trips with EJSON", () => {
  const source = empty();
  assert.deepEqual(validateBackupSnapshot(source),
    { fragments: 0, metadata: 0, chatgpt_proposals: 0 });
  const { snapshot, counts } = decodeBackupSnapshot(encodeBackupSnapshot(source));
  assert.deepEqual(snapshot, source);
  assert.equal(counts.fragments, 0);
});

test("snapshot rejects unknown DB, extra collection and inconsistent epoch", () => {
  assert.throws(() => validateBackupSnapshot({ ...empty(), database: "admin" }), /BACKUP_SCHEMA_INVALID/);
  assert.throws(() => validateBackupSnapshot({
    ...empty(), collections: { ...empty().collections, secrets: [] },
  }), /BACKUP_SCHEMA_INVALID/);
  assert.throws(() => validateBackupSnapshot({
    ...empty(), collections: { ...empty().collections, metadata: [{ _id: "fragments", version: 0 }] },
  }), /BACKUP_METADATA_INVALID/);
  assert.throws(() => validateBackupSnapshot({
    ...empty(), collections: { ...empty().collections, chatgpt_proposals: [{ _id: "unverified" }] },
  }), /BACKUP_PROPOSAL_INVALID/);
});

test("snapshot captures BSON Dates through canonical EJSON", () => {
  const value = { at: new Date("2026-10-15T12:00:00.000Z") };
  const encoded = BSON.EJSON.stringify(value, { relaxed: true });
  const decoded = BSON.EJSON.parse(encoded, { relaxed: true });
  assert.ok((decoded as { at: unknown }).at instanceof Date);
});

test("truncated, tampered and malformed backups fail before restoration", () => {
  assert.throws(() => decodeBackupSnapshot(Buffer.from("{}")), /BACKUP_SCHEMA_INVALID/);
  assert.throws(() => decodeBackupSnapshot(Buffer.from("{")), /Unexpected end|JSON/);
  assert.throws(() => decodeBackupSnapshot(Buffer.alloc(32 * 1024 * 1024 + 1)), /BACKUP_SIZE_LIMIT/);
});
