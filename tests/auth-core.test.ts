import assert from "node:assert/strict";
import test from "node:test";

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
