import assert from "node:assert/strict";
import test from "node:test";

import { fragmentHubDbDatabaseName } from "../lib/mongodb/database-name.ts";

test("default and explicit FragmentHubDB database names are accepted", () => {
  assert.equal(fragmentHubDbDatabaseName(), "fragmenthubdb");
  assert.equal(fragmentHubDbDatabaseName("fragmenthubdb"), "fragmenthubdb");
  assert.equal(fragmentHubDbDatabaseName("fragmenthubdb_dev"), "fragmenthubdb_dev");
  assert.equal(fragmentHubDbDatabaseName("fragmenthubdb-preview"), "fragmenthubdb-preview");
});

test("unrelated database names and path-like names are rejected", () => {
  for (const value of [
    "FragmentHub",
    "fragmenthub",
    "other",
    "fragmenthubdb/other",
    "fragmenthubdb.system",
    "fragmenthubdb_",
    "",
  ]) {
    assert.throws(
      () => fragmentHubDbDatabaseName(value),
      /Refusing MongoDB access/,
      value,
    );
  }
});
