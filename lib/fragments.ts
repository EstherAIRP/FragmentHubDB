import "server-only";

import type { Fragment } from "@/lib/fragment-schema";
import {
  getLocalFragment,
  listLocalFragments,
} from "@/lib/fragments/local-store";
import { fragmentBackend } from "@/lib/fragments/backend";
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
      return listMongoFragments();
    case "github":
      return listGitHubFragments();
    case "local":
      return listLocalFragments();
  }
}

export async function getFragment(id: string): Promise<Fragment | null> {
  switch (fragmentBackend()) {
    case "mongodb":
      return getMongoFragment(id);
    case "github": {
      const stored = await getGitHubFragment(id);
      return stored?.fragment ?? null;
    }
    case "local":
      return getLocalFragment(id);
  }
}
