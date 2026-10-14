import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export type ExpiringPayload = {
  exp: number;
};

/**
 * Name of the signed session cookie. Kept here (dependency-free) so the
 * proxy and lib/auth.ts can never disagree about it.
 */
export function sessionCookieNameFor(nodeEnv: string | undefined): string {
  return nodeEnv === "production"
    ? "__Host-fragmenthub_session"
    : "fragmenthub_session";
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signPayload(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

export function verifyPayload<T extends ExpiringPayload>(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): T | null {
  if (!token) return null;

  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;

    const expected = createHmac("sha256", secret)
      .update(body)
      .digest("base64url");

    if (!safeEqual(signature, expected)) return null;

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as T;

    if (
      !payload ||
      typeof payload !== "object" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function parseAllowedGitHubIds(value: string): Set<string> {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return new Set();
  }

  for (const id of parts) {
    if (!/^\d+$/.test(id)) {
      throw new Error(
        "FRAGMENTHUB_ALLOWED_GITHUB_IDS must contain only comma-separated numeric GitHub user IDs.",
      );
    }
  }

  return new Set(parts);
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

export function constantTimeEqual(
  left: string,
  right: string,
): boolean {
  return safeEqual(left, right);
}
