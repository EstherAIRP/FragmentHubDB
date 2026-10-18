import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBootstrapTarget, CI_DB, TEST_DB,
} from "../lib/mongodb/direct-mongo-bootstrap";

const ciUri = "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";
const atlasUri = "mongodb+srv://sample-host.mongodb.net/?retryWrites=true";

test("test-only bootstrap guard rejects other databases", () => {
  assert.doesNotThrow(() => assertBootstrapTarget({
    mode: "dry-run", database: "fragmenthubdb", uri: "",
  }));
  for (const database of ["fragmenthubdb", "fragmenthubdb_prod", "other"]) {
    assert.throws(() => assertBootstrapTarget({
      mode: "apply", database, uri: atlasUri,
      expectedHost: "sample-host.mongodb.net",
      confirmedDatabase: database, acknowledgedEmpty: true,
    }), /BOOTSTRAP_/);
  }
});

test("isolated CI bootstrap requires loopback, CI flag and explicit confirmation", () => {
  const valid = {
    mode: "apply" as const,
    database: CI_DB,
    uri: ciUri,
    ci: "true",
    confirmedDatabase: CI_DB,
    acknowledgedEmpty: true,
  };
  assert.doesNotThrow(() => assertBootstrapTarget(valid));
  for (const invalid of [
    { uri: atlasUri },
    { uri: "mongodb://127.0.0.1.evil.net:27017/" },
    { ci: "false" },
    { confirmedDatabase: "fragmenthubdb_test" },
    { acknowledgedEmpty: false },
  ]) {
    assert.throws(() => assertBootstrapTarget({ ...valid, ...invalid }));
  }
});

test("Atlas test target requires explicit hostname match and cannot run in CI", () => {
  const valid = {
    mode: "apply" as const,
    database: TEST_DB,
    uri: atlasUri,
    expectedHost: "sample-host.mongodb.net",
    confirmedDatabase: TEST_DB,
    acknowledgedEmpty: true,
  };
  assert.doesNotThrow(() => assertBootstrapTarget(valid));
  for (const invalid of [
    { uri: "mongodb://127.0.0.1:27017/" },
    { expectedHost: "" },
    { expectedHost: "other.mongodb.net" },
    { acknowledgedEmpty: false },
    { confirmedDatabase: "fragmenthubdb_ci" },
    { ci: "true" },
  ]) {
    assert.throws(() => assertBootstrapTarget({ ...valid, ...invalid }));
  }
});
