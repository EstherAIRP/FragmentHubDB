import assert from "node:assert/strict";
import test from "node:test";

import { planMongoImport } from "../lib/fragments/migration-plan";
import type { Fragment } from "../lib/fragment-schema";

function fragment(id: string, overrides: Partial<Fragment> = {}): Fragment {
  return {
    id,
    title: "Fragment " + id,
    original_input: "Original user text",
    tags: [],
    related: [],
    ...overrides,
  } as Fragment;
}

test("empty Atlas: imports all source fragments without touching the input", () => {
  const source = [fragment("F-000001"), fragment("F-000002")];
  const plan = planMongoImport(source, []);
  assert.equal(plan.sourceCount, 2);
  assert.equal(plan.atlasCount, 0);
  assert.equal(plan.identicalCount, 0);
  assert.deepEqual(plan.pending, source);
  assert.equal(source.length, 2);
});

test("idempotent retry: identical documents do not need a second write", () => {
  const source = [fragment("F-000001"), fragment("F-000002")];
  const plan = planMongoImport(source, [structuredClone(source[1])]);
  assert.deepEqual(plan.pending.map((item) => item.id), ["F-000001"]);
  assert.equal(plan.identicalCount, 1);
  assert.deepEqual(planMongoImport(source, structuredClone(source)).pending, []);
});

test("same ID with changed nested or immutable fields refuses import", () => {
  const source = [fragment("F-000001", { tags: ["alpha"] })];
  for (const altered of [
    fragment("F-000001", { tags: ["beta"] }),
    fragment("F-000001", { original_input: "rewritten by AI" }),
  ]) {
    assert.throws(
      () => planMongoImport(source, [altered]),
      /Atlas version differs for F-000001/,
    );
  }
});

test("unrecognized Atlas records fail closed", () => {
  assert.throws(
    () => planMongoImport([fragment("F-000001")], [fragment("F-999999")]),
    /not present in the selected source/,
  );
});

test("empty or duplicate source and duplicate Atlas IDs fail closed", () => {
  const item = fragment("F-000001");
  assert.throws(() => planMongoImport([], []), /source has no Fragments/);
  assert.throws(() => planMongoImport([item, item], []), /duplicate source ID/);
  assert.throws(
    () => planMongoImport([item], [item, structuredClone(item)]),
    /duplicate Atlas ID/,
  );
});
