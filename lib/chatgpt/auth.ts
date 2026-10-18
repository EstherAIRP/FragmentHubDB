import { timingSafeEqual } from "node:crypto";

import { parseAllowedGitHubIds } from "@/lib/auth-core";

export function chatGptIntegrationConfig(): { token: string; ownerId: string } | null {
  const token = process.env.FragmentHubDB_CHATGPT_API_TOKEN ?? "";
  const ownerId = process.env.FragmentHubDB_CHATGPT_OWNER_GITHUB_ID ?? "";
  if (
    token.length < 32 ||
    !/^\d+$/.test(ownerId) ||
    !parseAllowedGitHubIds(process.env.FragmentHubDB_ALLOWED_GITHUB_IDS ?? "").has(ownerId)
  ) return null;
  return { token, ownerId };
}

/** Machine access grants proposal creation and read; NEVER human approval. */
export function isAuthorizedChatGptRequest(
  authorization: string | null,
  config = chatGptIntegrationConfig(),
): boolean {
  if (!config || !authorization?.startsWith("Bearer ")) return false;
  const candidate = authorization.slice(7);
  const expected = Buffer.from(config.token, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Browser approval must originate at this application's configured origin. */
export function isSameOriginApproval(
  origin: string | null,
  configuredPublicUrl: string | undefined,
): boolean {
  if (!origin || !configuredPublicUrl) return false;
  try {
    const expected = new URL(configuredPublicUrl);
    const received = new URL(origin);
    return (
      ["http:", "https:"].includes(expected.protocol) &&
      received.origin === expected.origin &&
      received.username === "" &&
      received.password === ""
    );
  } catch { return false; }
}
