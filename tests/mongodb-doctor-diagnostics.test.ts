import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseMongoDoctorError } from "../lib/mongodb/doctor-diagnostics";

test("MongoDB doctor diagnoses missing URI without printing raw errors", () => {
  const result = diagnoseMongoDoctorError(
    new Error("MongoDB is selected but FragmentHubDB_MONGODB_URI is missing."),
  );
  assert.equal(result.code, "URI_MISSING");
  assert.match(result.guidance, /\.env\.local/);
});

test("Atlas authentication failure reports password guidance only", () => {
  const secret = "dont-leak-this-mongodb-password";
  const error = Object.assign(
    new Error("Authentication failed mongodb+srv://db:" + secret + "@cluster0.mongodb.net"),
    { name: "MongoServerError", code: 18, codeName: "AuthenticationFailed" },
  );
  const result = diagnoseMongoDoctorError(error);
  assert.equal(result.code, "AUTH_FAILED");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("Atlas DNS and network failures are distinguished", () => {
  assert.equal(
    diagnoseMongoDoctorError(Object.assign(new Error("querySrv ENOTFOUND"), { code: "ENOTFOUND" })).code,
    "DNS_LOOKUP",
  );
  assert.equal(
    diagnoseMongoDoctorError(Object.assign(new Error("Server selection timed out"), { name: "MongoServerSelectionError" })).code,
    "NETWORK_ACCESS",
  );
  assert.equal(
    diagnoseMongoDoctorError(Object.assign(new Error("no route"), { code: "ETIMEDOUT" })).code,
    "NETWORK_ACCESS",
  );
});

test("doctor exposes safe guidance for URI, Git origin, permission and topology", () => {
  const cases = [
    ["Invalid connection string", "URI_FORMAT"],
    ["Refusing MongoDB access: database name must start with fragmenthubdb.", "DB_NAME_INVALID"],
    ["Refusing MongoDB import: git origin must be EstherAIRP/FragmentHubDB", "GIT_ORIGIN"],
    ["not authorized on fragmenthubdb_test", "DB_PERMISSION"],
    ["TLS handshake failure", "TLS_CONNECT"],
    ["Atlas cluster is not a replica set or sharded cluster; transactions are unavailable.", "TRANSACTION_TOPOLOGY"],
  ];
  for (const [message, expected] of cases) {
    assert.equal(diagnoseMongoDoctorError(new Error(message)).code, expected);
  }
});

test("diagnostics never return unclassified driver text or embedded secrets", () => {
  const secret = "mongodb+srv://app:p@ssword@secretcluster.mongodb.net";
  const diagnosis = diagnoseMongoDoctorError(new Error("Something unexpected: " + secret));
  assert.equal(diagnosis.code, "ATLAS_CHECK_FAILED");
  assert.doesNotMatch(JSON.stringify(diagnosis), /secretcluster|p@ssword/);
});

test("error cause chains can reveal actionable low-level connection failures", () => {
  const wrapper = new Error("MongoServerSelectionError", {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
  });
  assert.equal(diagnoseMongoDoctorError(wrapper).code, "DNS_LOOKUP");
});
