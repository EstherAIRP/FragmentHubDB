import assert from "node:assert/strict";
import test from "node:test";

import { listLocalFragments } from "../lib/fragments/local-store";
import { parseFragmentId, formatFragmentId } from "../lib/fragments/id";
import { getMongoClient, closeMongoClient } from "../lib/mongodb/client";
import { createMongoFragment, listMongoFragments } from "../lib/mongodb/fragment-store";

/**
 * Readback + new-ID smoke test after the actual migrate:mongodb -- --apply
 * command. This test never drops or deletes the database.
 */
test("JSON migration reconciles and reserves all imported Fragment IDs", async () => {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.FragmentHubDB_MONGODB_DATABASE, "fragmenthubdb_ci");
  assert.match(
    process.env.FragmentHubDB_MONGODB_URI ?? "",
    /^mongodb:\/\/127\.0\.0\.1:27017(?:\/|\?)/,
  );

  try {
    const source = await listLocalFragments();
    const imported = await listMongoFragments();
    assert.ok(source.length > 0);
    assert.deepEqual(
      new Map(imported.map((item) => [item.id, item])),
      new Map(source.map((item) => [item.id, item])),
      "Imported MongoDB data must match every canonical JSON source document.",
    );

    let highest = 0;
    for (const entry of source) highest = Math.max(highest, parseFragmentId(entry.id));
    const client = await getMongoClient();
    const metadata = await client.db("fragmenthubdb_ci")
      .collection<{ _id: string; version: number; highest_allocated: number }>("metadata")
      .findOne({ _id: "fragments" });
    assert.equal(metadata?.highest_allocated, highest);

    const sample = source[0];
    const { id: _id, created_at: _created, updated_at: _updated, ...input } = sample;
    const next = await createMongoFragment({
      ...input,
      title: "CI only: post-migration insert",
      original_input: "Synthetic test entry after importing sample JSON",
      project: null,
      related: [],
    });
    assert.equal(next.id, formatFragmentId(highest + 1));
    assert.equal((await listMongoFragments()).length, source.length + 1);
  } finally {
    await closeMongoClient();
  }
});
