import assert from "node:assert/strict";
import test from "node:test";

import {
  fragmentSchema,
  fragmentStatusSchema,
  type Fragment,
} from "../lib/fragment-schema";
import {
  boardScore,
  countRecentlyDone,
  filterByScope,
  groupBoard,
  listIncubating,
  parseBoardScope,
  toBoardCards,
} from "../lib/fragments/board";
import {
  buildStatusBatchRequest,
  groupEditZones,
  interpretStatusBatchResponse,
  listPendingChanges,
  moveCard,
  parseBoardDraft,
  rebasePendingChanges,
  revertChange,
  serializeBoardDraft,
  statusBatchErrorMessages,
  type PendingChanges,
} from "../lib/fragments/board-edit";
import {
  manualFragmentDraftSchema,
  toFragmentWriteInput,
} from "../lib/fragments/manual-draft";
import { domainLabel } from "../lib/fragments/presentation";
import { collectTags, filterFragments } from "../lib/fragments/query";
import { normalizeTag, normalizeTags } from "../lib/fragments/tags";
import { prepareCreateInput, prepareReplacement } from "../lib/fragments/write";

function fragment(overrides: Partial<Fragment> = {}): Fragment {
  return fragmentSchema.parse({
    schema_version: "0.1",
    id: "F-000001",
    created_at: "2026-10-02T16:00:00+08:00",
    updated_at: "2026-10-02T16:00:00+08:00",
    scope: "personal",
    type: "note",
    status: "inbox",
    priority: "none",
    urgency: "none",
    domains: ["knowledge-management"],
    tags: ["fragment-management"],
    project: null,
    related: [],
    title: "FragmentHub note",
    summary: "A note about FragmentHub.",
    next_action: null,
    original_input: "note",
    notes: null,
    interview: [],
    source: { channel: "web" },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
    ...overrides,
  });
}

test("fragment filters combine search and metadata filters", () => {
  const items = [
    fragment({
      id: "F-000001",
      scope: "personal",
      title: "AI memory notes",
      tags: ["memory"],
      domains: ["ai"],
    }),
    fragment({
      id: "F-000002",
      scope: "work",
      title: "RPA OCR task",
      tags: ["ocr"],
      domains: ["automation-rpa"],
    }),
  ];

  const result = filterFragments(items, {
    scope: "work",
    q: "ocr",
    domain: "automation-rpa",
  });

  assert.deepEqual(result.map((item) => item.id), ["F-000002"]);
});

test("manual draft rejects unregistered domains", () => {
  const result = manualFragmentDraftSchema.safeParse({
    scope: "personal",
    type: "note",
    status: "inbox",
    priority: "none",
    urgency: "none",
    domains: ["made-up-domain"],
    tags: [],
    project: null,
    related: [],
    title: "Test",
    summary: "",
    next_action: null,
    original_input: "Test",
    notes: null,
    interview: [],
    source: { channel: "web" },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
  });

  assert.equal(result.success, false);
});

test("manual Web draft becomes canonical write input without AI runtime", () => {
  const draft = manualFragmentDraftSchema.parse({
    scope: "work",
    type: "task",
    status: "inbox",
    priority: "high",
    urgency: "medium",
    domains: ["automation-rpa"],
    tags: ["ocr"],
    project: null,
    related: [],
    title: "OCR check",
    summary: "Check OCR flow.",
    next_action: "Run test.",
    original_input: "Need to check OCR.",
    notes: null,
    interview: [],
    source: { channel: "web" },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
  });

  const writeInput = toFragmentWriteInput(draft);

  assert.equal(writeInput.source.channel, "web");
  assert.equal(writeInput.ai.classification_confirmed, true);
  assert.equal(writeInput.ai.interview_used, false);
  assert.deepEqual(writeInput.interview, []);
});


test("Web create ignores forged system metadata", () => {
  const draft = manualFragmentDraftSchema.parse({
    scope: "personal",
    type: "note",
    status: "inbox",
    priority: "none",
    urgency: "none",
    domains: ["knowledge-management"],
    tags: ["manual"],
    project: null,
    related: [],
    title: "Manual create",
    summary: "",
    next_action: null,
    original_input: "Original",
    notes: null,
    interview: [{ question: "Forged?", answer: "Yes" }],
    source: { channel: "chatgpt" },
    ai: {
      classification_confirmed: true,
      interview_used: true,
    },
  });

  const input = prepareCreateInput(draft);

  assert.equal(input.source.channel, "web");
  assert.deepEqual(input.interview, []);
  assert.equal(input.ai.interview_used, false);
});

test("Web edit preserves immutable source, interview and original input", () => {
  const current = fragment({
    source: { channel: "chatgpt" },
    original_input: "Keep this original text.",
    interview: [{ question: "Q?", answer: "A" }],
    ai: {
      classification_confirmed: true,
      interview_used: true,
    },
  });

  const draft = manualFragmentDraftSchema.parse({
    scope: "work",
    type: "task",
    status: "active",
    priority: "high",
    urgency: "medium",
    domains: ["automation-rpa"],
    tags: ["changed"],
    project: null,
    related: [],
    title: "Changed title",
    summary: "Changed summary",
    next_action: "Do it.",
    original_input: "Attempted overwrite.",
    notes: "Updated notes.",
    interview: [],
    source: { channel: "web" },
    ai: {
      classification_confirmed: true,
      interview_used: false,
    },
  });

  const replacement = prepareReplacement(current, draft);

  assert.equal(replacement.original_input, "Keep this original text.");
  assert.equal(replacement.source.channel, "chatgpt");
  assert.deepEqual(replacement.interview, [{ question: "Q?", answer: "A" }]);
  assert.equal(replacement.ai.interview_used, true);
  assert.equal(replacement.title, "Changed title");
  assert.equal(replacement.status, "active");
});

test("fragment search also matches next action, notes, original input and domain labels", () => {
  const items = [
    fragment({
      id: "F-000001",
      title: "Vision idea",
      domains: ["computer-vision"],
      next_action: "Collect sample images",
    }),
    fragment({
      id: "F-000002",
      title: "Notes only",
      domains: ["life"],
      notes: "Remember the dentist",
      original_input: "週末要整理書櫃",
    }),
  ];

  const ids = (q: string) =>
    filterFragments(items, { q }).map((item) => item.id);

  assert.deepEqual(ids("電腦視覺"), ["F-000001"]);
  assert.deepEqual(ids("sample images"), ["F-000001"]);
  assert.deepEqual(ids("dentist"), ["F-000002"]);
  assert.deepEqual(ids("整理書櫃"), ["F-000002"]);
  assert.deepEqual(ids("computer-vision"), ["F-000001"]);
});

test("domainLabel resolves configured labels and falls back to the ID", () => {
  assert.equal(domainLabel("computer-vision"), "電腦視覺");
  assert.equal(domainLabel("not-a-domain"), "not-a-domain");
});

test("normalizeTag retains Unicode tags alongside old English tags", () => {
  assert.equal(normalizeTag("  OCR  "), "ocr");
  assert.equal(normalizeTag("Fragment Management"), "fragment-management");
  assert.equal(normalizeTag("snake_case__tag"), "snake-case-tag");
  assert.equal(normalizeTag("a - b"), "a-b");
  assert.equal(normalizeTag("   "), "");
  assert.equal(normalizeTag(" RPA介紹 "), "rpa介紹");
  assert.equal(normalizeTag("文件 撰寫"), "文件-撰寫");
  assert.equal(normalizeTag("文件_交付"), "文件-交付");
  assert.equal(normalizeTag("cafe\u0301"), "café");
  assert.deepEqual(normalizeTags(["RPA介紹", "rpa介紹", "文件交付"]), [
    "rpa介紹",
    "文件交付",
  ]);
  assert.deepEqual(normalizeTags(["OCR", "ocr", " ", "Work Flow"]), [
    "ocr",
    "work-flow",
  ]);
});

test("manual draft accepts Chinese tags without changing domain IDs", () => {
  const draft = manualFragmentDraftSchema.parse(fragment({
    tags: ["文件撰寫", "rpa介紹"],
  }));
  assert.deepEqual(draft.tags, ["文件撰寫", "rpa介紹"]);
  assert.deepEqual(draft.domains, ["knowledge-management"]);
});

test("Chinese tags participate in collection and normalized search", () => {
  const items = [
    fragment({ id: "F-000001", tags: ["文件交付", "café"] }),
    fragment({ id: "F-000002", tags: ["文件撰寫", "ocr"] }),
  ];

  assert.deepEqual(collectTags(items), ["café", "ocr", "文件交付", "文件撰寫"].sort());
  assert.deepEqual(filterFragments(items, { tag: "交付" }).map((item) => item.id), ["F-000001"]);
  assert.deepEqual(filterFragments(items, { q: "文件撰寫" }).map((item) => item.id), ["F-000002"]);
  assert.deepEqual(filterFragments(items, { tag: "cafe\u0301" }).map((item) => item.id), ["F-000001"]);
});

test("status enum rejects removed lifecycle values", () => {
  assert.deepEqual(fragmentStatusSchema.options, [
    "incubating",
    "inbox",
    "active",
    "waiting",
    "done",
    "archived",
  ]);

  for (const status of ["seed", "exploring", "defined", "actionable"]) {
    assert.equal(fragmentStatusSchema.safeParse(status).success, false);
    assert.throws(() => fragment({ status: status as Fragment["status"] }));
  }
});

test("board groups inbox/active/waiting and sorts by score then recency", () => {
  const items = [
    fragment({ id: "F-000001", status: "inbox", priority: "low", urgency: "low", updated_at: "2026-10-05T00:00:00+08:00" }),
    fragment({ id: "F-000002", status: "inbox", priority: "high", urgency: "none", updated_at: "2026-10-03T00:00:00+08:00" }),
    fragment({ id: "F-000003", status: "inbox", priority: "medium", urgency: "medium", updated_at: "2026-10-04T00:00:00+08:00" }),
    fragment({ id: "F-000004", status: "inbox", priority: "high", urgency: "high", updated_at: "2026-10-02T16:00:00+08:00" }),
    fragment({ id: "F-000005", status: "active" }),
    fragment({ id: "F-000006", status: "waiting" }),
    fragment({ id: "F-000007", status: "incubating" }),
    fragment({ id: "F-000008", status: "done" }),
    fragment({ id: "F-000009", status: "archived" }),
  ];

  const columns = groupBoard(items);

  assert.equal(boardScore({ priority: "high", urgency: "medium" }), 5);
  // F-000004 scores 6; F-000003 (4) beats F-000002 (3) on score; ties fall back to updated_at.
  assert.deepEqual(
    columns.inbox.map((item) => item.id),
    ["F-000004", "F-000003", "F-000002", "F-000001"],
  );
  assert.deepEqual(columns.active.map((item) => item.id), ["F-000005"]);
  assert.deepEqual(columns.waiting.map((item) => item.id), ["F-000006"]);
});

test("board breaks score ties by most recent update", () => {
  const columns = groupBoard([
    fragment({ id: "F-000001", status: "active", updated_at: "2026-10-03T00:00:00+08:00" }),
    fragment({ id: "F-000002", status: "active", updated_at: "2026-10-05T00:00:00+08:00" }),
  ]);

  assert.deepEqual(columns.active.map((item) => item.id), ["F-000002", "F-000001"]);
});

test("board scope parsing and filtering", () => {
  const items = [
    fragment({ id: "F-000001", scope: "work" }),
    fragment({ id: "F-000002", scope: "personal" }),
  ];

  assert.equal(parseBoardScope("work"), "work");
  assert.equal(parseBoardScope("personal"), "personal");
  assert.equal(parseBoardScope("bogus"), "all");
  assert.equal(parseBoardScope(undefined), "all");
  assert.deepEqual(filterByScope(items, "work").map((item) => item.id), ["F-000001"]);
  assert.equal(filterByScope(items, "all").length, 2);
});

test("incubating list holds only incubating Fragments, newest first", () => {
  const items = listIncubating([
    fragment({ id: "F-000001", status: "incubating", updated_at: "2026-10-03T00:00:00+08:00" }),
    fragment({ id: "F-000002", status: "incubating", updated_at: "2026-10-06T00:00:00+08:00" }),
    fragment({ id: "F-000003", status: "inbox" }),
    fragment({ id: "F-000004", status: "archived" }),
  ]);

  assert.deepEqual(items.map((item) => item.id), ["F-000002", "F-000001"]);
});

test("recently done counts done Fragments updated within 7 days", () => {
  const now = new Date("2026-10-10T12:00:00+08:00");
  const items = [
    fragment({ id: "F-000001", status: "done", updated_at: "2026-10-09T00:00:00+08:00" }),
    fragment({ id: "F-000002", status: "done", updated_at: "2026-10-03T13:00:00+08:00" }),
    fragment({ id: "F-000003", status: "done", updated_at: "2026-10-02T16:00:00+08:00" }),
    fragment({ id: "F-000004", status: "active", updated_at: "2026-10-09T00:00:00+08:00" }),
  ];

  assert.equal(countRecentlyDone(items, now), 2);
});

test("board cards carry only displayed fields plus id, status and updated_at", () => {
  const cards = toBoardCards([
    fragment({
      id: "F-000001",
      status: "inbox",
      priority: "high",
      domains: ["ai", "computer-vision", "automation-rpa"],
      original_input: "secret original",
      notes: "private notes",
      interview: [{ question: "Q?", answer: "A" }],
      ai: { classification_confirmed: true, interview_used: true },
    }),
    fragment({ id: "F-000002", status: "done" }),
    fragment({ id: "F-000003", status: "archived" }),
    fragment({ id: "F-000004", status: "incubating" }),
  ]);

  assert.deepEqual(cards.map((card) => card.id), ["F-000001", "F-000004"]);
  assert.deepEqual(Object.keys(cards[0]).sort(), [
    "domainLabels",
    "id",
    "next_action",
    "priority",
    "scope",
    "status",
    "title",
    "updated_at",
  ]);
  assert.deepEqual(cards[0].domainLabels, [domainLabel("ai"), "電腦視覺"]);
});

const editCard = (id: string, status: Fragment["status"], updated_at = "2026-10-02T16:00:00+08:00") => ({
  id,
  title: `Title ${id}`,
  status,
  updated_at,
});

test("board edit records moves and drops a card moved back to its original status", () => {
  const a = editCard("F-000001", "inbox");
  const b = editCard("F-000002", "incubating");

  let changes: PendingChanges = {};
  changes = moveCard(changes, a, "active");
  changes = moveCard(changes, a, "waiting");
  changes = moveCard(changes, b, "archived");

  assert.deepEqual(listPendingChanges(changes), [
    { id: "F-000001", title: "Title F-000001", from: "inbox", to: "waiting", expected_updated_at: a.updated_at },
    { id: "F-000002", title: "Title F-000002", from: "incubating", to: "archived", expected_updated_at: b.updated_at },
  ]);

  changes = moveCard(changes, a, "inbox");
  assert.deepEqual(Object.keys(changes), ["F-000002"]);

  changes = revertChange(changes, "F-000002");
  assert.deepEqual(changes, {});
});

test("board edit groups cards by effective status and hides archived", () => {
  const cards = [
    editCard("F-000001", "inbox"),
    editCard("F-000002", "incubating"),
    editCard("F-000003", "active"),
  ];
  let changes: PendingChanges = moveCard({}, cards[0], "done");
  changes = moveCard(changes, cards[1], "inbox");
  changes = moveCard(changes, cards[2], "archived");

  const zones = groupEditZones(cards, changes);
  assert.deepEqual(zones.done.map((card) => card.id), ["F-000001"]);
  assert.deepEqual(zones.inbox.map((card) => card.id), ["F-000002"]);
  assert.deepEqual(zones.incubating, []);
  assert.deepEqual(zones.active, []);
  assert.deepEqual(zones.waiting, []);
});

test("board edit payload uses each card's stored updated_at verbatim", () => {
  const a = editCard("F-000002", "inbox", "2026-10-05T09:30:00+08:00");
  const b = editCard("F-000001", "waiting", "2026-10-04T01:02:03.456Z");
  let changes = moveCard({}, a, "active");
  changes = moveCard(changes, b, "done");

  assert.deepEqual(buildStatusBatchRequest(changes), {
    changes: [
      { id: "F-000001", status: "done", expected_updated_at: "2026-10-04T01:02:03.456Z" },
      { id: "F-000002", status: "active", expected_updated_at: "2026-10-05T09:30:00+08:00" },
    ],
  });
});

test("board edit rebase keeps untouched changes and drops conflicts and stale cards", () => {
  const a = editCard("F-000001", "inbox");
  const b = editCard("F-000002", "inbox");
  const c = editCard("F-000003", "active");
  const d = editCard("F-000004", "waiting");
  const e = editCard("F-000005", "incubating");

  let changes: PendingChanges = {};
  for (const card of [a, b, c, d, e]) changes = moveCard(changes, card, "done");

  const refreshed = [
    a, // unchanged: keep
    { ...b, updated_at: "2026-10-09T00:00:00+08:00", status: "waiting" as const }, // updated elsewhere
    c, // reported as 409 conflict
    { ...d, status: "done" as const }, // already reflects the change
    // e disappeared
  ];

  const result = rebasePendingChanges(changes, refreshed, ["F-000003"]);

  assert.deepEqual(Object.keys(result.changes), ["F-000001"]);
  assert.deepEqual(result.dropped.map((change) => change.id), ["F-000002", "F-000005"]);
});

test("status batch responses map to UI outcomes", () => {
  assert.deepEqual(interpretStatusBatchResponse(200, { fragments: [], commit: "x" }), { kind: "ok" });
  assert.deepEqual(interpretStatusBatchResponse(401, null), { kind: "unauthorized" });
  assert.deepEqual(
    interpretStatusBatchResponse(409, { error: "conflict", conflicts: ["F-000001", 3] }),
    { kind: "conflict", ids: ["F-000001"] },
  );
  assert.deepEqual(interpretStatusBatchResponse(409, { error: "conflict", conflicts: [] }), {
    kind: "conflict",
    ids: [],
  });
  assert.deepEqual(interpretStatusBatchResponse(404, { error: "missing", missing: ["F-000009"] }), {
    kind: "missing",
    ids: ["F-000009"],
  });
  assert.deepEqual(
    interpretStatusBatchResponse(422, { error: "invalid", invalid: [{ id: "F-000001", message: "bad" }, { nope: 1 }] }),
    { kind: "invalid", items: [{ id: "F-000001", message: "bad" }] },
  );
  assert.deepEqual(interpretStatusBatchResponse(400, { error: "沒有需要更新的狀態。" }), {
    kind: "error",
    message: statusBatchErrorMessages.badRequest,
  });
  // English server errors never reach the UI; status codes pick zh-TW text.
  assert.deepEqual(interpretStatusBatchResponse(502, { error: "GitHub write failed." }), {
    kind: "error",
    message: "寫入 GitHub 失敗，請稍後再試。",
  });
  assert.deepEqual(interpretStatusBatchResponse(500, { error: "Fragment status batch failed." }), {
    kind: "error",
    message: "寫入 GitHub 失敗，請稍後再試。",
  });
  assert.deepEqual(
    interpretStatusBatchResponse(503, { error: "GitHub Remote Store is not configured." }),
    { kind: "error", message: "GitHub Remote Store 尚未設定，無法儲存。" },
  );
  assert.deepEqual(interpretStatusBatchResponse(418, "oops"), {
    kind: "error",
    message: statusBatchErrorMessages.fallback,
  });
});

test("board draft round-trips pending changes per scope", () => {
  const a = editCard("F-000001", "inbox", "2026-10-05T09:30:00+08:00");
  const b = editCard("F-000002", "waiting");
  let changes: PendingChanges = {};
  changes = moveCard(changes, a, "active");
  changes = moveCard(changes, b, "archived");

  const draft = parseBoardDraft(serializeBoardDraft("work", changes));
  assert.equal(draft?.scope, "work");
  assert.deepEqual(draft?.changes, changes);
});

test("board draft parsing ignores malformed data", () => {
  assert.equal(parseBoardDraft(null), null);
  assert.equal(parseBoardDraft("not json"), null);
  assert.equal(parseBoardDraft(JSON.stringify({ changes: [] })), null);
  assert.equal(parseBoardDraft(JSON.stringify({ scope: "all", changes: {} })), null);

  const draft = parseBoardDraft(
    JSON.stringify({
      scope: "all",
      changes: [
        { id: "F-000001", title: "ok", from: "inbox", to: "active", expected_updated_at: "2026-10-05T00:00:00Z" },
        { id: "F-000002", title: "bad status", from: "inbox", to: "actionable", expected_updated_at: "2026-10-05T00:00:00Z" },
        { id: "F-000003", title: "no-op", from: "inbox", to: "inbox", expected_updated_at: "2026-10-05T00:00:00Z" },
        { id: "F-000004", title: "missing timestamp", from: "inbox", to: "done" },
        null,
      ],
    }),
  );
  assert.deepEqual(Object.keys(draft?.changes ?? {}), ["F-000001"]);
});

test("restored board draft is rebased: cards updated elsewhere are dropped", () => {
  const a = editCard("F-000001", "inbox", "2026-10-05T00:00:00Z");
  const b = editCard("F-000002", "inbox", "2026-10-05T00:00:00Z");
  let changes: PendingChanges = {};
  changes = moveCard(changes, a, "active");
  changes = moveCard(changes, b, "done");

  const draft = parseBoardDraft(serializeBoardDraft("all", changes));
  const rebased = rebasePendingChanges(draft?.changes ?? {}, [
    a,
    { ...b, updated_at: "2026-10-06T00:00:00Z" },
  ]);
  assert.deepEqual(Object.keys(rebased.changes), ["F-000001"]);
  assert.deepEqual(rebased.dropped.map((change) => change.id), ["F-000002"]);
});
