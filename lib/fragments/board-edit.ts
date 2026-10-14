import type { Fragment } from "@/lib/fragment-schema";

/**
 * Pure state helpers for the kanban edit mode. Status moves are collected
 * locally and only written after the user confirms the whole batch through
 * POST /api/fragments/status-batch.
 */

type Status = Fragment["status"];

/** The minimum a board card needs: what it displays plus id/status/updated_at. */
export type BoardCardData = Pick<
  Fragment,
  "id" | "title" | "scope" | "status" | "priority" | "next_action" | "updated_at"
> & {
  /** Display labels of the first two domains. */
  domainLabels: string[];
};

export type EditZone = Exclude<Status, "archived">;

/** Drop zones in edit mode, in visual (and keyboard) order. */
export const editZones = [
  "incubating",
  "inbox",
  "active",
  "waiting",
  "done",
] as const satisfies readonly EditZone[];

/** Upper bound accepted by POST /api/fragments/status-batch. */
export const maxBatchChanges = 50;

export type PendingChange = {
  id: string;
  title: string;
  from: Status;
  to: Status;
  /** The stored card's updated_at when the change was made. */
  expected_updated_at: string;
};

export type PendingChanges = Readonly<Record<string, PendingChange>>;

export type StatusBatchRequest = {
  changes: { id: string; status: Status; expected_updated_at: string }[];
};

export function isEditZone(value: unknown): value is EditZone {
  return (editZones as readonly unknown[]).includes(value);
}

/**
 * Records a local move of the stored `card` to `to`. Moving a card back to
 * its stored status removes it from the pending list.
 */
export function moveCard(
  changes: PendingChanges,
  card: Pick<BoardCardData, "id" | "title" | "status" | "updated_at">,
  to: Status,
): PendingChanges {
  const next = { ...changes };

  if (to === card.status) {
    delete next[card.id];
    return next;
  }

  next[card.id] = {
    id: card.id,
    title: card.title,
    from: card.status,
    to,
    expected_updated_at: card.updated_at,
  };
  return next;
}

export function revertChange(changes: PendingChanges, id: string): PendingChanges {
  if (!(id in changes)) return changes;

  const next = { ...changes };
  delete next[id];
  return next;
}

export function effectiveStatus(
  card: Pick<BoardCardData, "id" | "status">,
  changes: PendingChanges,
): Status {
  return changes[card.id]?.to ?? card.status;
}

/**
 * Groups cards by their effective status into the edit-mode zones, keeping
 * the input order inside each zone. Archived cards are left out.
 */
export function groupEditZones<T extends Pick<BoardCardData, "id" | "status">>(
  cards: readonly T[],
  changes: PendingChanges,
): Record<EditZone, T[]> {
  const zones: Record<EditZone, T[]> = {
    incubating: [],
    inbox: [],
    active: [],
    waiting: [],
    done: [],
  };

  for (const card of cards) {
    const status = effectiveStatus(card, changes);
    if (isEditZone(status)) zones[status].push(card);
  }

  return zones;
}

export function listPendingChanges(changes: PendingChanges): PendingChange[] {
  return Object.values(changes).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildStatusBatchRequest(
  changes: PendingChanges,
): StatusBatchRequest {
  return {
    changes: listPendingChanges(changes).map((change) => ({
      id: change.id,
      status: change.to,
      expected_updated_at: change.expected_updated_at,
    })),
  };
}

/**
 * Re-bases pending changes on freshly loaded cards.
 *
 * - `dropIds` (e.g. 409 conflicts reported by the server) are removed.
 * - A change whose card disappeared or was updated elsewhere (its
 *   updated_at no longer matches) is removed and reported in `dropped`.
 * - A change the refreshed data already reflects is removed silently.
 */
export function rebasePendingChanges(
  changes: PendingChanges,
  cards: readonly Pick<BoardCardData, "id" | "status" | "updated_at">[],
  dropIds: readonly string[] = [],
): { changes: PendingChanges; dropped: PendingChange[] } {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const drop = new Set(dropIds);
  const next: Record<string, PendingChange> = {};
  const dropped: PendingChange[] = [];

  for (const change of listPendingChanges(changes)) {
    if (drop.has(change.id)) continue;

    const card = byId.get(change.id);
    if (!card || card.updated_at !== change.expected_updated_at) {
      dropped.push(change);
      continue;
    }

    if (card.status === change.to) continue;

    next[change.id] = { ...change, from: card.status };
  }

  return { changes: next, dropped };
}

/**
 * Unsaved edit-mode changes are kept in sessionStorage so that leaving the
 * board (Back, reload, a link) never silently loses them: the next visit
 * offers to restore them. One draft is stored per scope, under
 * `${boardDraftStorageKey}:${scope}`. Nothing here writes to the canonical
 * data store.
 */
export const boardDraftStorageKey = "fragmenthub:board-draft:v1";

export type BoardDraft = {
  scope: string;
  changes: PendingChanges;
};

const statusValues: readonly Status[] = [
  "incubating",
  "inbox",
  "active",
  "waiting",
  "done",
  "archived",
] satisfies readonly Status[];

function isStatus(value: unknown): value is Status {
  return (statusValues as readonly unknown[]).includes(value);
}

export function serializeBoardDraft(scope: string, changes: PendingChanges): string {
  return JSON.stringify({ scope, changes: listPendingChanges(changes) });
}

/** Parses a stored draft, ignoring anything malformed. */
export function parseBoardDraft(raw: string | null): BoardDraft | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const payload = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  if (typeof payload.scope !== "string" || !Array.isArray(payload.changes)) {
    return null;
  }

  const changes: Record<string, PendingChange> = {};
  for (const item of payload.changes) {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.expected_updated_at !== "string" ||
      !isStatus(entry.from) ||
      !isStatus(entry.to) ||
      entry.from === entry.to
    ) {
      continue;
    }
    changes[entry.id] = {
      id: entry.id,
      title: entry.title,
      from: entry.from,
      to: entry.to,
      expected_updated_at: entry.expected_updated_at,
    };
  }

  return { scope: payload.scope, changes };
}

export type StatusBatchOutcome =
  | { kind: "ok" }
  | { kind: "conflict"; ids: string[] }
  | { kind: "missing"; ids: string[] }
  | { kind: "invalid"; items: { id: string; message: string }[] }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

// Server `error` strings may be English; the UI shows these zh-TW texts by
// status code instead. Every non-2xx response means nothing was written.
export const statusBatchErrorMessages = {
  badRequest: "沒有可寫入的變更，或變更內容不正確。",
  unavailable: "GitHub Remote Store 尚未設定，無法儲存。",
  upstream: "寫入 GitHub 失敗，請稍後再試。",
  fallback: "儲存失敗，請稍後再試。",
} as const;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Maps a POST /api/fragments/status-batch response to a UI outcome. */
export function interpretStatusBatchResponse(
  status: number,
  body: unknown,
): StatusBatchOutcome {
  const payload = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 409) return { kind: "conflict", ids: stringList(payload.conflicts) };
  if (status === 404) return { kind: "missing", ids: stringList(payload.missing) };

  if (status === 422) {
    const items = Array.isArray(payload.invalid)
      ? payload.invalid.flatMap((item: unknown) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          return typeof entry.id === "string"
            ? [
                {
                  id: entry.id,
                  message: typeof entry.message === "string" ? entry.message : "",
                },
              ]
            : [];
        })
      : [];
    return { kind: "invalid", items };
  }

  if (status === 400) {
    return { kind: "error", message: statusBatchErrorMessages.badRequest };
  }
  if (status === 503) {
    return { kind: "error", message: statusBatchErrorMessages.unavailable };
  }
  if (status >= 500) {
    return { kind: "error", message: statusBatchErrorMessages.upstream };
  }

  return { kind: "error", message: statusBatchErrorMessages.fallback };
}
