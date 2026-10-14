import Link from "next/link";

import { StatusChip } from "@/components/status-chip";
import type { Fragment } from "@/lib/fragment-schema";
import {
  domainLabel,
  formatTimestamp,
  isSettledStatus,
  levelLabels,
  scopeLabels,
  typeLabels,
} from "@/lib/fragments/presentation";

const levelChipClass = {
  high: "levelChip levelHigh",
  medium: "levelChip levelMedium",
} as const;

function LevelChip({
  prefix,
  level,
}: {
  prefix: string;
  level: Fragment["priority"];
}) {
  if (level !== "high" && level !== "medium") return null;

  return (
    <span className={levelChipClass[level]}>
      {prefix} {levelLabels[level]}
    </span>
  );
}

export function FragmentCard({ fragment }: { fragment: Fragment }) {
  const className = isSettledStatus(fragment.status)
    ? "fragmentCard fragmentCardSettled"
    : "fragmentCard";

  return (
    <article className={className}>
      <div className="fragmentMeta">
        <StatusChip status={fragment.status} />
        <span>{scopeLabels[fragment.scope]}</span>
        <span>{typeLabels[fragment.type]}</span>
        <LevelChip prefix="優先" level={fragment.priority} />
        <LevelChip prefix="急迫" level={fragment.urgency} />
      </div>

      <div className="cardHeading">
        <h3>
          <Link className="cardLink" href={`/fragments/${fragment.id}`}>
            {fragment.title}
          </Link>
        </h3>
        <span className="cardStamp">
          <span className="fragmentId">{fragment.id}</span>
          <time dateTime={fragment.updated_at}>
            {formatTimestamp(fragment.updated_at)}
          </time>
        </span>
      </div>

      <p>{fragment.summary || "尚未填寫摘要。"}</p>

      {fragment.next_action ? (
        <p className="cardNextAction">下一步：{fragment.next_action}</p>
      ) : null}

      <div className="tags">
        {fragment.domains.map((domain) => (
          <span className="domainChip" key={domain} title={domain}>
            {domainLabel(domain)}
          </span>
        ))}
        {fragment.tags.slice(0, 6).map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
    </article>
  );
}
