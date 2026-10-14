import { isDeepStrictEqual } from "node:util";

import type { Fragment } from "../fragment-schema";

/**
 * Pure, non-mutating reconciliation. All checks complete before the importer
 * is allowed to send its first write to Atlas.
 */
export type MongoImportPlan = {
  sourceCount: number;
  atlasCount: number;
  identicalCount: number;
  pending: Fragment[];
};

function indexUnique(fragments: readonly Fragment[], label: string): Map<string, Fragment> {
  const map = new Map<string, Fragment>();
  for (const item of fragments) {
    if (map.has(item.id)) {
      throw new Error("MongoDB import refused: duplicate " + label + " ID " + item.id + ".");
    }
    map.set(item.id, item);
  }
  return map;
}

export function planMongoImport(
  source: readonly Fragment[],
  atlas: readonly Fragment[],
): MongoImportPlan {
  if (source.length === 0) {
    throw new Error("MongoDB import refused: source has no Fragments.");
  }

  const sourceById = indexUnique(source, "source");
  const atlasById = indexUnique(atlas, "Atlas");

  for (const id of atlasById.keys()) {
    if (!sourceById.has(id)) {
      throw new Error(
        "MongoDB import refused: Atlas contains " + id +
        " which is not present in the selected source.",
      );
    }
  }

  const pending: Fragment[] = [];
  let identicalCount = 0;
  for (const fragment of source) {
    const stored = atlasById.get(fragment.id);
    if (!stored) {
      pending.push(fragment);
    } else if (isDeepStrictEqual(fragment, stored)) {
      identicalCount += 1;
    } else {
      throw new Error(
        "MongoDB import refused: Atlas version differs for " + fragment.id +
        "; existing data was not overwritten.",
      );
    }
  }

  return {
    sourceCount: source.length,
    atlasCount: atlas.length,
    identicalCount,
    pending,
  };
}
