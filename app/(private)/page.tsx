import Link from "next/link";

import { BoardWorkspace } from "@/components/board-workspace";
import { requireSession } from "@/lib/auth";
import { listFragments } from "@/lib/fragments";
import {
  countRecentlyDone,
  filterByScope,
  parseBoardScope,
  toBoardCards,
  type BoardScope,
} from "@/lib/fragments/board";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";

type BoardView = "board" | "incubating";

type BoardPageProps = {
  searchParams: Promise<{
    view?: string;
    scope?: string;
  }>;
};

const scopeTabs: { value: BoardScope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "work", label: "工作" },
  { value: "personal", label: "個人" },
];

const viewTabs: { value: BoardView; label: string }[] = [
  { value: "board", label: "看板" },
  { value: "incubating", label: "醞釀中" },
];

function homeHref(view: BoardView, scope: BoardScope) {
  const params = new URLSearchParams();
  if (view !== "board") params.set("view", view);
  if (scope !== "all") params.set("scope", scope);

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function doneHref(scope: BoardScope) {
  const params = new URLSearchParams({ status: "done" });
  if (scope !== "all") params.set("scope", scope);
  return `/fragments?${params.toString()}`;
}

export default async function BoardPage({ searchParams }: BoardPageProps) {
  await requireSession();

  const [allFragments, query] = await Promise.all([
    listFragments(),
    searchParams,
  ]);

  const view: BoardView = query.view === "incubating" ? "incubating" : "board";
  const scope = parseBoardScope(query.scope);
  const fragments = filterByScope(allFragments, scope);

  return (
    <main className="pageShell">
      {/* Keyed by scope: switching scope starts a fresh edit session. */}
      <BoardWorkspace
        key={scope}
        view={view}
        scope={scope}
        cards={toBoardCards(fragments)}
        showScope={scope === "all"}
        remoteConfigured={isGitHubRemoteConfigured()}
        recentlyDone={countRecentlyDone(fragments, new Date())}
        doneHref={doneHref(scope)}
        viewTabs={
          <nav className="boardTabs" aria-label="檢視">
            {viewTabs.map((tab) => (
              <Link
                key={tab.value}
                href={homeHref(tab.value, scope)}
                aria-current={view === tab.value ? "page" : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        }
        scopeTabs={
          <nav className="boardTabs" aria-label="範圍">
            {scopeTabs.map((tab) => (
              <Link
                key={tab.value}
                href={homeHref(view, tab.value)}
                aria-current={scope === tab.value ? "page" : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        }
      />
    </main>
  );
}
