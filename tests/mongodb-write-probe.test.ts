import assert from "node:assert/strict";
import test from "node:test";

import { assertMongoWriteProbeTarget } from "../lib/mongodb/write-probe";

test("MongoDB write probe requires an explicitly selected test database", () => {
  assert.equal(
    assertMongoWriteProbeTarget("mongodb", "fragmenthubdb_test"),
    "fragmenthubdb_test",
  );
});

test("write probe fails closed for production and unrelated database names", () => {
  for (const selected of ["fragmenthubdb", "fragmenthubdb_ci", "fragmenthubdb_dev", "FragmentHubDB", "other", "", undefined]) {
    assert.throws(
      () => assertMongoWriteProbeTarget("mongodb", selected),
      /Refusing MongoDB write test/,
      String(selected),
    );
  }
});

test("write probe fails closed without MongoDB backend selected", () => {
  for (const backend of ["github", "local", "", undefined]) {
    assert.throws(
      () => assertMongoWriteProbeTarget(backend, "fragmenthubdb_test"),
      /Refusing MongoDB write test/,
      String(backend),
    );
  }
});
