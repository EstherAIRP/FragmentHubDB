import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusChip } from "@/components/status-chip";
import { requireSession } from "@/lib/auth";
import type { Fragment } from "@/lib/fragment-schema";
import { listFragments } from "@/lib/fragments";
import {
  domainLabel,
  fieldLabels,
  formatTimestamp,
  levelLabels,
  scopeLabels,
  sourceChannelLabels,
  typeLabels,
} from "@/lib/fragments/presentation";

type FragmentDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function FragmentDetailPage({
  params,
}: FragmentDetailPageProps) {
  await requireSession();

  const { id } = await params;
  const fragments = await listFragments();
  const fragment = fragments.find((item) => item.id === id);

  if (!fragment) notFound();

  const byId = new Map(fragments.map((item) => [item.id, item]));
  const related = fragment.related
    .map((relatedId) => byId.get(relatedId))
    .filter((item) => item !== undefined);
  const backlinks = fragments.filter(
    (item) => item.id !== id && item.related.includes(id),
  );
  const children =
    fragment.type === "project"
      ? fragments.filter((item) => item.project === id)
      : [];
  const project = fragment.project ? byId.get(fragment.project) : undefined;

  return (
    <main className="pageShell">
      <section className="detailHeader">
        <div>
          <div className="fragmentMeta">
            <StatusChip status={fragment.status} />
            <span>{scopeLabels[fragment.scope]}</span>
            <span>{typeLabels[fragment.type]}</span>
            <span className="fragmentId">{fragment.id}</span>
          </div>
          <h1>{fragment.title}</h1>
          <p className="heroCopy">{fragment.summary || "尚未填寫摘要。"}</p>
        </div>

        <div className="detailActions">
          <Link
            className="secondaryButton linkButton"
            href={`/fragments/${fragment.id}/edit`}
          >
            編輯
          </Link>
          {fragment.status !== "archived" ? (
            <Link
              className="dangerButton linkButton"
              href={`/fragments/${fragment.id}/edit?archive=1`}
            >
              封存
            </Link>
          ) : null}
        </div>
      </section>

      <section className="detailGrid">
        <div className="detailMain">
          <article className="panel detailSection">
            <h2>內容</h2>

            <dl className="detailList">
              <div>
                <dt>{fieldLabels.next_action}</dt>
                <dd>{fragment.next_action || "—"}</dd>
              </div>
              <div>
                <dt>{fieldLabels.notes}</dt>
                <dd className="preserveText">{fragment.notes || "—"}</dd>
              </div>
              <div>
                <dt>{fieldLabels.original_input}</dt>
                <dd className="preserveText">{fragment.original_input}</dd>
              </div>
            </dl>
          </article>

          {fragment.interview.length > 0 ? (
            <article className="panel detailSection">
              <h2>提問紀錄</h2>
              <div className="interviewList">
                {fragment.interview.map((item, index) => (
                  <div key={`${index}-${item.question}`}>
                    <strong>Q{index + 1}. {item.question}</strong>
                    <p>{item.answer}</p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {(children.length > 0 || related.length > 0 || backlinks.length > 0) ? (
            <article className="panel detailSection">
              <h2>關聯</h2>

              {children.length > 0 ? (
                <RelationGroup title="子項目" items={children} />
              ) : null}
              {related.length > 0 ? (
                <RelationGroup title={fieldLabels.related} items={related} />
              ) : null}
              {backlinks.length > 0 ? (
                <RelationGroup title="反向連結" items={backlinks} />
              ) : null}
            </article>
          ) : null}
        </div>

        <aside className="panel detailSidebar">
          <h2>資料</h2>

          <dl className="metadataList">
            <div>
              <dt>{fieldLabels.priority}</dt>
              <dd>{levelLabels[fragment.priority]}</dd>
            </div>
            <div>
              <dt>{fieldLabels.urgency}</dt>
              <dd>{levelLabels[fragment.urgency]}</dd>
            </div>
            <div>
              <dt>{fieldLabels.created_at}</dt>
              <dd>{formatTimestamp(fragment.created_at)}</dd>
            </div>
            <div>
              <dt>{fieldLabels.updated_at}</dt>
              <dd>{formatTimestamp(fragment.updated_at)}</dd>
            </div>
            <div>
              <dt>{fieldLabels.source}</dt>
              <dd>{sourceChannelLabels[fragment.source.channel]}</dd>
            </div>
            <div>
              <dt>{fieldLabels.project}</dt>
              <dd>
                {project ? (
                  <Link href={`/fragments/${project.id}`}>
                    {project.id} · {project.title}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          <div className="sidebarGroup">
            <strong>{fieldLabels.domains}</strong>
            <div className="tags">
              {fragment.domains.length > 0
                ? fragment.domains.map((domain) => (
                    <span className="domainChip" key={domain} title={domain}>
                      {domainLabel(domain)}
                    </span>
                  ))
                : "—"}
            </div>
          </div>

          <div className="sidebarGroup">
            <strong>{fieldLabels.tags}</strong>
            <div className="tags">
              {fragment.tags.length > 0
                ? fragment.tags.map((tag) => <span key={tag}>#{tag}</span>)
                : "—"}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function RelationGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; title: string; type: Fragment["type"] }>;
}) {
  return (
    <div className="relationGroup">
      <strong>{title}</strong>
      <div className="relationCards">
        {items.map((item) => (
          <Link href={`/fragments/${item.id}`} key={item.id}>
            <span>{item.id}</span>
            <strong>{item.title}</strong>
            <small>{typeLabels[item.type]}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}
