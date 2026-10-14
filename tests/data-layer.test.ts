import assert from "node:assert/strict";
import test from "node:test";

import { fragmentSchema, type Fragment } from "../lib/fragment-schema";
import { validateFragmentJsonSchema } from "../lib/fragments/json-schema-validator";
import { nextFragmentId } from "../lib/fragments/id";
import { buildFragmentIndex } from "../lib/fragments/index";
import { validateFragmentSemantics } from "../lib/fragments/semantic-validator";

function fragment(overrides: Partial<Fragment> = {}): Fragment {
  return fragmentSchema.parse({
    schema_version: "0.1",
    id: "F-000001",
    created_at: "2026-10-02T16:00:00+08:00",
    updated_at: "2026-10-02T16:00:00+08:00",
    scope: "personal",
    type: "idea",
    status: "incubating",
    priority: "medium",
    urgency: "low",
    domains: ["knowledge-management"],
    tags: ["fragment-management"],
    project: null,
    related: [],
    title: "Test Fragment",
    summary: "A test Fragment.",
    next_action: null,
    original_input: "test",
    notes: null,
    interview: [],
    source: { channel: "chatgpt" },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
    ...overrides,
  });
}

test("Chinese and mixed-script tags pass both canonical schemas", () => {
  const candidate = fragment({ tags: ["文件撰寫", "rpa介紹", "ocr", "文件-交付"] });
  assert.equal(fragmentSchema.safeParse(candidate).success, true);
  assert.deepEqual(validateFragmentJsonSchema(candidate), []);
  assert.deepEqual(validateFragmentSemantics(candidate, [candidate]), []);
});

test("tag validators reject invalid symbols while domains remain ASCII-only", () => {
  const candidate = fragment();
  for (const invalid of ["文字@標籤", "-文件", "文件-", "兩--字", "文件 空格"]) {
    const bad = { ...candidate, tags: [invalid] };
    assert.equal(fragmentSchema.safeParse(bad).success, false, invalid);
    assert.notEqual(validateFragmentJsonSchema(bad).length, 0, invalid);
  }
  const invalidDomain = { ...candidate, domains: ["自動化"] };
  assert.equal(fragmentSchema.safeParse(invalidDomain).success, false);
  assert.notEqual(validateFragmentJsonSchema(invalidDomain).length, 0);
});

test("nextFragmentId uses the largest existing ID", () => {
  assert.equal(
    nextFragmentId(["F-000001", "F-000009", "F-000003"]),
    "F-000010",
  );
});

test("index builds reverse backlinks without mutating source relations", () => {
  const first = fragment({
    id: "F-000001",
    related: ["F-000002"],
  });
  const second = fragment({
    id: "F-000002",
    title: "Second",
  });

  const index = buildFragmentIndex([first, second]);
  const secondIndex = index.find((item) => item.id === "F-000002");

  assert.deepEqual(secondIndex?.backlinks, ["F-000001"]);
  assert.deepEqual(second.related, []);
});

test("semantic validation rejects unknown domains", () => {
  const candidate = fragment({
    domains: ["not-a-real-domain"],
  });

  const issues = validateFragmentSemantics(candidate, [candidate]);

  assert.ok(issues.some((issue) => issue.code === "unknown_domain"));
});

test("semantic validation requires project references to point to projects", () => {
  const parent = fragment({
    id: "F-000002",
    type: "idea",
    title: "Not a project",
  });
  const child = fragment({
    id: "F-000003",
    project: "F-000002",
  });

  const issues = validateFragmentSemantics(child, [parent, child]);

  assert.ok(issues.some((issue) => issue.code === "invalid_project_type"));
});

test("schema keeps interview_used synchronized with interview contents", () => {
  const invalid = {
    ...fragment(),
    interview: [{ question: "Q?", answer: "A" }],
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
  };

  assert.equal(fragmentSchema.safeParse(invalid).success, false);
});
