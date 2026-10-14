import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { fragmentSchema, type Fragment } from "../lib/fragment-schema";
import { serializeFragment } from "../lib/fragments/local-store";
import {
  applyStatusBatch,
  planStatusBatch,
  prepareStatusReplacement,
  readLimitedJson,
  statusBatchCommitMessage,
  statusBatchRequestSchema,
  STATUS_BATCH_MAX_ATTEMPTS,
  type StatusBatchChange,
} from "../lib/fragments/status-batch";
import {
  createGitHubStatusBatchApi,
  type GitHubJsonRequester,
} from "../lib/github/status-batch-git";

const T0 = "2026-10-02T16:00:00+08:00";
const NOW = "2026-10-10T08:00:00.000Z";

function fragment(overrides: Partial<Fragment> = {}): Fragment {
  return fragmentSchema.parse({
    schema_version: "0.1",
    id: "F-000001",
    created_at: T0,
    updated_at: T0,
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
    ai: { classification_confirmed: true, interview_used: false },
    ...overrides,
  });
}

function change(id: string, status: Fragment["status"], expected = T0): StatusBatchChange {
  return { id, status, expected_updated_at: expected };
}

// ---------------------------------------------------------------------------
// Fake GitHub Git Data API (no network)
// ---------------------------------------------------------------------------

class FakeGitHubError extends Error {
  constructor(readonly status: number, body: string) {
    super(body);
  }
}

type TreeEntry = { mode: string; sha: string };
type Call = { method: string; pathname: string; body: unknown };

class FakeGitHub {
  private counter = 0;
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, Map<string, TreeEntry>>();
  readonly commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  head: string;
  readonly calls: Call[] = [];
  /** Called right before each PATCH ref; lets a test move the branch. */
  beforeRefUpdate: (() => void) | null = null;
  refUpdateStatusOverride: number | null = null;

  constructor(fragments: Fragment[]) {
    const files = new Map<string, TreeEntry>();
    files.set("README.md", { mode: "100644", sha: this.putBlob("readme\n") });
    files.set("data/fragments/.gitkeep", { mode: "100644", sha: this.putBlob("") });
    for (const item of fragments) {
      files.set(`data/fragments/${item.id}.json`, {
        mode: "100644",
        sha: this.putBlob(serializeFragment(item)),
      });
    }
    const tree = this.putTree(files);
    this.head = this.putCommit(tree, [], "initial");
  }

  private sha() {
    this.counter += 1;
    return this.counter.toString(16).padStart(40, "0");
  }

  putBlob(content: string) {
    const sha = this.sha();
    this.blobs.set(sha, content);
    return sha;
  }

  putTree(files: Map<string, TreeEntry>) {
    const sha = this.sha();
    this.trees.set(sha, new Map(files));
    return sha;
  }

  putCommit(tree: string, parents: string[], message: string) {
    const sha = this.sha();
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  /** Simulates someone else committing directly to the branch. */
  externalCommit(fragments: Fragment[] = []) {
    const files = new Map(this.trees.get(this.commits.get(this.head)!.tree)!);
    for (const item of fragments) {
      files.set(`data/fragments/${item.id}.json`, {
        mode: "100644",
        sha: this.putBlob(serializeFragment(item)),
      });
    }
    if (fragments.length === 0) {
      files.set(`notes-${this.counter}.txt`, { mode: "100644", sha: this.putBlob("x") });
    }
    this.head = this.putCommit(this.putTree(files), [this.head], "external");
  }

  headFiles() {
    return this.trees.get(this.commits.get(this.head)!.tree)!;
  }

  readFile(filePath: string) {
    const entry = this.headFiles().get(filePath);
    return entry ? this.blobs.get(entry.sha)! : undefined;
  }

  writeCalls() {
    return this.calls.filter((call) => call.method !== "GET");
  }

  readonly request: GitHubJsonRequester = async <T>(
    pathname: string,
    init: { method?: string; body?: string } = {},
  ): Promise<T> => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, pathname, body });

    const prefix = "/repos/EstherAIRP/FragmentHub";
    assert.ok(pathname.startsWith(prefix), `unexpected path ${pathname}`);
    const rest = pathname.slice(prefix.length);
    let match: RegExpExecArray | null;

    if (method === "GET" && rest === "/git/ref/heads/main") {
      return { object: { sha: this.head, type: "commit" } } as T;
    }
    if (method === "GET" && (match = /^\/git\/commits\/(\w+)$/.exec(rest))) {
      const commit = this.commits.get(match[1]);
      if (!commit) throw new FakeGitHubError(404, "no commit");
      return { sha: match[1], tree: { sha: commit.tree } } as T;
    }
    if (method === "GET" && (match = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(rest))) {
      const files = this.trees.get(match[1]);
      if (!files) throw new FakeGitHubError(404, "no tree");
      return {
        sha: match[1],
        truncated: false,
        tree: [
          { path: "data", mode: "040000", type: "tree", sha: "f".repeat(40) },
          { path: "data/fragments", mode: "040000", type: "tree", sha: "e".repeat(40) },
          ...[...files].map(([p, entry]) => ({ path: p, mode: entry.mode, type: "blob", sha: entry.sha })),
        ],
      } as T;
    }
    if (method === "GET" && (match = /^\/git\/blobs\/(\w+)$/.exec(rest))) {
      const content = this.blobs.get(match[1]);
      if (content === undefined) throw new FakeGitHubError(404, "no blob");
      return {
        sha: match[1],
        encoding: "base64",
        content: Buffer.from(content, "utf8").toString("base64").replace(/(.{60})/g, "$1\n"),
      } as T;
    }
    if (method === "POST" && rest === "/git/blobs") {
      assert.equal(body.encoding, "base64");
      return { sha: this.putBlob(Buffer.from(body.content, "base64").toString("utf8")) } as T;
    }
    if (method === "POST" && rest === "/git/trees") {
      const base = this.trees.get(body.base_tree);
      if (!base) throw new FakeGitHubError(422, "bad base_tree");
      const files = new Map(base);
      for (const entry of body.tree) {
        assert.equal(entry.type, "blob");
        files.set(entry.path, { mode: entry.mode, sha: entry.sha });
      }
      return { sha: this.putTree(files) } as T;
    }
    if (method === "POST" && rest === "/git/commits") {
      return { sha: this.putCommit(body.tree, body.parents, body.message) } as T;
    }
    if (method === "PATCH" && rest === "/git/refs/heads/main") {
      this.beforeRefUpdate?.();
      if (this.refUpdateStatusOverride !== null) {
        throw new FakeGitHubError(this.refUpdateStatusOverride, "forced failure");
      }
      assert.equal(body.force, false);
      const commit = this.commits.get(body.sha);
      if (!commit || commit.parents[0] !== this.head) {
        throw new FakeGitHubError(422, "Update is not a fast forward");
      }
      this.head = body.sha;
      return { object: { sha: body.sha } } as T;
    }

    throw new FakeGitHubError(404, `unhandled ${method} ${rest}`);
  };
}

function apiFor(github: FakeGitHub) {
  return createGitHubStatusBatchApi(
    { owner: "EstherAIRP", repo: "FragmentHub", branch: "main" },
    github.request,
  );
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test("status batch request accepts 1..50 unique valid changes", () => {
  const ok = statusBatchRequestSchema.safeParse({
    changes: [change("F-000001", "active"), change("F-000002", "done")],
  });
  assert.equal(ok.success, true);

  const fifty = Array.from({ length: 50 }, (_, i) =>
    change(`F-${String(i + 1).padStart(6, "0")}`, "active"),
  );
  assert.equal(statusBatchRequestSchema.safeParse({ changes: fifty }).success, true);
});

test("status batch request rejects malformed input", () => {
  const bad: unknown[] = [
    null,
    {},
    { changes: [] },
    { changes: "F-000001" },
    { changes: [change("F-1", "active")] },
    { changes: [change("../../etc/passwd", "active")] },
    { changes: [change("F-000001", "deleted" as Fragment["status"])] },
    { changes: [{ id: "F-000001", status: "active" }] },
    { changes: [change("F-000001", "active", "yesterday")] },
    { changes: [change("F-000001", "active"), change("F-000001", "done")] },
    {
      changes: Array.from({ length: 51 }, (_, i) =>
        change(`F-${String(i + 1).padStart(6, "0")}`, "active"),
      ),
    },
  ];

  for (const input of bad) {
    assert.equal(
      statusBatchRequestSchema.safeParse(input).success,
      false,
      JSON.stringify(input)?.slice(0, 80),
    );
  }
});

test("readLimitedJson enforces the body size cap and JSON syntax", async () => {
  const ok = await readLimitedJson(
    new Request("http://localhost/x", { method: "POST", body: '{"changes":[]}' }),
  );
  assert.deepEqual(ok, { ok: true, value: { changes: [] } });

  const big = await readLimitedJson(
    new Request("http://localhost/x", { method: "POST", body: "x".repeat(200) }),
    100,
  );
  assert.equal(big.ok, false);

  const declared = await readLimitedJson(
    new Request("http://localhost/x", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999" },
    }),
    100,
  );
  assert.equal(declared.ok, false);

  const broken = await readLimitedJson(
    new Request("http://localhost/x", { method: "POST", body: "{nope" }),
  );
  assert.equal(broken.ok, false);
});

// ---------------------------------------------------------------------------
// Planning (concurrency, missing, validation, preservation)
// ---------------------------------------------------------------------------

test("only status and updated_at differ after preparation", () => {
  const stored = fragment({
    status: "inbox",
    tags: ["a", "b"],
    notes: "keep me",
    original_input: "  original text with spacing  ",
    title: "Title",
    interview: [{ question: "q", answer: "a" }],
    ai: { classification_confirmed: true, interview_used: true },
  });
  const result = prepareStatusReplacement(stored, "done", NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.fragment.status, "done");
  assert.equal(result.fragment.updated_at, NOW);
  assert.deepEqual(
    { ...result.fragment, status: stored.status, updated_at: stored.updated_at },
    stored,
  );
  assert.deepEqual(Object.keys(result.fragment), Object.keys(stored));
  assert.equal(result.fragment.original_input, "  original text with spacing  ");
});

test("plan reports every missing id", () => {
  const plan = planStatusBatch(
    [change("F-000001", "active"), change("F-000009", "done"), change("F-000008", "done")],
    [fragment()],
    NOW,
  );
  assert.deepEqual(plan, { kind: "missing", missing: ["F-000009", "F-000008"] });
});

test("plan reports every stale expected_updated_at as a conflict", () => {
  const snapshot = [
    fragment({ id: "F-000001" }),
    fragment({ id: "F-000002", updated_at: "2026-10-05T00:00:00.000Z" }),
    fragment({ id: "F-000003", updated_at: "2026-10-06T00:00:00.000Z", status: "active" }),
  ];
  const plan = planStatusBatch(
    [change("F-000001", "active"), change("F-000002", "active"), change("F-000003", "active")],
    snapshot,
    NOW,
  );
  // F-000003 is a no-op but is still concurrency-checked.
  assert.deepEqual(plan, { kind: "conflict", conflicts: ["F-000002", "F-000003"] });
});

test("plan skips no-op files but returns them; all no-op is rejected", () => {
  const snapshot = [fragment({ id: "F-000001" }), fragment({ id: "F-000002", status: "active" })];

  const mixed = planStatusBatch(
    [change("F-000001", "done"), change("F-000002", "active")],
    snapshot,
    NOW,
  );
  assert.equal(mixed.kind, "ready");
  if (mixed.kind !== "ready") return;
  assert.deepEqual(mixed.writes.map((w) => w.path), ["data/fragments/F-000001.json"]);
  assert.deepEqual(mixed.results, [
    { id: "F-000001", status: "done", updated_at: NOW },
    { id: "F-000002", status: "active", updated_at: T0 },
  ]);
  assert.equal(mixed.writes[0].content, serializeFragment(mixed.writes[0].fragment));
  assert.ok(mixed.writes[0].content.endsWith("}\n"));

  assert.deepEqual(
    planStatusBatch([change("F-000002", "active")], snapshot, NOW),
    { kind: "noop" },
  );
});

test("semantic validation failure lists invalid fragments and writes nothing", () => {
  const snapshot = [
    fragment({ id: "F-000001" }),
    // Stored data that already violates the semantic validator.
    fragment({ id: "F-000002", related: ["F-000099"] }),
    fragment({ id: "F-000003", domains: ["not-a-registered-domain"] }),
  ];
  const plan = planStatusBatch(
    [change("F-000001", "done"), change("F-000002", "done"), change("F-000003", "done")],
    snapshot,
    NOW,
  );
  assert.equal(plan.kind, "invalid");
  if (plan.kind !== "invalid") return;
  assert.deepEqual(plan.invalid.map((item) => item.id), ["F-000002", "F-000003"]);
  assert.match(plan.invalid[0].message, /F-000099/);
  assert.match(plan.invalid[1].message, /not-a-registered-domain/);
});

test("schema failure (updated_at before created_at) is reported as invalid", () => {
  const snapshot = [fragment({ id: "F-000001", created_at: "2030-01-01T00:00:00.000Z", updated_at: "2030-01-01T00:00:00.000Z" })];
  const plan = planStatusBatch(
    [change("F-000001", "done", "2030-01-01T00:00:00.000Z")],
    snapshot,
    NOW,
  );
  assert.equal(plan.kind, "invalid");
});

test("commit message follows the data commit style", () => {
  assert.equal(
    statusBatchCommitMessage(["F-000001", "F-000004", "F-000007"]),
    "data: update status of 3 fragments (F-000001, F-000004, F-000007)",
  );
  assert.equal(
    statusBatchCommitMessage(["F-000001"]),
    "data: update status of 1 fragment (F-000001)",
  );
});

// ---------------------------------------------------------------------------
// Single-commit writer against the fake GitHub
// ---------------------------------------------------------------------------

test("all changed files land in one commit on top of the branch head", async () => {
  const stored = [
    fragment({ id: "F-000001" }),
    fragment({ id: "F-000002", status: "active" }),
    fragment({ id: "F-000003" }),
    fragment({ id: "F-000004", status: "waiting" }),
  ];
  const github = new FakeGitHub(stored);
  const startHead = github.head;
  const untouched = github.readFile("data/fragments/F-000003.json");

  const outcome = await applyStatusBatch(
    [change("F-000001", "active"), change("F-000002", "active"), change("F-000004", "done")],
    apiFor(github),
    { now: () => NOW },
  );

  assert.equal(outcome.kind, "committed");
  if (outcome.kind !== "committed") return;
  assert.equal(outcome.commit, github.head);
  assert.deepEqual(outcome.fragments, [
    { id: "F-000001", status: "active", updated_at: NOW },
    { id: "F-000002", status: "active", updated_at: T0 },
    { id: "F-000004", status: "done", updated_at: NOW },
  ]);

  const commit = github.commits.get(github.head)!;
  assert.deepEqual(commit.parents, [startHead]);
  assert.equal(commit.message, "data: update status of 2 fragments (F-000001, F-000004)");

  const writes = github.writeCalls();
  assert.deepEqual(
    writes.map((call) => `${call.method} ${call.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "")}`),
    ["POST /git/blobs", "POST /git/blobs", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main"],
  );
  const treeCall = writes[2].body as { base_tree: string; tree: Array<{ path: string; mode: string }> };
  assert.equal(treeCall.base_tree, github.commits.get(startHead)!.tree);
  assert.deepEqual(
    treeCall.tree.map((entry) => [entry.path, entry.mode]),
    [["data/fragments/F-000001.json", "100644"], ["data/fragments/F-000004.json", "100644"]],
  );

  const expected1 = serializeFragment({ ...stored[0], status: "active", updated_at: NOW });
  assert.equal(github.readFile("data/fragments/F-000001.json"), expected1);
  assert.equal(github.readFile("data/fragments/F-000003.json"), untouched);
  assert.equal(github.readFile("README.md"), "readme\n");
});

test("stale fragment returns a conflict without any write call", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" }), fragment({ id: "F-000002" })]);
  const startHead = github.head;

  const outcome = await applyStatusBatch(
    [change("F-000001", "done"), change("F-000002", "done", "2026-10-01T00:00:00.000Z")],
    apiFor(github),
    { now: () => NOW },
  );

  assert.deepEqual(outcome, { kind: "conflict", conflicts: ["F-000002"], reason: "stale" });
  assert.equal(github.writeCalls().length, 0);
  assert.equal(github.head, startHead);
});

test("missing and invalid outcomes write nothing", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001", related: ["F-000050"] })]);

  assert.deepEqual(
    await applyStatusBatch([change("F-000002", "done")], apiFor(github), { now: () => NOW }),
    { kind: "missing", missing: ["F-000002"] },
  );
  const invalid = await applyStatusBatch([change("F-000001", "done")], apiFor(github), { now: () => NOW });
  assert.equal(invalid.kind, "invalid");
  assert.equal(github.writeCalls().length, 0);
});

test("ref-update race with an unrelated commit is retried on the new head", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" })]);
  let moves = 0;
  github.beforeRefUpdate = () => {
    if (moves === 0) {
      moves += 1;
      github.externalCommit();
    }
  };
  const outcome = await applyStatusBatch([change("F-000001", "done")], apiFor(github), {
    now: () => NOW,
  });

  assert.equal(outcome.kind, "committed");
  const commit = github.commits.get(github.head)!;
  // The retried commit is parented on the external commit, not the stale head.
  assert.equal(github.commits.get(commit.parents[0])!.message, "external");
  assert.equal(commit.message, "data: update status of 1 fragment (F-000001)");
  assert.equal(
    github.writeCalls().filter((call) => call.method === "PATCH").length,
    2,
  );
});

test("ref-update race that changed a target re-checks concurrency and returns 409", async () => {
  const original = fragment({ id: "F-000001" });
  const github = new FakeGitHub([original, fragment({ id: "F-000002" })]);
  github.beforeRefUpdate = () => {
    github.beforeRefUpdate = null;
    github.externalCommit([{ ...original, status: "waiting", updated_at: "2026-10-09T00:00:00.000Z" }]);
  };
  const outcome = await applyStatusBatch(
    [change("F-000001", "done"), change("F-000002", "done")],
    apiFor(github),
    { now: () => NOW },
  );

  assert.deepEqual(outcome, { kind: "conflict", conflicts: ["F-000001"], reason: "stale" });
  assert.equal(github.commits.get(github.head)!.message, "external");
  assert.match(github.readFile("data/fragments/F-000001.json")!, /"waiting"/);
  assert.match(github.readFile("data/fragments/F-000002.json")!, /"inbox"/);
});

test("persistent branch movement stops after bounded retries with 409", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" })]);
  github.beforeRefUpdate = () => github.externalCommit();

  const outcome = await applyStatusBatch([change("F-000001", "done")], apiFor(github), {
    now: () => NOW,
  });

  assert.deepEqual(outcome, { kind: "conflict", conflicts: [], reason: "branch_moved" });
  assert.equal(
    github.writeCalls().filter((call) => call.method === "PATCH").length,
    STATUS_BATCH_MAX_ATTEMPTS,
  );
  assert.equal(STATUS_BATCH_MAX_ATTEMPTS, 3);
  assert.equal(github.commits.get(github.head)!.message, "external");
  assert.match(github.readFile("data/fragments/F-000001.json")!, /"inbox"/);
});

test("ref update rejected without the branch moving is an error, not a retry loop", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" })]);
  github.refUpdateStatusOverride = 422;

  await assert.rejects(
    applyStatusBatch([change("F-000001", "done")], apiFor(github), { now: () => NOW }),
    /without the branch moving/,
  );
  assert.equal(github.writeCalls().filter((call) => call.method === "PATCH").length, 1);
});

test("non-race GitHub errors propagate", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" })]);
  github.refUpdateStatusOverride = 403;

  await assert.rejects(
    applyStatusBatch([change("F-000001", "done")], apiFor(github), { now: () => NOW }),
    (error: unknown) => (error as { status?: number }).status === 403,
  );
});

test("a fragment file whose content id differs from its path is refused", async () => {
  const github = new FakeGitHub([fragment({ id: "F-000001" })]);
  const files = new Map(github.headFiles());
  files.set("data/fragments/F-000002.json", {
    mode: "100644",
    sha: github.putBlob(serializeFragment(fragment({ id: "F-000003" }))),
  });
  github.head = github.putCommit(github.putTree(files), [github.head], "bad");

  await assert.rejects(
    applyStatusBatch([change("F-000001", "done")], apiFor(github), { now: () => NOW }),
    /different ID/,
  );
  assert.equal(github.writeCalls().length, 0);
});

test("adapter refuses tree entries outside data/fragments", async () => {
  const github = new FakeGitHub([fragment()]);
  const api = apiFor(github);
  const head = await api.readHead();

  await assert.rejects(
    api.createTree(head.treeSha, [{ path: "public/leak.json", mode: "100644", sha: "a".repeat(40) }]),
    /outside data\/fragments/,
  );
});

// ---------------------------------------------------------------------------
// Route wiring (static: the route cannot be imported outside Next)
// ---------------------------------------------------------------------------

test("status-batch route authenticates before any other work", () => {
  const source = readFileSync(
    path.resolve(__dirname, "..", "app", "api", "fragments", "status-batch", "route.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export async function POST"));
  const firstStatement = body.slice(body.indexOf("{") + 1).trimStart();
  assert.match(firstStatement, /^if \(!\(await isAuthenticated\(\)\)\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized\." \}, \{ status: 401 \}\);/);
  assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/);
});
