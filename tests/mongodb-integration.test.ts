import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { Fragment } from "../lib/fragment-schema";
import type { NewFragment } from "../lib/fragments/local-store";
import { FragmentDataValidationError } from "../lib/fragments/semantic-validator";
import { closeMongoClient, getMongoClient } from "../lib/mongodb/client";
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
