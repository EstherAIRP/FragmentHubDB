/**
 * Runtime storage selection. Never silently fall back from MongoDB to GitHub
 * or local files when an explicitly selected backend is unavailable.
 */
export type FragmentBackend = "mongodb" | "github" | "local";

export function fragmentBackend(): FragmentBackend {
  const selected = process.env.FragmentHubDB_DATA_STORE;
  if (selected === "mongodb" || selected === "github" || selected === "local") {
    return selected;
  }
  if (selected) {
    throw new Error("Invalid FragmentHubDB_DATA_STORE; expected mongodb, github, or local.");
  }
  // Backward compatible until the account owner explicitly enables MongoDB.
  return process.env.FragmentHubDB_GITHUB_TOKEN ? "github" : "local";
}

export function isFragmentWriteConfigured(): boolean {
  switch (fragmentBackend()) {
    case "mongodb":
      return Boolean(
        process.env.FragmentHubDB_MONGODB_URI || process.env.MONGODB_URI,
      );
    case "github":
      return Boolean(process.env.FragmentHubDB_GITHUB_TOKEN);
    case "local":
      return false;
  }
}
