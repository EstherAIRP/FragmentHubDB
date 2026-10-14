import type { Fragment } from "@/lib/fragment-schema";
import type { BoardCardData } from "@/lib/fragments/board-edit";
import { domainLabel } from "@/lib/fragments/presentation";

export const boardColumns = ["inbox", "active", "waiting"] as const;

export type BoardColumnStatus = (typeof boardColumns)[number];

export type BoardScope = Fragment["scope"] | "all";

/** Statuses a card can be moved to from the board, in menu order. */
export const movableStatuses = [
  "incubating",
  "inbox",
  "active",
  "waiting",
  "done",
] as const satisfies readonly Fragment["status"][];

/** Above this many active cards the column suggests finishing work first. */
export const activeSoftLimit = 3;

const levelScore = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
} as const satisfies Record<Fragment["priority"], number>;

export function boardScore(fragment: Pick<Fragment, "priority" | "urgency">) {
  return levelScore[fragment.priority] + levelScore[fragment.urgency];
}

/** Score descending, then most recently updated first, then ID for stability. */
export function compareBoardCards(a: Fragment, b: Fragment) {
  const byScore = boardScore(b) - boardScore(a);
  if (byScore !== 0) return byScore;

  const byUpdatedAt = compareUpdatedAtDesc(a, b);
  if (byUpdatedAt !== 0) return byUpdatedAt;

  return a.id.localeCompare(b.id);
}

type UpdatedAtSortable = Pick<Fragment, "id" | "updated_at">;

function compareUpdatedAtDesc(a: UpdatedAtSortable, b: UpdatedAtSortable) {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at);
}

export function parseBoardScope(value: string | undefined): BoardScope {
  return value === "work" || value === "personal" ? value : "all";
}

export function filterByScope(
  fragments: readonly Fragment[],
  scope: BoardScope,
): Fragment[] {
  return scope === "all"
    ? [...fragments]
    : fragments.filter((fragment) => fragment.scope === scope);
}

export function groupBoard(
  fragments: readonly Fragment[],
): Record<BoardColumnStatus, Fragment[]> {
  const columns: Record<BoardColumnStatus, Fragment[]> = {
    inbox: [],
    active: [],
    waiting: [],
  };

  for (const fragment of fragments) {
    if ((boardColumns as readonly string[]).includes(fragment.status)) {
      columns[fragment.status as BoardColumnStatus].push(fragment);
    }
  }

  for (const status of boardColumns) {
    columns[status].sort(compareBoardCards);
  }

  return columns;
}

export function listIncubating<T extends UpdatedAtSortable & Pick<Fragment, "status">>(
  fragments: readonly T[],
): T[] {
  return fragments
    .filter((fragment) => fragment.status === "incubating")
    .sort((a, b) => compareUpdatedAtDesc(a, b) || a.id.localeCompare(b.id));
}

/** Statuses whose cards the home page sends to the client. */
export const boardVisibleStatuses = [
  "incubating",
  ...boardColumns,
] as const satisfies readonly Fragment["status"][];

/**
 * Board cards for the client, in board order (score, then recency). Only the
 * fields a card displays are included, plus id, status and updated_at.
 */
export function toBoardCards(fragments: readonly Fragment[]): BoardCardData[] {
  return fragments
    .filter((fragment) =>
      (boardVisibleStatuses as readonly string[]).includes(fragment.status),
    )
    .sort(compareBoardCards)
    .map((fragment) => ({
      id: fragment.id,
      title: fragment.title,
      scope: fragment.scope,
      status: fragment.status,
      priority: fragment.priority,
      next_action: fragment.next_action,
      updated_at: fragment.updated_at,
      domainLabels: fragment.domains.slice(0, 2).map(domainLabel),
    }));
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Done Fragments whose last update falls within the past `days` days.
 * `updated_at` is the closest stored signal for when the work was completed.
 */
export function countRecentlyDone(
  fragments: readonly Fragment[],
  now: Date,
  days = 7,
): number {
  const since = now.getTime() - days * dayMs;

  return fragments.filter(
    (fragment) =>
      fragment.status === "done" && Date.parse(fragment.updated_at) >= since,
  ).length;
}
