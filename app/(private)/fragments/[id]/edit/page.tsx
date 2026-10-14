import { notFound } from "next/navigation";

import domainsConfig from "@/config/domains.json";
import { FragmentForm } from "@/components/fragment-form";
import { requireSession } from "@/lib/auth";
import { listFragments } from "@/lib/fragments";
import { collectTags } from "@/lib/fragments/query";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import type { ManualFragmentDraft } from "@/lib/fragments/manual-draft";

type EditFragmentPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    archive?: string;
  }>;
};

export default async function EditFragmentPage({
  params,
  searchParams,
}: EditFragmentPageProps) {
  await requireSession();

  const [{ id }, query, fragments] = await Promise.all([
    params,
    searchParams,
    listFragments(),
  ]);

  const fragment = fragments.find((item) => item.id === id);
  if (!fragment) notFound();

  const initial: ManualFragmentDraft = {
    scope: fragment.scope,
    type: fragment.type,
    status: query.archive === "1" ? "archived" : fragment.status,
    priority: fragment.priority,
    urgency: fragment.urgency,
    domains: fragment.domains,
    tags: fragment.tags,
    project: fragment.project,
    related: fragment.related,
    title: fragment.title,
    summary: fragment.summary,
    next_action: fragment.next_action,
    original_input: fragment.original_input,
    notes: fragment.notes,
    interview: fragment.interview,
    source: fragment.source,
    ai: fragment.ai,
  };

  const domains = Object.entries(domainsConfig.domains).map(([domainId, value]) => ({
    id: domainId,
    label: value.label,
  }));

  const options = fragments
    .filter((item) => item.id !== fragment.id)
    .map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
    }));

  return (
    <main className="pageShell">
      <section className="pageHeader">
        <div>
          <p className="eyebrow">{fragment.id}</p>
          <h1>編輯 Fragment</h1>
          <p className="subtle">
            修改後按「儲存變更」，確認內容後才會更新。
          </p>
        </div>
      </section>

      <FragmentForm
        mode="edit"
        initial={initial}
        domains={domains}
        fragments={options}
        tagSuggestions={collectTags(fragments)}
        remoteConfigured={isGitHubRemoteConfigured()}
        existingMeta={{
          id: fragment.id,
          created_at: fragment.created_at,
          updated_at: fragment.updated_at,
        }}
      />
    </main>
  );
}
