import "server-only";

import type { Fragment } from "@/lib/fragment-schema";
import {
  getLocalFragment,
  listLocalFragments,
} from "@/lib/fragments/local-store";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import {
  getGitHubFragment,
  listGitHubFragments,
} from "@/lib/github/fragment-store";

export async function listFragments(): Promise<Fragment[]> {
  if (isGitHubRemoteConfigured()) {
    return listGitHubFragments();
  }

  return listLocalFragments();
}

export async function getFragment(id: string): Promise<Fragment | null> {
  if (isGitHubRemoteConfigured()) {
    const stored = await getGitHubFragment(id);
    return stored?.fragment ?? null;
  }

  return getLocalFragment(id);
}
