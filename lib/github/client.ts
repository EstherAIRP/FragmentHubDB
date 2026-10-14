import "server-only";

export type GitHubClientConfig = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
};

export class GitHubApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`GitHub API request failed with status ${status}.`);
    this.name = "GitHubApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function getGitHubConfigFromEnv(): GitHubClientConfig {
  const repository =
    process.env.FragmentHubDB_GITHUB_REPOSITORY ?? "EstherAIRP/FragmentHubDB";
  const [owner, repo] = repository.split("/");
  const token = process.env.FragmentHubDB_GITHUB_TOKEN;
  const branch = process.env.FragmentHubDB_GITHUB_BRANCH ?? "main";

  if (!owner || !repo) {
    throw new Error(
      "FragmentHubDB_GITHUB_REPOSITORY must use owner/repository format.",
    );
  }

  if (!token) {
    throw new Error("FragmentHubDB_GITHUB_TOKEN is not configured.");
  }

  return { owner, repo, branch, token };
}

export async function githubRequest<T>(
  config: GitHubClientConfig,
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FragmentHubDB",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GitHubApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function encodeBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function decodeBase64Utf8(value: string): string {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}
