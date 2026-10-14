import "server-only";

export function isGitHubRemoteConfigured(): boolean {
  return Boolean(process.env.FRAGMENTHUB_GITHUB_TOKEN);
}
