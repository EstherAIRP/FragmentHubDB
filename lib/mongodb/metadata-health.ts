import { parseFragmentId } from "@/lib/fragments/id";
import type { Fragment } from "@/lib/fragment-schema";

export type MongoMetadata = {
  _id: "fragments";
  version: number;
  highest_allocated?: number;
};

/** Read-only consistency checks for the transaction coordination record. */
export function validateMongoMetadata(
  fragments: readonly Pick<Fragment, "id">[],
  metadata: MongoMetadata | null,
  strict: boolean,
): string[] {
  if (!metadata) {
    return strict
      ? ["MongoDB metadata/fragments transaction record is absent."]
      : [];
  }

  const issues: string[] = [];
  if (!Number.isSafeInteger(metadata.version) || metadata.version < 1) {
    issues.push("MongoDB metadata.version must be a positive integer.");
  }

  const highestStoredId = fragments.reduce(
    (highest, fragment) => Math.max(highest, parseFragmentId(fragment.id)),
    0,
  );

  if (metadata.highest_allocated === undefined) {
    if (strict) issues.push("MongoDB metadata.highest_allocated is not initialized.");
  } else if (
    !Number.isSafeInteger(metadata.highest_allocated) ||
    metadata.highest_allocated < highestStoredId ||
    metadata.highest_allocated > 999999
  ) {
    issues.push(
      "MongoDB metadata.highest_allocated must cover every existing Fragment ID.",
    );
  }
  return issues;
}
