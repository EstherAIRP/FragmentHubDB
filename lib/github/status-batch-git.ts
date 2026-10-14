import { fragmentSchema } from "@/lib/fragment-schema";
import {
  fragmentContentPath,
  fragmentDataDirectory,
  mapLimit,
  type StatusBatchGitApi,
  type StatusBatchSnapshotEntry,
} from "@/lib/fragments/status-batch";

/**
 * GitHub Git Data API adapter for the status batch writer.
 *
 * Deliberately free of `server-only` and of any token handling so it can be
 * unit-tested with a fake requester. The real requester (githubRequest bound
 * to FRAGMENTHUB_GITHUB_TOKEN) is injected from lib/github/fragment-store.ts,
 * which is server-only.
 */

export type GitHubRepoRef = { owner: string; repo: string; branch: string };

/**
 * Performs one GitHub REST request and returns the parsed JSON body. Must
 * throw an Error carrying a numeric `status` for non-2xx responses (as
 * GitHubApiError does).
 */
export type GitHubJsonRequester = <T>(
  pathname: string,
  init?: { method?: string; body?: string },
) => Promise<T>;

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const fragmentPathPattern = new RegExp(
  `^${fragmentDataDirectory}/(F-\\d{6})\\.json$`,
);

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function assertSha(value: unknown, what: string): string {
  if (typeof value !== "string" || !shaPattern.test(value)) {
    throw new Error(`GitHub returned an invalid ${what} SHA.`);
  }
  return value;
}

function encodeRefPath(branch: string): string {
  if (!branch || branch.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("FRAGMENTHUB_GITHUB_BRANCH is not a valid branch name.");
  }
  return branch.split("/").map(encodeURIComponent).join("/");
}

type GitRefResponse = { object: { sha: string; type: string } };
type GitCommitResponse = { sha: string; tree: { sha: string } };
type GitTreeResponse = {
  sha: string;
  truncated: boolean;
  tree: Array<{ path: string; mode: string; type: string; sha: string }>;
};
type GitBlobResponse = { sha: string; content: string; encoding: string };
type GitShaResponse = { sha: string };

export function createGitHubStatusBatchApi(
  repoRef: GitHubRepoRef,
  request: GitHubJsonRequester,
): StatusBatchGitApi {
  const base = `/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`;
  const refPath = encodeRefPath(repoRef.branch);

  return {
    async readHead() {
      const ref = await request<GitRefResponse>(`${base}/git/ref/heads/${refPath}`);
      if (ref.object?.type !== "commit") {
        throw new Error("Configured branch does not point at a commit.");
      }
      const commitSha = assertSha(ref.object.sha, "commit");
      const commit = await request<GitCommitResponse>(`${base}/git/commits/${commitSha}`);
      return { commitSha, treeSha: assertSha(commit.tree?.sha, "tree") };
    },

    async readFragments(treeSha) {
      const tree = await request<GitTreeResponse>(
        `${base}/git/trees/${assertSha(treeSha, "tree")}?recursive=1`,
      );

      if (tree.truncated) {
        throw new Error(
          "GitHub tree response was truncated; FragmentHub cannot safely validate the batch.",
        );
      }

      const entries = tree.tree.filter(
        (entry) => entry.type === "blob" && fragmentPathPattern.test(entry.path),
      );

      return mapLimit(entries, 8, async (entry): Promise<StatusBatchSnapshotEntry> => {
        const blob = await request<GitBlobResponse>(
          `${base}/git/blobs/${assertSha(entry.sha, "blob")}`,
        );
        const text =
          blob.encoding === "base64"
            ? Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8")
            : blob.content;
        const fragment = fragmentSchema.parse(JSON.parse(text));

        // The file name is the write target; never trust content to pick it.
        if (fragmentContentPath(fragment.id) !== entry.path) {
          throw new Error(`Fragment file ${entry.path} contains a different ID.`);
        }

        return { fragment, path: entry.path, mode: entry.mode };
      });
    },

    async createBlob(content) {
      const blob = await request<GitShaResponse>(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(content, "utf8").toString("base64"),
          encoding: "base64",
        }),
      });
      return assertSha(blob.sha, "blob");
    },

    async createTree(baseTreeSha, entries) {
      const tree = await request<GitShaResponse>(`${base}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          base_tree: assertSha(baseTreeSha, "tree"),
          tree: entries.map((entry) => {
            if (!fragmentPathPattern.test(entry.path)) {
              throw new Error("Refusing to write outside data/fragments.");
            }
            return {
              path: entry.path,
              mode: entry.mode,
              type: "blob",
              sha: assertSha(entry.sha, "blob"),
            };
          }),
        }),
      });
      return assertSha(tree.sha, "tree");
    },

    async createCommit({ message, treeSha, parentSha }) {
      const commit = await request<GitShaResponse>(`${base}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: assertSha(treeSha, "tree"),
          parents: [assertSha(parentSha, "commit")],
        }),
      });
      return assertSha(commit.sha, "commit");
    },

    async updateRef(commitSha) {
      try {
        await request(`${base}/git/refs/heads/${refPath}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: assertSha(commitSha, "commit"), force: false }),
        });
        return "updated";
      } catch (error) {
        // 422 "Update is not a fast forward" (or 409) when the branch moved.
        // applyStatusBatch re-reads the head and refuses to loop if it did not.
        const status = errorStatus(error);
        if (status === 422 || status === 409) return "rejected";
        throw error;
      }
    },
  };
}
