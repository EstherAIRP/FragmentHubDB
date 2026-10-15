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

test("write probe target guard and cleanup expose safe, actionable status codes", () => {
  assert.equal(
    diagnoseMongoDoctorError(new Error("Refusing MongoDB write test: expected fragmenthubdb_test.")).code,
    "WRITE_TEST_GUARD",
  );
  assert.equal(
    diagnoseMongoDoctorError(new Error("MongoDB doctor invalid DNS IP address.")).code,
    "DOCTOR_ARGS",
  );
  assert.equal(
    diagnoseMongoDoctorError(new Error("Write probe cleanup failed.")).code,
    "WRITE_TEST_CLEANUP",
  );
  assert.equal(
    diagnoseMongoDoctorError(new Error("Write probe: transaction rollback left a document.")).code,
    "WRITE_TEST_FAILED",
  );
});

test("server-selection nested TCP error takes priority over incidental TLS wording", () => {
  const transport = Object.assign(
    new Error("Client network socket disconnected before secure TLS connection was established"),
    { name: "MongoNetworkError", code: "ECONNRESET" },
  );
  const selected = Object.assign(
    new Error("Server selection timed out, TLS was not established"),
    { name: "MongoServerSelectionError",
      reason: { servers: new Map([["internal-host", { error: transport }]]) } },
  );
  const diagnosis = diagnoseMongoDoctorError(selected);
  assert.equal(diagnosis.code, "NETWORK_ACCESS");
  assert.equal(diagnosis.technicalCode, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(diagnosis), /internal-host/);
});

test("nested TLS certificate errors retain safe structural code, never raw URI", () => {
  const tls = Object.assign(
    new Error("certificate verify failed mongodb+srv://app:secret@host.net"),
    { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
  );
  const error = Object.assign(
    new Error("Server selection failed"),
    { name: "MongoServerSelectionError", reason: { servers: new Map([["host.net", { error: tls }]]) } },
  );
  const diagnosis = diagnoseMongoDoctorError(error);
  assert.equal(diagnosis.code, "TLS_CERTIFICATE");
  assert.equal(diagnosis.technicalCode, "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  assert.doesNotMatch(JSON.stringify(diagnosis), /secret|host.net/);
});

test("nested concrete OpenSSL alert is a TLS failure", () => {
  const tls = Object.assign(new Error("ssl3_read_bytes:tlsv1 alert internal error"), {
    code: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
  });
  const error = Object.assign(new Error("Server selection failed"), {
    name: "MongoServerSelectionError", reason: { servers: new Map([["node", { error: { cause: tls } }]]) },
  });
  const diagnosis = diagnoseMongoDoctorError(error);
  assert.equal(diagnosis.code, "TLS_CONNECT");
  assert.equal(diagnosis.technicalCode, "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR");
});
