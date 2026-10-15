import assert from "node:assert/strict";
import test from "node:test";

import {
  validateMongoMetadata,
  type MongoMetadata,
} from "../lib/mongodb/metadata-health";

const fragments = [{ id: "F-000001" }, { id: "F-000008" }];

test("fresh database passes basic read-only doctor but not strict cutover", () => {
  assert.deepEqual(validateMongoMetadata([], null, false), []);
  assert.deepEqual(validateMongoMetadata(fragments, null, false), []);
  assert.deepEqual(
    validateMongoMetadata(fragments, null, true),
    ["MongoDB metadata/fragments transaction record is absent."],
  );
});

test("transaction metadata with valid high-water mark passes strict cutover", () => {
  const record: MongoMetadata = {
    _id: "fragments",
    version: 5,
    highest_allocated: 20,
  };
  assert.deepEqual(validateMongoMetadata(fragments, record, true), []);
});

test("strict cutover blocks missing ID watermark", () => {
  assert.ok(validateMongoMetadata(
    fragments,
    { _id: "fragments", version: 1 },
    true,
  ).some((issue) => issue.includes("highest_allocated")));
});

test("cutover refuses metadata version or watermark corruption", () => {
  for (const bad of [
    { _id: "fragments", version: 0, highest_allocated: 8 },
    { _id: "fragments", version: 1.5, highest_allocated: 8 },
    { _id: "fragments", version: 5, highest_allocated: 7 },
    { _id: "fragments", version: 5, highest_allocated: 1000000 },
  ] as MongoMetadata[]) {
    assert.notDeepEqual(validateMongoMetadata(fragments, bad, true), []);
  }
});
