import { z } from "zod";

import {
  fragmentIdSchema,
  fragmentSchema,
  fragmentStatusSchema,
  type Fragment,
} from "@/lib/fragment-schema";
import { serializeFragment } from "@/lib/fragments/local-store";
import { validateFragmentSemantics } from "@/lib/fragments/semantic-validator";

/**
 * Batch status change for the kanban edit mode.
 *
 * Server-side module (it imports local-store, which uses node:fs). The pure
 * parts — request validation, planning against a pinned snapshot and the
 * single-commit retry loop — live here so they can be tested without network.
 * The GitHub Git Data adapter lives in lib/github/status-batch-git.ts and is
 * wired to the server-only token in lib/github/fragment-store.ts.
 */

export const STATUS_BATCH_MAX_CHANGES = 50;
export const STATUS_BATCH_MAX_BODY_BYTES = 32 * 1024;
/** One initial attempt plus at most two retries when the branch moves. */
export const STATUS_BATCH_MAX_ATTEMPTS = 3;

export const fragmentDataDirectory = "data/fragments";

export function fragmentContentPath(id: string): string {
  // Only ever called with ids validated by fragmentIdSchema (F-\d{6}).
  return `${fragmentDataDirectory}/${fragmentIdSchema.parse(id)}.json`;
}

export const statusBatchChangeSchema = z.object({
  id: fragmentIdSchema,
  status: fragmentStatusSchema,
  expected_updated_at: z.iso.datetime({ offset: true }),
});

export const statusBatchRequestSchema = z
  .object({
    changes: z
      .array(statusBatchChangeSchema)
      .min(1)
      .max(STATUS_BATCH_MAX_CHANGES),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    value.changes.forEach((change, index) => {
      if (seen.has(change.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["changes", index, "id"],
          message: `Duplicate Fragment ID: ${change.id}`,
        });
      }
      seen.add(change.id);
    });
  });

export type StatusBatchChange = z.infer<typeof statusBatchChangeSchema>;
export type StatusBatchRequest = z.infer<typeof statusBatchRequestSchema>;

export type StatusBatchResultItem = Pick<Fragment, "id" | "status" | "updated_at">;

export type StatusBatchInvalidItem = { id: string; message: string };

export type StatusBatchWrite = {
  id: string;
  path: string;
  content: string;
  fragment: Fragment;
};

export type StatusBatchPlan =
  | { kind: "missing"; missing: string[] }
  | { kind: "conflict"; conflicts: string[] }
  | { kind: "noop" }
  | { kind: "invalid"; invalid: StatusBatchInvalidItem[] }
  | {
      kind: "ready";
      writes: StatusBatchWrite[];
      results: StatusBatchResultItem[];
    };

const mutableKeys = new Set<string>(["status", "updated_at"]);

/**
 * Returns the keys (other than status/updated_at) whose serialized value
 * differs between the stored Fragment and the prepared replacement.
 */
export function unexpectedFieldChanges(
  stored: Fragment,
  next: Fragment,
): string[] {
  const storedKeys = Object.keys(stored);
  const nextKeys = Object.keys(next);
  const keys = new Set([...storedKeys, ...nextKeys]);
  const changed: string[] = [];

  for (const key of keys) {
    if (mutableKeys.has(key)) continue;
    const left = JSON.stringify(stored[key as keyof Fragment]);
    const right = JSON.stringify(next[key as keyof Fragment]);
    if (left !== right) changed.push(key);
  }

  // Key order is part of the on-disk format; a reorder is not a status move.
  if (
    changed.length === 0 &&
    JSON.stringify(storedKeys) !== JSON.stringify(nextKeys)
  ) {
    changed.push("$key_order");
  }

  return changed;
}

/**
 * Prepares the status-only replacement for one stored Fragment. Mirrors the
 * GitHub replace path: fragmentSchema.parse over the stored object with a new
 * updated_at, so the serialized key order matches single-fragment writes.
 */
export function prepareStatusReplacement(
  stored: Fragment,
  status: Fragment["status"],
  updatedAt: string,
):
  | { ok: true; fragment: Fragment }
  | { ok: false; message: string } {
  const parsed = fragmentSchema.safeParse({
    ...stored,
    status,
    updated_at: updatedAt,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`)
        .join("; "),
    };
  }

  const unexpected = unexpectedFieldChanges(stored, parsed.data);
  if (unexpected.length > 0) {
    return {
      ok: false,
      message: `Status move would also change: ${unexpected.join(", ")}`,
    };
  }

  return { ok: true, fragment: parsed.data };
}

/**
 * Plans a status batch against one consistent snapshot of every stored
 * Fragment. Order of checks (first failing class wins, nothing is written):
 * missing (404) -> stale expected_updated_at (409) -> all no-op (400) ->
 * schema/semantic validation against the post-batch dataset (422).
 */
export function planStatusBatch(
  changes: readonly StatusBatchChange[],
  snapshot: readonly Fragment[],
  now: string,
): StatusBatchPlan {
  const byId = new Map(snapshot.map((fragment) => [fragment.id, fragment]));

  const missing = changes
    .filter((change) => !byId.has(change.id))
    .map((change) => change.id);
  if (missing.length > 0) return { kind: "missing", missing };

  const conflicts = changes
    .filter((change) => byId.get(change.id)!.updated_at !== change.expected_updated_at)
    .map((change) => change.id);
  if (conflicts.length > 0) return { kind: "conflict", conflicts };

  const effective = changes.filter(
    (change) => byId.get(change.id)!.status !== change.status,
  );
  if (effective.length === 0) return { kind: "noop" };

  const invalid: StatusBatchInvalidItem[] = [];
  const prepared = new Map<string, Fragment>();

  for (const change of effective) {
    const result = prepareStatusReplacement(
      byId.get(change.id)!,
      change.status,
      now,
    );
    if (result.ok) {
      prepared.set(change.id, result.fragment);
    } else {
      invalid.push({ id: change.id, message: result.message });
    }
  }

  // Post-batch dataset: every stored Fragment with all prepared moves applied.
  const postBatch = snapshot.map((fragment) => prepared.get(fragment.id) ?? fragment);

  for (const [id, candidate] of prepared) {
    const issues = validateFragmentSemantics(
      candidate,
      postBatch.filter((fragment) => fragment.id !== id),
      { previous: byId.get(id)! },
    );
    if (issues.length > 0) {
      invalid.push({
        id,
        message: issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      });
    }
  }

  if (invalid.length > 0) {
    const order = new Map(changes.map((change, index) => [change.id, index]));
    invalid.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { kind: "invalid", invalid };
  }

  const writes: StatusBatchWrite[] = effective.map((change) => {
    const fragment = prepared.get(change.id)!;
    return {
      id: change.id,
      path: fragmentContentPath(change.id),
      content: serializeFragment(fragment),
      fragment,
    };
  });

  const results = changes.map((change) => {
    const fragment = prepared.get(change.id) ?? byId.get(change.id)!;
    return {
      id: fragment.id,
      status: fragment.status,
      updated_at: fragment.updated_at,
    };
  });

  return { kind: "ready", writes, results };
}

export function statusBatchCommitMessage(ids: readonly string[]): string {
  const noun = ids.length === 1 ? "fragment" : "fragments";
  return `data: update status of ${ids.length} ${noun} (${ids.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Single-commit writer with bounded retry
// ---------------------------------------------------------------------------

export type StatusBatchSnapshotEntry = {
  fragment: Fragment;
  /** Tree path, already verified to equal fragmentContentPath(fragment.id). */
  path: string;
  /** Git file mode from the base tree (e.g. "100644"). */
  mode: string;
};

export type StatusBatchHead = { commitSha: string; treeSha: string };

export type StatusBatchGitApi = {
  readHead(): Promise<StatusBatchHead>;
  /** Every stored Fragment in exactly this tree (a pinned snapshot). */
  readFragments(treeSha: string): Promise<StatusBatchSnapshotEntry[]>;
  createBlob(content: string): Promise<string>;
  createTree(
    baseTreeSha: string,
    entries: ReadonlyArray<{ path: string; mode: string; sha: string }>,
  ): Promise<string>;
  createCommit(input: {
    message: string;
    treeSha: string;
    parentSha: string;
  }): Promise<string>;
  /** Fast-forward only. "rejected" means the branch is no longer at parent. */
  updateRef(commitSha: string): Promise<"updated" | "rejected">;
};

export type StatusBatchOutcome =
  | { kind: "missing"; missing: string[] }
  | { kind: "conflict"; conflicts: string[]; reason: "stale" | "branch_moved" }
  | { kind: "noop" }
  | { kind: "invalid"; invalid: StatusBatchInvalidItem[] }
  | { kind: "committed"; commit: string; fragments: StatusBatchResultItem[] };

export type ApplyStatusBatchOptions = {
  now?: () => string;
  maxAttempts?: number;
};

/**
 * All-or-nothing status batch as ONE commit:
 * read head -> read pinned snapshot -> plan (concurrency + validation) ->
 * blobs -> tree(base_tree) -> commit(parent=head) -> fast-forward ref.
 * If the ref update is rejected because the branch moved, the whole plan is
 * recomputed from the new head (so concurrency is re-checked), at most
 * maxAttempts - 1 more times.
 */
export async function applyStatusBatch(
  changes: readonly StatusBatchChange[],
  api: StatusBatchGitApi,
  options: ApplyStatusBatchOptions = {},
): Promise<StatusBatchOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const maxAttempts = options.maxAttempts ?? STATUS_BATCH_MAX_ATTEMPTS;
  let rejectedParent: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const head = await api.readHead();

    if (rejectedParent !== null && head.commitSha === rejectedParent) {
      // The ref update was refused although the branch did not move: this is
      // not a race, so do not loop on it.
      throw new Error("GitHub refused the ref update without the branch moving.");
    }

    const snapshot = await api.readFragments(head.treeSha);
    const plan = planStatusBatch(
      changes,
      snapshot.map((entry) => entry.fragment),
      now(),
    );

    if (plan.kind === "conflict") {
      return { kind: "conflict", conflicts: plan.conflicts, reason: "stale" };
    }
    if (plan.kind !== "ready") return plan;

    const modes = new Map(snapshot.map((entry) => [entry.path, entry.mode]));
    const blobShas = await mapLimit(plan.writes, 8, (write) =>
      api.createBlob(write.content),
    );
    const treeSha = await api.createTree(
      head.treeSha,
      plan.writes.map((write, index) => ({
        path: write.path,
        mode: modes.get(write.path) ?? "100644",
        sha: blobShas[index],
      })),
    );
    const commitSha = await api.createCommit({
      message: statusBatchCommitMessage(plan.writes.map((write) => write.id)),
      treeSha,
      parentSha: head.commitSha,
    });

    if ((await api.updateRef(commitSha)) === "updated") {
      return { kind: "committed", commit: commitSha, fragments: plan.results };
    }

    rejectedParent = head.commitSha;
  }

  return { kind: "conflict", conflicts: [], reason: "branch_moved" };
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Request body reading with a hard size cap
// ---------------------------------------------------------------------------

export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export async function readLimitedJson(
  request: Request,
  limitBytes: number = STATUS_BATCH_MAX_BODY_BYTES,
): Promise<LimitedJsonResult> {
  const tooLarge = { ok: false, error: "Request body is too large." } as const;
  const declared = request.headers.get("content-length");

  if (declared !== null && Number(declared) > limitBytes) return tooLarge;
  if (!request.body) return { ok: false, error: "Request body is required." };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel().catch(() => undefined);
      return tooLarge;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
}
