import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import rawExample from "../config/fragment.example.json";
import { fragmentSchema } from "../lib/fragment-schema";
import { getMongoClient, closeMongoClient } from "../lib/mongodb/client";
import {
  assertBootstrapTarget, CI_DB, initializeEmptyBootstrap, inspectBootstrap,
} from "../lib/mongodb/direct-mongo-bootstrap";
import {
  createMongoFragment, getMongoFragment, replaceMongoFragment,
} from "../lib/mongodb/fragment-store";

const uri = "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";

before(async () => {
  assertBootstrapTarget({
    mode: "apply",
    database: process.env.FragmentHubDB_MONGODB_DATABASE ?? "",
    uri: process.env.FragmentHubDB_MONGODB_URI ?? "",
    ci: process.env.CI,
    confirmedDatabase: CI_DB, acknowledgedEmpty: true,
  });
  assert.equal(process.env.FragmentHubDB_DATA_STORE, "mongodb");
  const client = await getMongoClient();
  const hello = await client.db("admin").command({ hello: 1 });
  assert.equal(hello.isWritablePrimary, true);
  assert.equal(typeof hello.setName, "string");
  await client.db(CI_DB).dropDatabase();
});

after(async () => {
  // Drops ONLY the ephemeral CI test DB; never touch a real Atlas database.
  if (process.env.CI === "true" &&
      process.env.FragmentHubDB_MONGODB_DATABASE === CI_DB &&
      process.env.FragmentHubDB_MONGODB_URI === uri) {
    const client = await getMongoClient();
    await client.db(CI_DB).dropDatabase();
  }
  await closeMongoClient();
});

test("P1 bootstrap inspect is read-only on a missing database", async () => {
  const db = (await getMongoClient()).db(CI_DB);
  assert.deepEqual(await inspectBootstrap(db), []);
  assert.equal((await db.listCollections().toArray()).length, 0);
});

test("P1 bootstrap creates exactly two validated collections and zero allocated IDs", async () => {
  const db = (await getMongoClient()).db(CI_DB);
  await initializeEmptyBootstrap(db);
  assert.deepEqual(await inspectBootstrap(db), ["fragments", "metadata"]);
  const metadata = await db.collection<{ _id: string; version: number; highest_allocated: number }>("metadata").findOne({ _id: "fragments" });
  assert.equal(metadata?.version, 1);
  assert.equal(metadata?.highest_allocated, 0);
  assert.equal(await db.collection("fragments").countDocuments(), 0);

  const specs = await db.listCollections({}, { nameOnly: false }).toArray();
  for (const name of ["fragments", "metadata"]) {
    const info = specs.find((entry) => entry.name === name);
    assert.ok(info);
    assert.equal(info.options?.validationLevel, "strict");
    assert.equal(info.options?.validationAction, "error");
    assert.ok(info.options?.validator);
  }

  const example = fragmentSchema.parse(rawExample);
  const malformed = { ...example, _id: "F-000002", id: "F-000001" };
  await assert.rejects(
    db.collection<{ _id: string; [key: string]: unknown }>("fragments").insertOne(malformed),
    (error: unknown) => typeof error === "object" && error !== null &&
      "code" in error && error.code === 121,
  );
  const { id: _id, created_at: _created, updated_at: _updated, ...input } = example;
  const saved = await createMongoFragment(input);
  assert.equal(saved.id, "F-000001");
  assert.equal((await getMongoFragment(saved.id))?.original_input, input.original_input);
  const updated = await replaceMongoFragment(
    saved.id, { ...saved, title: "Edited with validators" }, saved.updated_at,
  );
  assert.equal(updated.title, "Edited with validators");
});

test("P1 bootstrap refuses any pre-existing collection without changing documents", async () => {
  const db = (await getMongoClient()).db(CI_DB);
  const before = await db.collection("fragments").countDocuments();
  await assert.rejects(() => initializeEmptyBootstrap(db), /BOOTSTRAP_DATABASE_NOT_EMPTY/);
  assert.equal(await db.collection("fragments").countDocuments(), before);
  assert.deepEqual(await inspectBootstrap(db), ["fragments", "metadata"]);
});
