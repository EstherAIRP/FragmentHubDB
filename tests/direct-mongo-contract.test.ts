import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DIRECT_WRITE_RELEASE_ENABLED,
  GPT_EDITABLE_FIELDS,
  assessDirectWriteRequest,
  type DirectWriteAction,
} from "../lib/mongodb/direct-write-policy";
import { fragmentSchema } from "../lib/fragment-schema";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const json = (file: string) => JSON.parse(read(file));

test("P0-01 schema, taxonomy and ChatGPT rule template stay in sync", () => {
  const schema = json("config/fragment.schema.json");
  const classification = json("config/classification.json");
  const domainConfig = json("config/domains.json");
  const example = json("config/fragment.example.json");
  const rules = read("docs/CHATGPT_PROJECT_RULES.md");

  assert.equal(schema.properties.schema_version.const, "0.1");
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...schema.required].sort(),
  );
  for (const key of ["scope", "type", "status", "priority", "urgency"]) {
    assert.deepEqual(
      [...schema.properties[key].enum].sort(),
      Object.keys(classification[key].values).sort(),
      key,
    );
  }
  assert.equal(schema.properties.domains.maxItems, domainConfig.rules.absolute_max);
  assert.equal(schema.properties.tags.maxItems, classification.tags.absolute_max);
  assert.equal(fragmentSchema.safeParse(example).success, true);
  for (const domain of example.domains) {
    assert.equal(Object.hasOwn(domainConfig.domains, domain), true);
  }

  const fieldBlock = rules.match(
    /<!-- GPT_EDITABLE_FIELDS_START -->([\s\S]*?)<!-- GPT_EDITABLE_FIELDS_END -->/,
  );
  assert.ok(fieldBlock, "Rule template must include the machine-checked field block.");
  const listed = [...fieldBlock[1].matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1]);
  assert.deepEqual(listed, [...GPT_EDITABLE_FIELDS]);
  for (const field of GPT_EDITABLE_FIELDS) {
    assert.ok(schema.properties[field], field);
  }
  assert.match(rules, /未啟用直寫/);
  assert.match(rules, /使用者明確最終確認/);
});

test("P0-02 direct writes stay disabled by default even after approval", () => {
  assert.equal(DIRECT_WRITE_RELEASE_ENABLED, false);
  for (const action of [
    "create", "update", "delete", "relation", "batch", "atlas-admin",
  ] as DirectWriteAction[]) {
    assert.deepEqual(
      assessDirectWriteRequest({
        action, userConfirmed: true, capabilitiesVerified: true,
        fields: ["title"], project: null, related: [],
      }),
      { allowed: false, reason: "DIRECT_WRITE_DISABLED" },
    );
  }
  assert.deepEqual(
    assessDirectWriteRequest({
      action: "read", userConfirmed: false, capabilitiesVerified: false,
    }),
    { allowed: true, reason: "READ_ONLY" },
  );
});

test("P0-02 advisory policy requires confirmation, capabilities and field scope", () => {
  const base = {
    action: "update" as const, userConfirmed: true,
    capabilitiesVerified: true, fields: ["title"],
  };
  assert.equal(assessDirectWriteRequest({ ...base, userConfirmed: false }, true).allowed, false);
  assert.equal(assessDirectWriteRequest({ ...base, capabilitiesVerified: false }, true).allowed, false);
  assert.deepEqual(
    assessDirectWriteRequest({ ...base, fields: ["original_input"] }, true),
    { allowed: false, reason: "FIELD_NOT_ALLOWED" },
  );
  assert.equal(assessDirectWriteRequest({ ...base }, true).allowed, true);
  assert.deepEqual(
    assessDirectWriteRequest({
      action: "create", userConfirmed: true, capabilitiesVerified: true,
      project: "F-000001", related: [],
    }, true),
    { allowed: false, reason: "RELATIONS_NOT_SUPPORTED" },
  );
  for (const action of ["delete", "relation", "batch", "atlas-admin"] as DirectWriteAction[]) {
    assert.equal(assessDirectWriteRequest({
      action, userConfirmed: true, capabilitiesVerified: true,
    }, true).allowed, false);
  }
});

test("P0-03 no secrets, application LLM keys, or unrelated GitHub write target introduced", () => {
  const files = [
    "lib/mongodb/direct-write-policy.ts",
    "docs/CHATGPT_PROJECT_RULES.md",
    "docs/DIRECT_MONGODB_PHASE0.md",
  ];
  const sources = files.map(read).join("\n");
  assert.doesNotMatch(sources, /mongodb\+srv:\/\/[^\s]/);
  assert.doesNotMatch(sources, /sk-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(sources, /\bOPENAI_API_KEY\s*=/);
  assert.doesNotMatch(sources, /EstherAIRP\/FragmentHub(?!DB)/);
});
