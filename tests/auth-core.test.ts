import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isTrustedBrowserMutation } from "../lib/security/browser-mutation";
import { logSafeStorageError } from "../lib/security/storage-log";

import {
  constantTimeEqual,
  createPkceChallenge,
  parseAllowedGitHubIds,
  signPayload,
  verifyPayload,
} from "../lib/auth-core";

test("signed auth payload verifies before expiration", () => {
  const now = 1_000_000;
  const token = signPayload(
    {
      exp: now + 60_000,
      id: "23609979",
      login: "example",
    },
    "01234567890123456789012345678901",
  );

  const payload = verifyPayload<{
    exp: number;
    id: string;
    login: string;
  }>(
    token,
    "01234567890123456789012345678901",
    now,
  );

  assert.equal(payload?.id, "23609979");
  assert.equal(payload?.login, "example");
});

test("tampered signed auth payload is rejected", () => {
  const secret = "01234567890123456789012345678901";
  const token = signPayload(
    {
      exp: Date.now() + 60_000,
      id: "1",
    },
    secret,
  );

  const tampered = `${token.slice(0, -1)}x`;

  assert.equal(verifyPayload(tampered, secret), null);
});

test("expired signed auth payload is rejected", () => {
  const secret = "01234567890123456789012345678901";
  const token = signPayload(
    {
      exp: 999,
      id: "1",
    },
    secret,
  );

  assert.equal(verifyPayload(token, secret, 1_000), null);
});

test("GitHub allowlist uses numeric IDs and deduplicates", () => {
  const ids = parseAllowedGitHubIds("23609979, 12345678,23609979");

  assert.deepEqual([...ids], ["23609979", "12345678"]);
});

test("GitHub allowlist rejects mutable login-style values", () => {
  assert.throws(() =>
    parseAllowedGitHubIds("23609979,EstherAIRP"),
  );
});

test("PKCE S256 challenge is deterministic and base64url", () => {
  const verifier =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const challenge = createPkceChallenge(verifier);

  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge.length, 43);
  assert.equal(challenge, createPkceChallenge(verifier));
});

test("constant-time helper matches equal strings only", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("browser session mutation rejects foreign, missing or malformed Origin", () => {
  const site = "https://fragmenthubdb.example";
  const req = (origin: string | null, fetchSite: string | null = "same-origin", url = site + "/api/fragments") =>
    new Request(url, { method: "POST", headers: {
      ...(origin === null ? {} : { Origin: origin }),
      ...(fetchSite === null ? {} : { "Sec-Fetch-Site": fetchSite }),
    } });
  assert.equal(isTrustedBrowserMutation(req(site), site, "production"), true);
  assert.equal(isTrustedBrowserMutation(req(site, null), site, "production"), true);
  assert.equal(isTrustedBrowserMutation(req(site, "none"), site, "production"), true);
  for (const bad of [null, "null", "https://bad.example", site + ".evil.test",
    "http://fragmenthubdb.example", site + "/", site + "?foo=bar"]) {
    assert.equal(isTrustedBrowserMutation(req(bad), site, "production"), false);
  }
  for (const bad of ["cross-site", "same-site", "invalid"]) {
    assert.equal(isTrustedBrowserMutation(req(site, bad), site, "production"), false);
  }
  // Reverse-proxy ingress may have a different hostname; the Origin remains pinned.
  assert.equal(isTrustedBrowserMutation(req(site, "same-origin", "http://127.0.0.1:3100/api/fragments"), site, "production"), true);
  assert.equal(isTrustedBrowserMutation(req(site), undefined, "production"), false);
  const dev = new Request("http://localhost:3000/api/fragments", {
    method: "POST", headers: { Origin: "http://localhost:3000" },
  });
  assert.equal(isTrustedBrowserMutation(dev, undefined, "development"), true);
  assert.equal(isTrustedBrowserMutation(dev, undefined, "production"), false);
});

test("browser-only mutation routes require origin gate; bearer proposal route stays distinct", () => {
  for (const file of [
    "app/api/fragments/route.ts",
    "app/api/fragments/[id]/route.ts",
    "app/api/fragments/status-batch/route.ts",
    "app/api/auth/logout/route.ts",
    "app/api/auth/session/route.ts",
    "app/api/chatgpt/proposals/[id]/approve/route.ts",
  ]) {
    const code = readFileSync(path.resolve(__dirname, "..", file), "utf8");
    assert.match(code, /isTrustedBrowserMutation\(request\)/, file);
    assert.match(code, /status: 403/, file);
  }
  const machine = readFileSync(path.resolve(__dirname, "../app/api/chatgpt/proposals/route.ts"), "utf8");
  assert.match(machine, /isAuthorizedChatGptRequest\(/);
  assert.doesNotMatch(machine, /isTrustedBrowserMutation\(/);
});

test("storage logger emits only allowlisted error codes, no embedded MongoDB URI", () => {
  const secret = "mongodb+srv://user:privatePassword@privateHost.invalid/";
  const error = Object.assign(new Error("Failed " + secret), {
    name: "MongoServerSelectionError",
    reason: { servers: new Map([["internalHost", { error: Object.assign(
      new Error("connection to " + secret), { code: "ETIMEDOUT" },
    ) }]]) },
  });
  const lines: unknown[][] = [];
  const previous = console.error;
  console.error = (...a: unknown[]) => { lines.push(a); };
  try {
    logSafeStorageError("fragment_list", error);
    logSafeStorageError("fragment_create", new Error("unclassified " + secret));
  } finally {
    console.error = previous;
  }
  const result = JSON.stringify(lines);
  assert.match(result, /NETWORK_ACCESS/);
  assert.match(result, /ATLAS_CHECK_FAILED/);
  assert.doesNotMatch(result, /privatePassword|privateHost|internalHost|mongodb\+srv/);
});
