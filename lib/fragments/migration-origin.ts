/**
 * Fail closed when a MongoDB import is launched from any unexpected Git clone.
 * This protects against importing similarly named but unrelated projects.
 */
export const FRAGMENTHUBDB_REPOSITORY = "EstherAIRP/FragmentHubDB";

export function assertFragmentHubDbOrigin(origin: string): void {
  const normalized = origin.trim();
  const allowed =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)EstherAIRP\/FragmentHubDB(?:\.git)?\/?$/i;
  if (!allowed.test(normalized)) {
    throw new Error(
      "Refusing MongoDB import: git origin must be " +
        FRAGMENTHUBDB_REPOSITORY +
        " (found " +
        JSON.stringify(normalized) +
        ").",
    );
  }
}
