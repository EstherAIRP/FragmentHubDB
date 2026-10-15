/** Hard project boundary for the legacy GitHub Fragment store. */
export const FRAGMENTHUBDB_CANONICAL_REPOSITORY = "EstherAIRP/FragmentHubDB";

export function fragmentHubDbGitHubRepository(configured?: string): {
  owner: "EstherAIRP";
  repo: "FragmentHubDB";
} {
  const repository = configured ?? FRAGMENTHUBDB_CANONICAL_REPOSITORY;
  if (repository !== FRAGMENTHUBDB_CANONICAL_REPOSITORY) {
    throw new Error(
      "Refusing GitHub Fragment storage access: " +
      "FragmentHubDB_GITHUB_REPOSITORY must be EstherAIRP/FragmentHubDB.",
    );
  }
  return { owner: "EstherAIRP", repo: "FragmentHubDB" };
}
