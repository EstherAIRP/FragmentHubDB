import { BSON, type ClientSession, type Db, type MongoClient } from "mongodb";

import { parseMongoDocument, type MongoFragmentDocument } from "@/lib/mongodb/document";
import { validateMongoMetadata, type MongoMetadata } from "@/lib/mongodb/metadata-health";
import { validateFragmentSemantics } from "@/lib/fragments/semantic-validator";
import { chatGptDraftSchema, type ChatGptProposal } from "@/lib/chatgpt/proposal-schema";

export const BACKUP_DATABASE = "fragmenthubdb_test";
export const BACKUP_FORMAT = "fragmenthubdb-snapshot";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;
export const BACKUP_COLLECTIONS = ["fragments", "metadata", "chatgpt_proposals"] as const;

export type BackupSnapshot = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_FORMAT_VERSION;
  database: typeof BACKUP_DATABASE;
  capturedAt: string;
  collections: {
    fragments: MongoFragmentDocument[];
    metadata: MongoMetadata[];
    chatgpt_proposals: ChatGptProposal[];
  };
};

export type BackupCounts = {
  fragments: number;
  metadata: number;
  chatgpt_proposals: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Inspect every supported collection. Unknown collections must fail closed. */
export async function verifyBackupCollectionScope(db: Db): Promise<void> {
  const names = await db.listCollections({}, { nameOnly: true }).toArray();
  const permitted = new Set<string>(BACKUP_COLLECTIONS);
  if (names.some(({ name }) => !permitted.has(name))) {
    throw new Error("BACKUP_UNKNOWN_COLLECTION");
  }
}

/**
 * Read all collections sequentially through ONE transaction snapshot.
 * This needs no write privileges, no server maintenance mode, and never
 * writes plaintext to disk. Large databases must use a different strategy.
 */
export async function captureBackupSnapshot(
  client: MongoClient,
  databaseName: string,
): Promise<BackupSnapshot> {
  if (databaseName !== BACKUP_DATABASE) throw new Error("BACKUP_DATABASE_NOT_ALLOWED");
  const db = client.db(databaseName);
  await verifyBackupCollectionScope(db);
  const session: ClientSession = client.startSession({ causalConsistency: false });
  try {
    const captured = await session.withTransaction<BackupSnapshot>(async () => ({
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      database: BACKUP_DATABASE,
      capturedAt: new Date().toISOString(),
      collections: {
        fragments: await db.collection<MongoFragmentDocument>("fragments")
          .find({}, { session }).toArray(),
        metadata: await db.collection<MongoMetadata>("metadata")
          .find({}, { session }).toArray(),
        chatgpt_proposals: await db.collection<ChatGptProposal>("chatgpt_proposals")
          .find({}, { session }).toArray(),
      },
    }), {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      readPreference: "primary",
      maxCommitTimeMS: 15000,
    });
    if (!captured) throw new Error("BACKUP_SNAPSHOT_NOT_COMMITTED");
    validateBackupSnapshot(captured);
    await verifyBackupCollectionScope(db);
    return captured;
  } finally {
    await session.endSession();
  }
}

/**
 * Fail-closed checks used before encrypting and after decrypting.
 * The data, personal text, URLs and nested BSON error messages are never
 * sent to stdout or logs.
 */
export function validateBackupSnapshot(input: unknown): BackupCounts {
  if (!record(input) ||
    Object.keys(input).sort().join(",") !==
      ["format", "version", "database", "capturedAt", "collections"].sort().join(",") ||
    input.format !== BACKUP_FORMAT ||
    input.version !== BACKUP_FORMAT_VERSION ||
    input.database !== BACKUP_DATABASE ||
    typeof input.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    !record(input.collections) ||
    Object.keys(input.collections).sort().join(",") !== [...BACKUP_COLLECTIONS].sort().join(",")) {
    throw new Error("BACKUP_SCHEMA_INVALID");
  }
  const { fragments, metadata, chatgpt_proposals: proposals } = input.collections;
  if (!Array.isArray(fragments) || !Array.isArray(metadata) || !Array.isArray(proposals)) {
    throw new Error("BACKUP_SCHEMA_INVALID");
  }
  if (metadata.length > 1 ||
    (metadata.length === 1 && (!record(metadata[0]) || metadata[0]._id !== "fragments"))) {
    throw new Error("BACKUP_METADATA_INVALID");
  }

  const parsed = fragments.map((document) => parseMongoDocument(document));
  const ids = new Set(parsed.map(({ id }) => id));
  if (ids.size !== parsed.length) throw new Error("BACKUP_DUPLICATE_FRAGMENT");
  for (const fragment of parsed) {
    if (validateFragmentSemantics(fragment, parsed.filter((v) => v.id !== fragment.id)).length) {
      throw new Error("BACKUP_FRAGMENT_INVALID");
    }
  }
  const epoch = metadata.length ? metadata[0] as MongoMetadata : null;
  if (parsed.length && !epoch) throw new Error("BACKUP_METADATA_MISSING");
  if (validateMongoMetadata(parsed, epoch, parsed.length > 0).length) {
    throw new Error("BACKUP_METADATA_INVALID");
  }

  const proposalIds = new Set<string>();
  for (const value of proposals) {
    if (!record(value) || typeof value._id !== "string" ||
      !/^[a-f0-9]{48}$/.test(value._id) || proposalIds.has(value._id) ||
      typeof value.owner_id !== "string" || !/^\d+$/.test(value.owner_id) ||
      (value.status !== "pending" && value.status !== "committed") ||
      !(value.created_at instanceof Date) || !Number.isFinite(value.created_at.getTime()) ||
      !(value.expires_at instanceof Date) || !Number.isFinite(value.expires_at.getTime()) ||
      !chatGptDraftSchema.safeParse(value.draft).success) {
      throw new Error("BACKUP_PROPOSAL_INVALID");
    }
    proposalIds.add(value._id);
    if (value.status === "committed" &&
      (typeof value.fragment_id !== "string" || !ids.has(value.fragment_id))) {
      throw new Error("BACKUP_PROPOSAL_INVALID");
    }
    if (value.committed_at !== undefined &&
      (!(value.committed_at instanceof Date) || !Number.isFinite(value.committed_at.getTime()))) {
      throw new Error("BACKUP_PROPOSAL_INVALID");
    }
  }
  return { fragments: parsed.length, metadata: metadata.length, chatgpt_proposals: proposals.length };
}

export function encodeBackupSnapshot(snapshot: BackupSnapshot): Buffer {
  validateBackupSnapshot(snapshot);
  const buffer = Buffer.from(BSON.EJSON.stringify(snapshot, { relaxed: false }), "utf8");
  if (buffer.byteLength > BACKUP_MAX_BYTES) throw new Error("BACKUP_SIZE_LIMIT");
  return buffer;
}

export function decodeBackupSnapshot(input: Buffer): { snapshot: BackupSnapshot; counts: BackupCounts } {
  if (input.byteLength > BACKUP_MAX_BYTES) throw new Error("BACKUP_SIZE_LIMIT");
  const parsed: unknown = BSON.EJSON.parse(input.toString("utf8"), { relaxed: false });
  const counts = validateBackupSnapshot(parsed);
  return { snapshot: parsed as BackupSnapshot, counts };
}
