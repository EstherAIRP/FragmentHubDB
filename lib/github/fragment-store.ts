import "server-only";

import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";
import type { NewFragment } from "@/lib/fragments/local-store";
import { nextFragmentId } from "@/lib/fragments/id";
import {
  assertFragmentSemantics,
  FragmentDataValidationError,
} from "@/lib/fragments/semantic-validator";
import { serializeFragment } from "@/lib/fragments/local-store";
import {
  applyStatusBatch,
  type StatusBatchChange,
  type StatusBatchOutcome,
} from "@/lib/fragments/status-batch";
import { createGitHubStatusBatchApi } from "@/lib/github/status-batch-git";
import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  getGitHubConfigFromEnv,
  githubRequest,
  GitHubApiError,
  type GitHubClientConfig,
} from "@/lib/github/client";

type GitHubContentFile = {
  type: "file";
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: "base64";
};

type GitTreeResponse = {
  truncated: boolean;
  tree: Array<{
    path: string;
    type: "blob" | "tree";
    sha: string;
  }>;
};

type PutContentResponse = {
  content: {
    sha: string;
    path: string;
  } | null;
  commit: {
    sha: string;
  };
};

export type GitHubStoredFragment = {
  fragment: Fragment;
  sha: string;
};

const directory = "data/fragments";

function contentPath(id: string) {
  return `${directory}/${id}.json`;
}

function apiPath(config: GitHubClientConfig, suffix: string) {
  return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}${suffix}`;
}

async function listFragmentPaths(config: GitHubClientConfig) {
  const tree = await githubRequest<GitTreeResponse>(
    config,
    apiPath(
      config,
      `/git/trees/${encodeURIComponent(config.branch)}?recursive=1`,
    ),
  );

  if (tree.truncated) {
    throw new Error(
      "GitHub tree response was truncated; FragmentHub cannot safely allocate IDs.",
    );
  }

  return tree.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        new RegExp(`^${directory}/F-\\d{6}\\.json$`).test(entry.path),
    )
    .map((entry) => entry.path)
    .sort();
}

export async function getGitHubFragment(
  id: string,
  config = getGitHubConfigFromEnv(),
): Promise<GitHubStoredFragment | null> {
  try {
    const file = await githubRequest<GitHubContentFile>(
      config,
      apiPath(
        config,
        `/contents/${contentPath(id)}?ref=${encodeURIComponent(config.branch)}`,
      ),
    );

    const fragment = fragmentSchema.parse(
      JSON.parse(decodeBase64Utf8(file.content)),
    );

    return { fragment, sha: file.sha };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function listGitHubFragments(
  config = getGitHubConfigFromEnv(),
): Promise<Fragment[]> {
  const paths = await listFragmentPaths(config);

  const fragments = await Promise.all(
    paths.map(async (path) => {
      const id = path.slice(directory.length + 1, -".json".length);
      const stored = await getGitHubFragment(id, config);

      if (!stored) {
        throw new Error(`Fragment disappeared while reading: ${id}`);
      }

      return stored.fragment;
    }),
  );

  return fragments.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createGitHubFragment(
  input: NewFragment,
  config = getGitHubConfigFromEnv(),
): Promise<GitHubStoredFragment> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await listGitHubFragments(config);
    const id = nextFragmentId(current.map((fragment) => fragment.id));
    const now = new Date().toISOString();
    const candidate = fragmentSchema.parse({
      ...input,
      id,
      created_at: now,
      updated_at: now,
    });

    assertFragmentSemantics(candidate, current);

    try {
      const response = await githubRequest<PutContentResponse>(
        config,
        apiPath(config, `/contents/${contentPath(id)}`),
        {
          method: "PUT",
          body: JSON.stringify({
            message: `data: create ${id} ${candidate.title}`,
            content: encodeBase64Utf8(serializeFragment(candidate)),
            branch: config.branch,
          }),
        },
      );

      if (!response.content) {
        throw new Error("GitHub did not return the created content SHA.");
      }

      return {
        fragment: candidate,
        sha: response.content.sha,
      };
    } catch (error) {
      if (
        error instanceof GitHubApiError &&
        (error.status === 409 || error.status === 422)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a unique Fragment ID after 10 attempts.");
}

export async function replaceGitHubFragment(
  id: string,
  replacement: Fragment,
  expectedSha: string,
  config = getGitHubConfigFromEnv(),
): Promise<GitHubStoredFragment> {
  const currentStored = await getGitHubFragment(id, config);

  if (!currentStored) {
    throw new Error(`Fragment ${id} does not exist.`);
  }

  if (currentStored.sha !== expectedSha) {
    throw new GitHubFragmentConflictError(
      `Fragment ${id} has changed on GitHub since it was loaded.`,
    );
  }

  const all = await listGitHubFragments(config);
  const candidate = fragmentSchema.parse({
    ...replacement,
    id: currentStored.fragment.id,
    created_at: currentStored.fragment.created_at,
    updated_at: new Date().toISOString(),
  });

  assertFragmentSemantics(
    candidate,
    all.filter((fragment) => fragment.id !== id),
    { previous: currentStored.fragment },
  );

  if (
    currentStored.fragment.type === "project" &&
    candidate.type !== "project"
  ) {
    const projectChildren = all.filter(
      (fragment) =>
        fragment.id !== id && fragment.project === id,
    );

    if (projectChildren.length > 0) {
      throw new FragmentDataValidationError(
        projectChildren.map((fragment) => ({
          code: "project_has_children",
          path: fragment.id,
          message:
            `Fragment ${fragment.id} still uses ${id} as its project.`,
        })),
      );
    }
  }

  try {
    const response = await githubRequest<PutContentResponse>(
      config,
      apiPath(config, `/contents/${contentPath(id)}`),
      {
        method: "PUT",
        body: JSON.stringify({
          message: `data: update ${id} ${candidate.title}`,
          content: encodeBase64Utf8(serializeFragment(candidate)),
          sha: expectedSha,
          branch: config.branch,
        }),
      },
    );

    if (!response.content) {
      throw new Error("GitHub did not return the updated content SHA.");
    }

    return {
      fragment: candidate,
      sha: response.content.sha,
    };
  } catch (error) {
    if (
      error instanceof GitHubApiError &&
      (error.status === 409 || error.status === 422)
    ) {
      throw new GitHubFragmentConflictError(
        `Fragment ${id} changed while the update was being written.`,
      );
    }

    throw error;
  }
}

export async function deleteGitHubFragment(
  id: string,
  expectedSha: string,
  config = getGitHubConfigFromEnv(),
): Promise<void> {
  const current = await getGitHubFragment(id, config);

  if (!current) {
    throw new Error(`Fragment ${id} does not exist.`);
  }

  if (current.sha !== expectedSha) {
    throw new GitHubFragmentConflictError(
      `Fragment ${id} has changed on GitHub since it was loaded.`,
    );
  }

  const all = await listGitHubFragments(config);
  const inbound = all.filter(
    (fragment) =>
      fragment.id !== id &&
      (fragment.project === id || fragment.related.includes(id)),
  );

  if (inbound.length > 0) {
    throw new FragmentDataValidationError(
      inbound.map((fragment) => ({
        code: "inbound_reference",
        path: fragment.id,
        message: `Fragment ${fragment.id} still references ${id}.`,
      })),
    );
  }

  try {
    await githubRequest(
      config,
      apiPath(config, `/contents/${contentPath(id)}`),
      {
        method: "DELETE",
        body: JSON.stringify({
          message: `data: delete ${id}`,
          sha: expectedSha,
          branch: config.branch,
        }),
      },
    );
  } catch (error) {
    if (
      error instanceof GitHubApiError &&
      (error.status === 409 || error.status === 422)
    ) {
      throw new GitHubFragmentConflictError(
        `Fragment ${id} changed while the delete was being written.`,
      );
    }

    throw error;
  }
}

/**
 * Writes a batch of status-only changes as ONE commit on the configured
 * branch (all-or-nothing). Uses the same server-side FRAGMENTHUB_GITHUB_TOKEN
 * config as the single-fragment write path; see lib/fragments/status-batch.ts.
 */
export async function applyGitHubStatusBatch(
  changes: readonly StatusBatchChange[],
  config = getGitHubConfigFromEnv(),
): Promise<StatusBatchOutcome> {
  const api = createGitHubStatusBatchApi(
    { owner: config.owner, repo: config.repo, branch: config.branch },
    (pathname, init) => githubRequest(config, pathname, init),
  );

  return applyStatusBatch(changes, api);
}

export class GitHubFragmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubFragmentConflictError";
  }
}
