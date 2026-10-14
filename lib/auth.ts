import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  constantTimeEqual,
  createPkceChallenge,
  parseAllowedGitHubIds,
  sessionCookieNameFor,
  signPayload,
  verifyPayload,
  type ExpiringPayload,
} from "@/lib/auth-core";

const SESSION_SECONDS = 60 * 60 * 24 * 7;
const FLOW_SECONDS = 60 * 10;

function sessionCookieName() {
  return sessionCookieNameFor(process.env.NODE_ENV);
}

function flowCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-fragmenthub_oauth"
    : "fragmenthub_oauth";
}

type OAuthFlow = ExpiringPayload & {
  state: string;
  verifier: string;
};

export type AuthSession = ExpiringPayload & {
  id: string;
  login: string;
  avatarUrl: string;
};

export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
  allowedGitHubIds: Set<string>;
};

export type AuthConfigIssue = {
  variable: string;
  message: string;
};

export function getAuthConfigIssues(): AuthConfigIssue[] {
  const issues: AuthConfigIssue[] = [];

  const clientId = process.env.FRAGMENTHUB_GITHUB_CLIENT_ID?.trim() ?? "";
  const clientSecret =
    process.env.FRAGMENTHUB_GITHUB_CLIENT_SECRET?.trim() ?? "";
  const publicUrl = process.env.FRAGMENTHUB_PUBLIC_URL?.trim() ?? "";
  const sessionSecret =
    process.env.FRAGMENTHUB_SESSION_SECRET?.trim() ?? "";
  const allowedIds =
    process.env.FRAGMENTHUB_ALLOWED_GITHUB_IDS?.trim() ?? "";

  if (!clientId) {
    issues.push({
      variable: "FRAGMENTHUB_GITHUB_CLIENT_ID",
      message: "未設定 GitHub OAuth Client ID。",
    });
  }

  if (!clientSecret) {
    issues.push({
      variable: "FRAGMENTHUB_GITHUB_CLIENT_SECRET",
      message: "未設定 GitHub OAuth Client Secret。",
    });
  }

  if (!publicUrl) {
    issues.push({
      variable: "FRAGMENTHUB_PUBLIC_URL",
      message: "未設定正式網站 URL。",
    });
  } else {
    try {
      parsePublicUrl(publicUrl);
    } catch (error) {
      issues.push({
        variable: "FRAGMENTHUB_PUBLIC_URL",
        message:
          error instanceof Error ? error.message : "Public URL 格式不正確。",
      });
    }
  }

  if (sessionSecret.length < 32) {
    issues.push({
      variable: "FRAGMENTHUB_SESSION_SECRET",
      message: "至少需要 32 個字元。",
    });
  }

  if (!allowedIds) {
    issues.push({
      variable: "FRAGMENTHUB_ALLOWED_GITHUB_IDS",
      message: "未設定允許登入的 numeric GitHub user ID。",
    });
  } else {
    try {
      const parsed = parseAllowedGitHubIds(allowedIds);
      if (parsed.size === 0) {
        issues.push({
          variable: "FRAGMENTHUB_ALLOWED_GITHUB_IDS",
          message: "至少需要一個 numeric GitHub user ID。",
        });
      }
    } catch (error) {
      issues.push({
        variable: "FRAGMENTHUB_ALLOWED_GITHUB_IDS",
        message:
          error instanceof Error
            ? error.message
            : "GitHub user ID 格式不正確。",
      });
    }
  }

  return issues;
}

function parsePublicUrl(value: string): string {
  const url = new URL(value);

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "FRAGMENTHUB_PUBLIC_URL must be an origin without path, query, or credentials.",
    );
  }

  const production = process.env.NODE_ENV === "production";

  if (production && url.protocol !== "https:") {
    throw new Error("FRAGMENTHUB_PUBLIC_URL must use HTTPS in production.");
  }

  if (!production && !["http:", "https:"].includes(url.protocol)) {
    throw new Error("FRAGMENTHUB_PUBLIC_URL must use HTTP or HTTPS.");
  }

  return url.origin;
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig {
  const clientId = process.env.FRAGMENTHUB_GITHUB_CLIENT_ID?.trim() ?? "";
  const clientSecret =
    process.env.FRAGMENTHUB_GITHUB_CLIENT_SECRET?.trim() ?? "";
  const publicUrlRaw = process.env.FRAGMENTHUB_PUBLIC_URL?.trim() ?? "";
  const sessionSecret =
    process.env.FRAGMENTHUB_SESSION_SECRET?.trim() ?? "";
  const allowedGitHubIds = parseAllowedGitHubIds(
    process.env.FRAGMENTHUB_ALLOWED_GITHUB_IDS ?? "",
  );

  if (!clientId) {
    throw new Error("FRAGMENTHUB_GITHUB_CLIENT_ID is not configured.");
  }

  if (!clientSecret) {
    throw new Error("FRAGMENTHUB_GITHUB_CLIENT_SECRET is not configured.");
  }

  if (!publicUrlRaw) {
    throw new Error("FRAGMENTHUB_PUBLIC_URL is not configured.");
  }

  if (sessionSecret.length < 32) {
    throw new Error(
      "FRAGMENTHUB_SESSION_SECRET must contain at least 32 characters.",
    );
  }

  if (allowedGitHubIds.size === 0) {
    throw new Error("FRAGMENTHUB_ALLOWED_GITHUB_IDS is not configured.");
  }

  return {
    clientId,
    clientSecret,
    publicUrl: parsePublicUrl(publicUrlRaw),
    sessionSecret,
    allowedGitHubIds,
  };
}

export function isAuthConfigured(): boolean {
  return getAuthConfigIssues().length === 0;
}

export function callbackUrl(config = getGitHubOAuthConfig()): string {
  return new URL("/api/auth/callback", config.publicUrl).toString();
}

export function createOAuthFlow(
  config = getGitHubOAuthConfig(),
): {
  authorizeUrl: string;
  cookie: ReturnType<typeof createFlowCookie>;
} {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createPkceChallenge(verifier);

  const flow: OAuthFlow = {
    state,
    verifier,
    exp: Date.now() + FLOW_SECONDS * 1000,
  };

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl(config));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("allow_signup", "false");

  return {
    authorizeUrl: authorizeUrl.toString(),
    cookie: createFlowCookie(signPayload(flow, config.sessionSecret)),
  };
}

export function verifyOAuthFlow(
  token: string | undefined,
  state: string,
  config = getGitHubOAuthConfig(),
): OAuthFlow | null {
  const flow = verifyPayload<OAuthFlow>(token, config.sessionSecret);

  if (
    !flow ||
    typeof flow.state !== "string" ||
    typeof flow.verifier !== "string" ||
    !state ||
    !constantTimeEqual(flow.state, state)
  ) {
    return null;
  }

  return flow;
}

type GitHubTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeGitHubCode(
  code: string,
  verifier: string,
  config = getGitHubOAuthConfig(),
): Promise<string> {
  const response = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "FragmentHub",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: callbackUrl(config),
        code_verifier: verifier,
      }),
      cache: "no-store",
    },
  );

  const payload = (await response
    .json()
    .catch(() => ({}))) as GitHubTokenResponse;

  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "GitHub OAuth code exchange failed.",
    );
  }

  return payload.access_token;
}

type GitHubIdentityResponse = {
  id?: number;
  login?: string;
  avatar_url?: string | null;
};

export async function fetchGitHubIdentity(
  accessToken: string,
): Promise<{
  id: string;
  login: string;
  avatarUrl: string;
}> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FragmentHub",
    },
    cache: "no-store",
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as GitHubIdentityResponse;

  if (
    !response.ok ||
    !Number.isInteger(payload.id) ||
    typeof payload.login !== "string"
  ) {
    throw new Error("Could not verify GitHub identity.");
  }

  return {
    id: String(payload.id),
    login: payload.login,
    avatarUrl:
      typeof payload.avatar_url === "string" ? payload.avatar_url : "",
  };
}

export function isAllowedGitHubIdentity(
  id: string,
  config = getGitHubOAuthConfig(),
): boolean {
  return config.allowedGitHubIds.has(id);
}

export function createSessionCookie(
  identity: {
    id: string;
    login: string;
    avatarUrl: string;
  },
  config = getGitHubOAuthConfig(),
) {
  const session: AuthSession = {
    ...identity,
    exp: Date.now() + SESSION_SECONDS * 1000,
  };

  return {
    name: sessionCookieName(),
    value: signPayload(session, config.sessionSecret),
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_SECONDS,
    },
  };
}

function createFlowCookie(value: string) {
  return {
    name: flowCookieName(),
    value,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: FLOW_SECONDS,
    },
  };
}

export function expiredFlowCookie() {
  return {
    name: flowCookieName(),
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    },
  };
}

export function expiredSessionCookie() {
  return {
    name: sessionCookieName(),
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    },
  };
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  // Read cookies before any early return: this opts every caller into
  // request-time rendering, so a private route can never be prerendered
  // (with Fragment data baked in) when auth env vars are missing at build.
  const store = await cookies();

  if (!isAuthConfigured()) return null;

  const config = getGitHubOAuthConfig();
  const token = store.get(sessionCookieName())?.value;
  const session = verifyPayload<AuthSession>(token, config.sessionSecret);

  if (
    !session ||
    typeof session.id !== "string" ||
    typeof session.login !== "string" ||
    typeof session.avatarUrl !== "string" ||
    !config.allowedGitHubIds.has(session.id)
  ) {
    return null;
  }

  return session;
}

/**
 * Authorization gate for private pages. Must be the first statement of every
 * app/(private)/**\/page.tsx, before any Fragment data access: Next.js renders
 * page segments in parallel with their layout, so a redirect in the layout
 * alone does not stop the page from rendering and serializing its data.
 */
export async function requireSession(): Promise<AuthSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getCurrentSession());
}

export function oauthFlowCookieName(): string {
  return flowCookieName();
}
