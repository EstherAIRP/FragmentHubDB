import Link from "next/link";
import { Suspense } from "react";

import { FragmentCard } from "@/components/fragment-card";
import { FragmentFilters } from "@/components/fragment-filters";
import { requireSession } from "@/lib/auth";
import { listFragments } from "@/lib/fragments";
import {
  collectTags,
  filterFragments,
  type FragmentFilters as FragmentFilterValues,
} from "@/lib/fragments/query";

type FragmentsPageProps = {
  searchParams: Promise<FragmentFilterValues>;
};

export default async function FragmentsPage({
  searchParams,
}: FragmentsPageProps) {
  await requireSession();

  const [allFragments, filters] = await Promise.all([
    listFragments(),
    searchParams,
  ]);
  const fragments = filterFragments(allFragments, filters);
  const tags = collectTags(allFragments);

  return (
    <main className="pageShell">
      <section className="pageHeader">
        <div>
          <h1>Fragment 庫</h1>
          <p className="subtle" aria-live="polite">
            {fragments.length} / {allFragments.length} 筆符合目前條件
          </p>
        </div>
        <Link className="primaryButton linkButton" href="/fragments/new">
          手動新增
        </Link>
      </section>

      <Suspense fallback={null}>
        <FragmentFilters tags={tags} />
      </Suspense>

      <section className="fragmentList">
        {fragments.length === 0 ? (
          <div className="panel emptyState">
            <strong>找不到符合條件的 Fragment。</strong>
            <p>調整搜尋字詞或移除部分篩選條件。</p>
          </div>
        ) : (
          fragments.map((fragment) => (
            <FragmentCard fragment={fragment} key={fragment.id} />
          ))
        )}
      </section>
    </main>
  );
}
