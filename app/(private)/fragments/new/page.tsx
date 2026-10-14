import domainsConfig from "@/config/domains.json";
import { FragmentForm } from "@/components/fragment-form";
import { requireSession } from "@/lib/auth";
import { listFragments } from "@/lib/fragments";
import { collectTags } from "@/lib/fragments/query";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import type { ManualFragmentDraft } from "@/lib/fragments/manual-draft";

const initial: ManualFragmentDraft = {
  scope: "personal",
  type: "note",
  status: "inbox",
  priority: "none",
  urgency: "none",
  domains: [],
  tags: [],
  project: null,
  related: [],
  title: "",
  summary: "",
  next_action: null,
  original_input: "",
  notes: null,
  interview: [],
  source: {
    channel: "web",
  },
  ai: {
    classification_confirmed: true,
    interview_used: false,
  },
};

export default async function NewFragmentPage() {
  await requireSession();

  const fragments = await listFragments();

  const domains = Object.entries(domainsConfig.domains).map(([id, value]) => ({
    id,
    label: value.label,
  }));

  const options = fragments.map((fragment) => ({
    id: fragment.id,
    title: fragment.title,
    type: fragment.type,
  }));

  return (
    <main className="pageShell">
      <section className="pageHeader">
        <div>
          <h1>手動新增 Fragment</h1>
          <p className="subtle">
            填寫內容後按「建立 Fragment」，確認內容後才會儲存。
          </p>
        </div>
      </section>

      <FragmentForm
        mode="new"
        initial={initial}
        domains={domains}
        fragments={options}
        tagSuggestions={collectTags(fragments)}
        remoteConfigured={isGitHubRemoteConfigured()}
      />
    </main>
  );
}
