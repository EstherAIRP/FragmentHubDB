import { notFound } from "next/navigation";

import { getCurrentSession, requireSession } from "@/lib/auth";
import { chatGptIntegrationConfig } from "@/lib/chatgpt/auth";
import { getChatGptProposal } from "@/lib/chatgpt/proposals";
import { logSafeStorageError } from "@/lib/security/storage-log";

export const dynamic = "force-dynamic";

export default async function ChatGptProposalReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();

  const session = await getCurrentSession();
  const config = chatGptIntegrationConfig();
  if (!config || session?.id !== config.ownerId) notFound();
  const { id } = await params;
  const proposal = await getChatGptProposal(id, config.ownerId).catch((error: unknown) => {
    logSafeStorageError("proposal_review", error);
    throw new Error("Proposal data unavailable.");
  });
  if (!proposal) notFound();

  const expired = proposal.expires_at.getTime() <= Date.now();
  return (
    <main className="pageShell">
      <section className="pageHeader">
        <div>
          <h1>確認 ChatGPT Fragment 草稿</h1>
          <p className="subtle">
            下列內容是尚未寫入正式資料庫的提案，請完整核對後才送出。
          </p>
        </div>
      </section>
      <article className="panel detailSection">
        <h2>{proposal.draft.title}</h2>
        <p>狀態：{proposal.status === "committed" ? "已提交" : expired ? "已過期" : "待確認"}</p>
        <p>草稿到期：{proposal.expires_at.toISOString()}</p>
        <h3>完整待確認內容</h3>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(proposal.draft, null, 2)}
        </pre>
        {proposal.status === "pending" && !expired ? (
          <form method="post" action={`/api/chatgpt/proposals/${proposal._id}/approve`}>
            <button className="primaryButton" type="submit">
              我已核對完整內容，確認建立 Fragment
            </button>
          </form>
        ) : proposal.fragment_id ? (
          <p>已建立 Fragment：{proposal.fragment_id}</p>
        ) : (
          <p>這份草稿已不可提交，請返回 ChatGPT 重新建立草稿。</p>
        )}
      </article>
    </main>
  );
}
