import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { Fragment } from "../lib/fragment-schema";
import type { NewFragment } from "../lib/fragments/local-store";
import { FragmentDataValidationError } from "../lib/fragments/semantic-validator";
import { closeMongoClient, getMongoClient } from "../lib/mongodb/client";
import { BACKUP_DATABASE, captureBackupSnapshot, encodeBackupSnapshot, decodeBackupSnapshot } from "../lib/mongodb/backup-snapshot";
import { withMongoFragmentWrite } from "../lib/mongodb/write-transaction";
import { assertDisposableMongoValidatorTarget, directWriteCollectionOptions } from "../lib/mongodb/collection-validator";
import { chatGptDraftSchema } from "../lib/chatgpt/proposal-schema";
import { createChatGptProposal, getChatGptProposal, approveChatGptProposal, ProposalNotReadyError } from "../lib/chatgpt/proposals";
import {
  applyMongoStatusBatch,
  createMongoFragment,
  deleteMongoFragment,
  getMongoFragment,
  listMongoFragments,
  MongoFragmentConflictError,
  replaceMongoFragment,
} from "../lib/mongodb/fragment-store";

const TEST_DB = "fragmenthubdb_ci";
const LOOPBACK_URI = /^mongodb:\/\/127\.0\.0\.1:27017(?:\/|\?)/;
const DATABASE_VARIABLE = "FragmentHubDB_MONGODB_DATABASE";

function draft(overrides: Partial<NewFragment> = {}): NewFragment {
  return {
    schema_version: "0.1",
    scope: "personal",
    type: "idea",
    status: "inbox",
    priority: "medium",
    urgency: "low",
    domains: ["software-development"],
    tags: ["mongodb"],
    project: null,
    related: [],
    title: "CI transaction fixture",
    summary: "A confirmed test Fragment",
    next_action: null,
    original_input: "Test input, confirmed by a synthetic fixture",
    notes: null,
    interview: [],
    source: { channel: "chatgpt" },
    ai: { classification_confirmed: true, interview_used: false },
    ...overrides,
  };
}

/** Synthetic fixtures are canonical Fragments; proposals omit schema_version. */
function proposalDraft(overrides: Partial<NewFragment> = {}) {
  const { schema_version: _schemaVersion, ...source } = draft(overrides);
  return chatGptDraftSchema.parse({
    ...source,
    source: { channel: "chatgpt" },
  });
}

before(async () => {
  // This test suite permanently deletes its own database between cases.
  // Fail closed unless the runner explicitly targets a local test replica set.
  const uri = process.env.FragmentHubDB_MONGODB_URI ?? "";
  if (
    process.env.CI !== "true" ||
    !LOOPBACK_URI.test(uri) ||
    process.env[DATABASE_VARIABLE] !== TEST_DB
  ) {
    throw new Error(
      "Mongo integration tests require CI=true, a 127.0.0.1:27017 Mongo URI, " +
      "and FragmentHubDB_MONGODB_DATABASE=fragmenthubdb_ci.",
    );
  }
  const client = await getMongoClient();
  const hello = await client.db("admin").command({ hello: 1 });
  assert.equal(hello.isWritablePrimary, true, "MongoDB must be PRIMARY");
  assert.equal(typeof hello.setName, "string", "MongoDB must be a replica set");
});

beforeEach(async () => {
  const client = await getMongoClient();
  await client.db(TEST_DB).dropDatabase();
});

after(async () => {
  await closeMongoClient();
});

test("create, list and get persist confirmed Fragment fields", async () => {
  const created = await createMongoFragment(draft());
  assert.equal(created.id, "F-000001");
  assert.equal(created.original_input, draft().original_input);
  assert.deepEqual(await getMongoFragment(created.id), created);
  assert.deepEqual(await listMongoFragments(), [created]);

  const client = await getMongoClient();
  const metadata = await client.db(TEST_DB).collection<{ _id: string; version: number }>("metadata").findOne({
    _id: "fragments",
  });
  assert.equal(typeof metadata?.version, "number");
});

test("transaction error rolls back Fragment and metadata changes together", async () => {
  const now = new Date().toISOString();
  await assert.rejects(
    async () => withMongoFragmentWrite(async (collection, session, metadata) => {
      await collection.insertOne({
        ...draft(),
        id: "F-000001",
        _id: "F-000001",
        created_at: now,
        updated_at: now,
      }, { session });
      await metadata.updateOne(
        { _id: "fragments" },
        { $max: { highest_allocated: 999 } },
        { session },
      );
      throw new Error("intentional integration-test rollback");
    }),
    /intentional integration-test rollback/,
  );
  const client = await getMongoClient();
  const database = client.db(TEST_DB);
  assert.equal(await database.collection("fragments").countDocuments(), 0);
  assert.equal(await database.collection("metadata").countDocuments(), 0);
});

test("deleted Fragment IDs are never reused", async () => {
  const first = await createMongoFragment(draft({ title: "First" }));
  const second = await createMongoFragment(draft({ title: "Second" }));
  await deleteMongoFragment(second.id, second.updated_at);
  const third = await createMongoFragment(draft({ title: "Third" }));
  assert.equal(first.id, "F-000001");
  assert.equal(second.id, "F-000002");
  assert.equal(third.id, "F-000003");
  await deleteMongoFragment(first.id, first.updated_at);
  await deleteMongoFragment(third.id, third.updated_at);
  const fourth = await createMongoFragment(draft({ title: "Fourth" }));
  assert.equal(fourth.id, "F-000004");
});

test("update enforces optimistic version and immutable original input", async () => {
  const initial = await createMongoFragment(draft());
  const updated = await replaceMongoFragment(
    initial.id,
    { ...initial, title: "Updated title" },
    initial.updated_at,
  );
  assert.equal(updated.title, "Updated title");
  assert.notEqual(updated.updated_at, initial.updated_at);

  await assert.rejects(
    replaceMongoFragment(
      initial.id,
      { ...initial, title: "Stale edit" },
      initial.updated_at,
    ),
    MongoFragmentConflictError,
  );

  await assert.rejects(
    replaceMongoFragment(
      updated.id,
      { ...updated, original_input: "Rewritten" },
      updated.updated_at,
    ),
    FragmentDataValidationError,
  );
  assert.deepEqual(await getMongoFragment(updated.id), updated);
});

test("project membership and backlinks block invalid edits and deletes", async () => {
  const parent = await createMongoFragment(draft({ type: "project" }));
  const child = await createMongoFragment(draft({
    title: "Child",
    project: parent.id,
    related: [parent.id],
  }));

  await assert.rejects(
    replaceMongoFragment(
      parent.id,
      { ...parent, type: "idea" },
      parent.updated_at,
    ),
    FragmentDataValidationError,
  );
  await assert.rejects(
    deleteMongoFragment(parent.id, parent.updated_at),
    FragmentDataValidationError,
  );

  await deleteMongoFragment(child.id, child.updated_at);
  await deleteMongoFragment(parent.id, parent.updated_at);
  assert.deepEqual(await listMongoFragments(), []);
});

test("kanban batch is atomic and stale version does not partially update", async () => {
  const first = await createMongoFragment(draft({ title: "One" }));
  const second = await createMongoFragment(draft({ title: "Two" }));

  const stale = await applyMongoStatusBatch([
    { id: first.id, status: "active", expected_updated_at: first.updated_at },
    { id: second.id, status: "waiting", expected_updated_at: "2020-01-01T00:00:00.000Z" },
  ]);
  assert.equal(stale.kind, "conflict");
  assert.equal((await getMongoFragment(first.id))?.status, "inbox");
  assert.equal((await getMongoFragment(second.id))?.status, "inbox");

  const committed = await applyMongoStatusBatch([
    { id: first.id, status: "active", expected_updated_at: first.updated_at },
    { id: second.id, status: "waiting", expected_updated_at: second.updated_at },
  ]);
  assert.equal(committed.kind, "committed");
  assert.equal((await getMongoFragment(first.id))?.status, "active");
  assert.equal((await getMongoFragment(second.id))?.status, "waiting");
});

test("concurrent updates cannot both overwrite the same version", async () => {
  const initial = await createMongoFragment(draft());
  const results = await Promise.allSettled([
    replaceMongoFragment(initial.id, { ...initial, title: "A" }, initial.updated_at),
    replaceMongoFragment(initial.id, { ...initial, title: "B" }, initial.updated_at),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const current = (await getMongoFragment(initial.id)) as Fragment;
  assert.ok(["A", "B"].includes(current.title));
});

test("concurrent child creation and project deletion never leave orphan references", async () => {
  const parent = await createMongoFragment(draft({ type: "project" }));
  const results = await Promise.allSettled([
    createMongoFragment(draft({ project: parent.id, title: "Concurrent child" })),
    deleteMongoFragment(parent.id, parent.updated_at),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  const all = await listMongoFragments();
  for (const fragment of all) {
    if (fragment.project !== null) {
      const ancestor = all.find((other) => other.id === fragment.project);
      assert.equal(ancestor?.type, "project");
    }
  }
});

test("ChatGPT preview stores only a pending proposal; human approval creates once", async () => {
  const prepared = proposalDraft({ title: "Previewed by ChatGPT", original_input: "  Original input with whitespace  \\n" });
  const proposal = await createChatGptProposal(prepared, "12345");
  assert.equal(proposal.status, "pending");
  assert.deepEqual(await listMongoFragments(), []);
  assert.equal(await getChatGptProposal(proposal._id, "54321"), null);
  assert.equal((await getChatGptProposal(proposal._id, "12345"))?.status, "pending");

  const createdId = await approveChatGptProposal(proposal._id, "12345");
  assert.equal(createdId, "F-000001");
  const created = await getMongoFragment(createdId);
  assert.equal(created?.title, prepared.title);
  assert.equal(created?.original_input, prepared.original_input);
  assert.equal(created?.source.channel, "chatgpt");
  assert.equal((await getChatGptProposal(proposal._id, "12345"))?.status, "committed");
  assert.equal((await getChatGptProposal(proposal._id, "12345"))?.fragment_id, createdId);

  await assert.rejects(
    approveChatGptProposal(proposal._id, "12345"),
    (error: unknown) => error instanceof ProposalNotReadyError && error.statusCode === 409,
  );
  assert.equal((await listMongoFragments()).length, 1);
});

test("two approvals racing for one proposal can commit only one Fragment", async () => {
  const prepared = proposalDraft({ title: "Race on one proposal" });
  const proposal = await createChatGptProposal(prepared, "12345");
  const results = await Promise.allSettled([
    approveChatGptProposal(proposal._id, "12345"),
    approveChatGptProposal(proposal._id, "12345"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await listMongoFragments()).length, 1);
});

test("ChatGPT approval revalidates relation changes after preview", async () => {
  const project = await createMongoFragment(draft({ type: "project" }));
  const prepared = proposalDraft({ project: project.id, title: "Child awaiting approval" });
  const proposal = await createChatGptProposal(prepared, "12345");
  await deleteMongoFragment(project.id, project.updated_at);
  await assert.rejects(approveChatGptProposal(proposal._id, "12345"));
  assert.equal((await getChatGptProposal(proposal._id, "12345"))?.status, "pending");
  assert.deepEqual(await listMongoFragments(), []);
});

test("expired ChatGPT proposals never create a canonical Fragment", async () => {
  const prepared = proposalDraft({ title: "Expired pending proposal" });
  const proposal = await createChatGptProposal(prepared, "12345");
  const client = await getMongoClient();
  await client.db(TEST_DB).collection<{ _id: string; expires_at: Date }>("chatgpt_proposals").updateOne(
    { _id: proposal._id },
    { $set: { expires_at: new Date(Date.now() - 1000) } },
  );
  await assert.rejects(approveChatGptProposal(proposal._id, "12345"));
  assert.deepEqual(await listMongoFragments(), []);
});

test("snapshot backup reads consistent fragments, metadata and proposals with no database mutation", async () => {
  // This test's suite-wide guard permits ONLY the disposable CI MongoDB.
  const client = await getMongoClient();
  const db = client.db(BACKUP_DATABASE);
  await db.dropDatabase();
  const now = new Date("2026-10-15T12:00:00.000Z");
  const input = draft();
  const id = "F-000001";
  try {
    await db.collection<{ _id: string; [key: string]: unknown }>("fragments").insertOne({
      ...input, _id: id, id, created_at: now.toISOString(), updated_at: now.toISOString(),
    });
    await db.collection<{ _id: string; [key: string]: unknown }>("metadata").insertOne({
      _id: "fragments", version: 1, highest_allocated: 1,
    });
    await db.collection<{ _id: string; [key: string]: unknown }>("chatgpt_proposals").insertOne({
      _id: "a".repeat(48),
      owner_id: "123456",
      status: "pending",
      draft: proposalDraft(),
      created_at: now,
      expires_at: new Date(now.getTime() + 30000),
    });
    const snapshot = await captureBackupSnapshot(client, BACKUP_DATABASE);
    const { snapshot: restored, counts } = decodeBackupSnapshot(encodeBackupSnapshot(snapshot));
    assert.deepEqual(counts, { fragments: 1, metadata: 1, chatgpt_proposals: 1 });
    assert.equal(restored.collections.fragments[0].original_input, input.original_input);
    assert.equal(restored.collections.metadata[0].highest_allocated, 1);
    assert.ok(restored.collections.chatgpt_proposals[0].created_at instanceof Date);
    assert.equal(await db.collection("fragments").countDocuments({}), 1);
    assert.equal(await db.collection("metadata").countDocuments({}), 1);
    assert.equal(await db.collection("chatgpt_proposals").countDocuments({}), 1);

    await db.collection("unexpected_future_collection").insertOne({ value: 1 });
    await assert.rejects(() => captureBackupSnapshot(client, BACKUP_DATABASE), /BACKUP_UNKNOWN_COLLECTION/);
  } finally {
    await db.dropDatabase();
  }
});

test("Phase 1 MongoDB validators admit Web writes and reject malformed direct documents", async () => {
  assertDisposableMongoValidatorTarget(
    process.env.FragmentHubDB_MONGODB_DATABASE ?? "",
    process.env.FragmentHubDB_MONGODB_URI ?? "",
    process.env.CI,
  );
  const client = await getMongoClient();
  const db = client.db(TEST_DB);
  const options = directWriteCollectionOptions();
  // beforeEach dropped the complete, disposable CI DB only.
  await db.createCollection("fragments", options.fragments);
  await db.createCollection("metadata", options.metadata);

  const created = await createMongoFragment(draft());
  assert.equal(created.id, "F-000001");
  assert.equal((await getMongoFragment(created.id))?.original_input, draft().original_input);
  const updated = await replaceMongoFragment(
    created.id, { ...created, title: "Edited under validator" }, created.updated_at,
  );
  assert.equal(updated.title, "Edited under validator");

  const baseline = { ...created, _id: "F-000002", id: "F-000002" };
  const bad: Record<string, unknown>[] = [
    { ...baseline, title: undefined },
    { ...baseline, unknown_field: "no extra columns" },
    { ...baseline, status: "invalid" },
    { ...baseline, priority: 7 },
    { ...baseline, domains: ["unknown-domain"] },
    { ...baseline, source: { channel: "chatgpt", extra: true } },
    { ...baseline, ai: { classification_confirmed: false, interview_used: false } },
    { ...baseline, _id: "F-000003" },
  ];
  for (const value of bad) {
    await assert.rejects(
      db.collection("fragments").insertOne(value),
      (error: unknown) => typeof error === "object" && error !== null &&
        "code" in error && error.code === 121,
    );
  }

  await assert.rejects(
    db.collection<{ _id: string; highest_allocated?: unknown }>("metadata").updateOne(
      { _id: "fragments" }, { $set: { highest_allocated: "not-a-number" } },
    ),
  );
  assert.equal(await db.collection("fragments").countDocuments({}), 1);
  assert.equal((await listMongoFragments()).length, 1);
});

/**
 * Phase 2 tool-compatible compare-and-swap: an actual ChatGPT Atlas plugin
 * exposes find + update_many with matchedCount, but not findOneAndUpdate.
 * This test exercises the same database primitives using the Node driver,
 * NOT the connected ChatGPT plugin.
 */
async function reserveFragmentIdUsingToolCompatibleCas(): Promise<string> {
  const client = await getMongoClient();
  const epoch = client.db(TEST_DB).collection<{
    _id: string;
    version: number;
    highest_allocated?: number;
  }>("metadata");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = await epoch.findOne({ _id: "fragments" });
    if (!found || !Number.isSafeInteger(found.version) ||
        !Number.isSafeInteger(found.highest_allocated)) {
      throw new Error("GPT_ID_COUNTER_NOT_INITIALIZED");
    }
    const value = found.highest_allocated!;
    if (value < 0 || value >= 999999) {
      throw new Error("GPT_ID_SPACE_EXHAUSTED");
    }

    try {
      const updated = await epoch.updateMany(
        { _id: "fragments", highest_allocated: value },
        { $inc: { highest_allocated: 1 } },
        { upsert: false },
      );
      if (updated.matchedCount === 1) {
        return "F-" + String(value + 1).padStart(6, "0");
      }
      assert.equal(updated.matchedCount, 0, "exactly one metadata row is allowed");
    } catch (error) {
      // A transaction in the Web writer may already be updating metadata.
      if (!(error instanceof Error && /WriteConflict/.test(error.message))) {
        throw error;
      }
    }
  }
  throw new Error("GPT_ID_RESERVATION_CONTENTION");
}

test("Phase 2 tool-compatible compare-and-swap reserves one unique Fragment ID", async () => {
  const first = await createMongoFragment(draft());
  assert.equal(first.id, "F-000001");
  const allocated = await reserveFragmentIdUsingToolCompatibleCas();
  assert.equal(allocated, "F-000002");

  const now = new Date().toISOString();
  const client = await getMongoClient();
  const database = client.db(TEST_DB);
  const input = draft({ title: "GPT tool-compatible standalone insert" });
  const created = await database.collection("fragments").insertMany([{
    ...input, id: allocated, _id: allocated, created_at: now, updated_at: now,
  }]);
  assert.equal(created.insertedCount, 1);
  assert.equal(created.insertedIds[0], allocated);

  const stored = await getMongoFragment(allocated);
  assert.equal(stored?.title, input.title);
  assert.equal(stored?.original_input, input.original_input);
  assert.equal(stored?.project, null);
  assert.deepEqual(stored?.related, []);
  assert.equal((await createMongoFragment(draft())).id, "F-000003");
});

test("Phase 2 reserved numbers may be skipped but never reused", async () => {
  await assert.rejects(reserveFragmentIdUsingToolCompatibleCas(), /NOT_INITIALIZED/);
  await createMongoFragment(draft());
  assert.equal(await reserveFragmentIdUsingToolCompatibleCas(), "F-000002");
  // Deliberately do not insert the reserved ID; next Web ID must skip it.
  assert.equal((await createMongoFragment(draft())).id, "F-000003");
  const client = await getMongoClient();
  const metadata = await client.db(TEST_DB).collection<{ _id: string; highest_allocated: number }>("metadata").findOne({ _id: "fragments" });
  assert.equal(metadata?.highest_allocated, 3);
});

test("Phase 2 compare-and-swap prevents conflicting reservations", async () => {
  await createMongoFragment(draft());
  const [a, b] = await Promise.all([
    reserveFragmentIdUsingToolCompatibleCas(),
    reserveFragmentIdUsingToolCompatibleCas(),
  ]);
  assert.deepEqual([a, b].sort(), ["F-000002", "F-000003"]);
});

test("Phase 2 highest allocated number never overflows beyond six digits", async () => {
  await createMongoFragment(draft());
  const client = await getMongoClient();
  const epoch = client.db(TEST_DB).collection<{ _id: string; highest_allocated: number }>("metadata");
  await epoch.updateOne({ _id: "fragments" }, { $set: { highest_allocated: 999999 } });
  await assert.rejects(reserveFragmentIdUsingToolCompatibleCas(), /SPACE_EXHAUSTED/);
  assert.equal((await epoch.findOne({ _id: "fragments" }))?.highest_allocated, 999999);
});
