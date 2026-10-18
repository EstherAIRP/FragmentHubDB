import { NextResponse } from "next/server";

import { chatGptIntegrationConfig, isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";
import { getChatGptProposal } from "@/lib/chatgpt/proposals";
import { fragmentBackend } from "@/lib/fragments/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll approval status; machine callers cannot approve their own proposals. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const config = chatGptIntegrationConfig();
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"), config)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (fragmentBackend() !== "mongodb") {
    return NextResponse.json({ error: "MongoDB data store is not active." }, { status: 503 });
  }
  try {
    const { id } = await context.params;
    const proposal = await getChatGptProposal(id, config!.ownerId);
    if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    const status = proposal.status === "pending" && proposal.expires_at.getTime() <= Date.now()
      ? "expired"
      : proposal.status;
    return NextResponse.json({
      proposal_id: proposal._id,
      status,
      fragment_id: proposal.fragment_id ?? null,
      expires_at: proposal.expires_at.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Proposal service unavailable." }, { status: 503 });
  }
}
