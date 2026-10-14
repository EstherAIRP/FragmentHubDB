import type { Fragment } from "@/lib/fragment-schema";
import { statusLabels, statusTones } from "@/lib/fragments/presentation";

export function StatusChip({ status }: { status: Fragment["status"] }) {
  return (
    <span className={`statusChip ${statusTones[status]}`}>
      <span className="statusDot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}
