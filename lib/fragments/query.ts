import type { Fragment } from "@/lib/fragment-schema";
import { domainLabel } from "@/lib/fragments/presentation";

export type FragmentFilters = {
  q?: string;
  scope?: string;
  type?: string;
  status?: string;
  priority?: string;
  urgency?: string;
  domain?: string;
  tag?: string;
};

function normalized(value?: string) {
  return value?.normalize("NFC").trim().toLowerCase() ?? "";
}

export function filterFragments(
  fragments: readonly Fragment[],
  filters: FragmentFilters,
): Fragment[] {
  const q = normalized(filters.q);
  const tag = normalized(filters.tag);

  return fragments
    .filter((fragment) => {
      if (filters.scope && fragment.scope !== filters.scope) return false;
      if (filters.type && fragment.type !== filters.type) return false;
      if (filters.status && fragment.status !== filters.status) return false;
      if (filters.priority && fragment.priority !== filters.priority) return false;
      if (filters.urgency && fragment.urgency !== filters.urgency) return false;
      if (filters.domain && !fragment.domains.includes(filters.domain)) return false;

      if (
        tag &&
        !fragment.tags.some((item) => normalized(item).includes(tag))
      ) {
        return false;
      }

      if (q) {
        const haystack = [
          fragment.id,
          fragment.title,
          fragment.summary,
          fragment.next_action ?? "",
          fragment.notes ?? "",
          fragment.original_input,
          fragment.domains.join(" "),
          fragment.domains.map(domainLabel).join(" "),
          fragment.tags.join(" "),
        ]
          .join(" ")
          .normalize("NFC")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function collectTags(fragments: readonly Fragment[]): string[] {
  return Array.from(new Set(fragments.flatMap((fragment) => fragment.tags))).sort();
}
