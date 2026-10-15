import assert from "node:assert/strict";
import test from "node:test";

import { sessionCookieNameFor, signPayload } from "../lib/auth-core";

const BASE = "http://127.0.0.1:3100";
const PUBLIC_ORIGIN = "https://fragmenthubdb-ci.test";
const API_TOKEN = "fragmenthubdb_ci_test_token_0123456789abcdef0123456789abcdef";
const OWNER = "123456";

const draft = {
  scope: "personal",
  type: "note",
  status: "inbox",
  priority: "none",
  urgency: "none",
  domains: ["software-development"],
  tags: ["mongodb"],
  project: null,
  related: [],
  title: "CI HTTP approval smoke test",
  summary: "Test Next.js routes with real MongoDB",
  next_action: null,
  original_input: "  Preserve original input including spaces  ",
  notes: null,
  interview: [],
  source: { channel: "chatgpt" },
  ai: { classification_confirmed: true, interview_used: false },
};

function machineHeaders() {
  return {
    Authorization: `Bearer ${API_TOKEN}`,
  };
}

test("HTTP: machine can read and propose but only a valid browser session may approve", async () => {
  const unauth = await fetch(BASE + "/api/chatgpt/fragments");
  assert.equal(unauth.status, 401);

  const metadata = await fetch(BASE + "/api/chatgpt/metadata", {
    headers: machineHeaders(),
  });
  assert.equal(metadata.status, 200);
  assert.equal(metadata.headers.get("cache-control")?.includes("no-store"), true);

  const list = await fetch(BASE + "/api/chatgpt/fragments?limit=2", {
    headers: machineHeaders(),
  });
  assert.equal(list.status, 200);
  const data = await list.json() as { items: unknown[]; total: number };
  assert.equal(data.items.length <= 2, true);
  assert.ok(data.total > 0);

  const wrongSource = await fetch(BASE + "/api/chatgpt/proposals", {
    method: "POST",
    headers: { ...machineHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ draft: { ...draft, source: { channel: "web" } } }),
  });
  assert.equal(wrongSource.status, 400);

  const missingAuth = await fetch(BASE + "/api/chatgpt/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  assert.equal(missingAuth.status, 401);

  const preview = await fetch(BASE + "/api/chatgpt/proposals", {
    method: "POST",
    headers: { ...machineHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const proposed = await preview.json() as {
    proposal_id?: string;
    review_url?: string;
    status?: string;
  };
  assert.equal(preview.status, 201, JSON.stringify(proposed));
  assert.equal(proposed.status, "pending");
  assert.ok(proposed.review_url?.startsWith(PUBLIC_ORIGIN + "/chatgpt/review/"));
  const proposalId = proposed.proposal_id!;

  const poll = async () => {
    const r = await fetch(BASE + `/api/chatgpt/proposals/${proposalId}`, {
      headers: machineHeaders(),
    });
    assert.equal(r.status, 200);
    return r.json() as Promise<{ status: string; fragment_id: string | null }>;
  };
  assert.equal((await poll()).status, "pending");

  const unauthenticatedApproval = await fetch(
    BASE + `/api/chatgpt/proposals/${proposalId}/approve`,
    { method: "POST", redirect: "manual", headers: { Origin: PUBLIC_ORIGIN } },
  );
  assert.equal(unauthenticatedApproval.status, 401);

  const secret = process.env.FragmentHubDB_SESSION_SECRET!;
  const signed = signPayload({
    id: OWNER,
    login: "ci-user",
    avatarUrl: "",
    exp: Date.now() + 10 * 60 * 1000,
  }, secret);
  const cookie = `${sessionCookieNameFor("production")}=${signed}`;

  const wrongOrigin = await fetch(
    BASE + `/api/chatgpt/proposals/${proposalId}/approve`,
    {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie, Origin: "https://attacker.invalid" },
    },
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await poll()).status, "pending");

  const approved = await fetch(
    BASE + `/api/chatgpt/proposals/${proposalId}/approve`,
    {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
    },
  );
  assert.equal(approved.status, 303);
  const next = await poll();
  assert.equal(next.status, "committed");
  assert.match(next.fragment_id ?? "", /^F-\d{6}$/);
  assert.equal(approved.headers.get("location"), PUBLIC_ORIGIN + "/fragments/" + next.fragment_id);

  const fragmentResponse = await fetch(
    BASE + `/api/chatgpt/fragments/${next.fragment_id}`,
    { headers: machineHeaders() },
  );
  assert.equal(fragmentResponse.status, 200);
  const body = await fragmentResponse.json() as {
    fragment: { original_input: string; source: { channel: string } };
  };
  assert.equal(body.fragment.original_input, draft.original_input);
  assert.equal(body.fragment.source.channel, "chatgpt");

  const replay = await fetch(
    BASE + `/api/chatgpt/proposals/${proposalId}/approve`,
    {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
    },
  );
  assert.equal(replay.status, 409);
});
