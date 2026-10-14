import Link from "next/link";
import type { ReactNode } from "react";

import type { BoardCardData } from "@/lib/fragments/board-edit";
import { levelLabels, scopeLabels } from "@/lib/fragments/presentation";

const priorityClass = {
  high: "boardPriority levelHigh",
  medium: "boardPriority levelMedium",
} as const;

type BoardCardProps = {
  card: BoardCardData;
  showScope: boolean;
};

/** Read-only board card; the title link covers the whole card. */
export function BoardCard({ card, showScope }: BoardCardProps) {
  return (
    <article className="boardCard">
      <h3>
        <Link className="cardLink" href={`/fragments/${card.id}`}>
          {card.title}
        </Link>
      </h3>

      <BoardCardDetails card={card} showScope={showScope} />
    </article>
  );
}

/** Next action and metadata chips shared by the read-only and edit cards. */
export function BoardCardDetails({
  card,
  showScope,
  actions,
}: BoardCardProps & { actions?: ReactNode }) {
  const priority = card.priority;

  return (
    <>
      {card.next_action ? (
        <p className="boardNextAction" title={card.next_action}>
          下一步：{card.next_action}
        </p>
      ) : null}

      <div className="boardCardFooter">
        <div className="boardMeta">
          {priority === "high" || priority === "medium" ? (
            <span className={priorityClass[priority]}>
              <span className="boardDot" aria-hidden="true" />
              優先 {levelLabels[priority]}
            </span>
          ) : null}
          {card.domainLabels.map((label) => (
            <span className="boardDomain" key={label}>
              {label}
            </span>
          ))}
          {showScope ? (
            <span className="boardScope">{scopeLabels[card.scope]}</span>
          ) : null}
        </div>

        {actions}
      </div>
    </>
  );
}
