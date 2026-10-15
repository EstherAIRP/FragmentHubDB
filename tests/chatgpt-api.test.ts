import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { chatGptIntegrationConfig, isAuthorizedChatGptRequest, isSameOriginApproval } from "../lib/chatgpt/auth";
import { chatGptProposalRequestSchema, PROPOSAL_TTL_MS } from "../lib/chatgpt/proposal-schema";

const fixture = {
  scope: "personal",
  type: "note",
  status: "inbox",
  priority: "none",
  urgency: "none",
  domains: [],
  tags: [],
  project: null,
  related: [],
  title: "AI-proposed Fragment",
  summary: "A pending proposal",
  next_action: null,
  original_input: "Keep this exact user input",
  notes: null,
  interview: [],
  source: { channel: "chatgpt" },
  ai: { classification_confirmed: true, interview_used: false },
};

test("ChatGPT bearer auth defaults to disabled and uses pinned owner allowlist", () => {
  const old = {
    token: process.env.FragmentHubDB_CHATGPT_API_TOKEN,
    owner: process.env.FragmentHubDB_CHATGPT_OWNER_GITHUB_ID,
    allowed: process.env.FragmentHubDB_ALLOWED_GITHUB_IDS,
  };
  try {
    delete process.env.FragmentHubDB_CHATGPT_API_TOKEN;
    delete process.env.FragmentHubDB_CHATGPT_OWNER_GITHUB_ID;
    assert.equal(chatGptIntegrationConfig(), null);
    assert.equal(isAuthorizedChatGptRequest("Bearer guess"), false);

    process.env.FragmentHubDB_CHATGPT_API_TOKEN = "x".repeat(64);
    process.env.FragmentHubDB_CHATGPT_OWNER_GITHUB_ID = "123456";
    process.env.FragmentHubDB_ALLOWED_GITHUB_IDS = "987654";
    assert.equal(chatGptIntegrationConfig(), null);

    process.env.FragmentHubDB_ALLOWED_GITHUB_IDS = "123456";
    assert.deepEqual(chatGptIntegrationConfig(), { token: "x".repeat(64), ownerId: "123456" });
    assert.equal(isAuthorizedChatGptRequest("Bearer " + "x".repeat(64)), true);
    assert.equal(isAuthorizedChatGptRequest("Bearer " + "x".repeat(63)), false);
    assert.equal(isAuthorizedChatGptRequest("Bearer " + "z".repeat(64)), false);
    assert.equal(isAuthorizedChatGptRequest("basic " + "x".repeat(64)), false);
    assert.equal(isAuthorizedChatGptRequest(null), false);
  } finally {
    for (const [key, value] of Object.entries({
      FragmentHubDB_CHATGPT_API_TOKEN: old.token,
      FragmentHubDB_CHATGPT_OWNER_GITHUB_ID: old.owner,
      FragmentHubDB_ALLOWED_GITHUB_IDS: old.allowed,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("human approval blocks missing, cross-origin and malformed browser origins", () => {
  const site = "https://fragmenthubdb.example";
  assert.equal(isSameOriginApproval(site, site), true);
  assert.equal(isSameOriginApproval(null, site), false);
  assert.equal(isSameOriginApproval("https://evil.example", site), false);
  assert.equal(isSameOriginApproval("https://fragmenthubdb.example.evil.test", site), false);
  assert.equal(isSameOriginApproval("http://fragmenthubdb.example", site), false);
  assert.equal(isSameOriginApproval(site, undefined), false);
});

test("ChatGPT proposals preserve user input and reject forged extra fields", () => {
  assert.equal(chatGptProposalRequestSchema.safeParse({ draft: fixture }).success, true);
  assert.equal(chatGptProposalRequestSchema.safeParse({
    draft: { ...fixture, source: { channel: "web" } },
  }).success, false);
  assert.equal(chatGptProposalRequestSchema.safeParse({
    draft: { ...fixture, ai: { ...fixture.ai, classification_confirmed: false } },
  }).success, false);
  assert.equal(chatGptProposalRequestSchema.safeParse({
    draft: fixture, approved: true,
  }).success, false);
  assert.equal(PROPOSAL_TTL_MS, 30 * 60 * 1000);
});

test("only the browser owner route can call the canonical approval function", () => {
  const app = process.cwd();
  const route = readFileSync(path.join(app, "app/api/chatgpt/proposals/[id]/approve/route.ts"), "utf8");
  assert.match(route, /getCurrentSession\(/);
  assert.match(route, /session\.id !== config\.ownerId/);
  assert.match(route, /isSameOriginApproval\(/);
  assert.match(route, /approveChatGptProposal\(/);

  for (const file of [
    "app/api/chatgpt/fragments/route.ts",
    "app/api/chatgpt/fragments/[id]/route.ts",
    "app/api/chatgpt/proposals/route.ts",
    "app/api/chatgpt/proposals/[id]/route.ts",
  ]) {
    const source = readFileSync(path.join(app, file), "utf8");
    assert.match(source, /isAuthorizedChatGptRequest\(/);
    assert.doesNotMatch(source, /approveChatGptProposal\(/);
  }
});
