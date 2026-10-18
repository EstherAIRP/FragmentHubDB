import assert from "node:assert/strict";
import test from "node:test";

import { fragmentSchema } from "../lib/fragment-schema";
import { parseMongoDocument } from "../lib/mongodb/document";
import { FragmentDataValidationError } from "../lib/fragments/semantic-validator";

const fixture = fragmentSchema.parse({
  schema_version: "0.1",
  id: "F-000001",
  created_at: "2026-10-02T16:00:00+08:00",
  updated_at: "2026-10-02T16:00:00+08:00",
  scope: "personal",
  type: "learning",
  status: "inbox",
  priority: "medium",
  urgency: "low",
  domains: ["knowledge-management"],
  tags: ["mongodb"],
  project: null,
  related: [],
  title: "Atlas",
  summary: "Learn MongoDB",
  next_action: null,
  original_input: "User's original text must survive",
  notes: null,
  interview: [],
  source: { channel: "chatgpt" },
  ai: { classification_confirmed: true, interview_used: false },
});

test("MongoDB document round-trips without changing Fragment fields", () => {
  const result = parseMongoDocument({ _id: fixture.id, ...fixture });
  assert.deepEqual(result, fixture);
  assert.equal(Object.hasOwn(result, "_id"), false);
});

test("MongoDB _id must equal the Fragment id", () => {
  assert.throws(
    () => parseMongoDocument({ _id: "F-000002", ...fixture }),
    (error: unknown) =>
      error instanceof FragmentDataValidationError &&
      error.issues.some((item) => item.code === "mongo_id_mismatch"),
  );
});

test("MongoDB reader rejects fields not in the canonical JSON Schema", () => {
  assert.throws(
    () => parseMongoDocument({
      _id: fixture.id,
      ...fixture,
      unrecognized_field: "must not be stripped",
    } as never),
    (error: unknown) =>
      error instanceof FragmentDataValidationError &&
      error.issues.some((item) => item.code === "json_schema_additionalProperties"),
  );
});

test("MongoDB reader rejects malformed canonical fields", () => {
  assert.throws(
    () => parseMongoDocument({ _id: fixture.id, ...fixture, tags: ["invalid tag"] }),
    FragmentDataValidationError,
  );
});
