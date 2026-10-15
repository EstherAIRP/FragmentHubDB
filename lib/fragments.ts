import "server-only";

import type { Fragment } from "@/lib/fragment-schema";
import {
  getLocalFragment,
  listLocalFragments,
} from "@/lib/fragments/local-store";
import { fragmentBackend } from "@/lib/fragments/backend";
import { logSafeStorageError } from "@/lib/security/storage-log";
import {
  getGitHubFragment,
  listGitHubFragments,
} from "@/lib/github/fragment-store";
import {
  getMongoFragment,
  listMongoFragments,
} from "@/lib/mongodb/fragment-store";

/**
 * Read only from the selected source. An unavailable MongoDB connection
 * must fail rather than silently displaying stale JSON from GitHub.
 */
export async function listFragments(): Promise<Fragment[]> {
  switch (fragmentBackend()) {
    case "mongodb":
      try {
        return await listMongoFragments();
      } catch (error) {
        logSafeStorageError("fragment_list", error);
        throw new Error("Fragment data unavailable.");
      }
    case "github":
      return listGitHubFragments();
    case "local":
      return listLocalFragments();
  }
}

export async function getFragment(id: string): Promise<Fragment | null> {
  switch (fragmentBackend()) {
    case "mongodb":
      try {
        return await getMongoFragment(id);
      } catch (error) {
        logSafeStorageError("fragment_detail", error);
        throw new Error("Fragment data unavailable.");
      }
    case "github": {
      const stored = await getGitHubFragment(id);
      return stored?.fragment ?? null;
    }
    case "local":
      return getLocalFragment(id);
  }
}
