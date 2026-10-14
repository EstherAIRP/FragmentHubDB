import "server-only";

export function isGitHubRemoteConfigured(): boolean {
  return Boolean(process.env.FragmentHubDB_GITHUB_TOKEN);
}
