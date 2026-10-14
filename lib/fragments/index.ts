import type { Fragment } from "@/lib/fragment-schema";

export type FragmentIndexRecord = Pick<
  Fragment,
  | "id"
  | "title"
  | "scope"
  | "type"
  | "status"
  | "priority"
  | "urgency"
  | "domains"
  | "tags"
  | "project"
  | "updated_at"
> & {
  related: string[];
  backlinks: string[];
};

export function buildFragmentIndex(
  fragments: readonly Fragment[],
): FragmentIndexRecord[] {
  const backlinks = new Map<string, Set<string>>();

  for (const fragment of fragments) {
    for (const targetId of fragment.related) {
      const inbound = backlinks.get(targetId) ?? new Set<string>();
      inbound.add(fragment.id);
      backlinks.set(targetId, inbound);
    }
  }

  return fragments
    .map((fragment) => ({
      id: fragment.id,
      title: fragment.title,
      scope: fragment.scope,
      type: fragment.type,
      status: fragment.status,
      priority: fragment.priority,
      urgency: fragment.urgency,
      domains: fragment.domains,
      tags: fragment.tags,
      project: fragment.project,
      related: fragment.related,
      backlinks: Array.from(backlinks.get(fragment.id) ?? []).sort(),
      updated_at: fragment.updated_at,
    }))
    .sort((a, b) => {
      const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
      return byUpdatedAt !== 0 ? byUpdatedAt : a.id.localeCompare(b.id);
    });
}
