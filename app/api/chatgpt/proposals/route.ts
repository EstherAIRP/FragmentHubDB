import { NextResponse } from "next/server";

import { chatGptIntegrationConfig, isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";
import { chatGptProposalRequestSchema } from "@/lib/chatgpt/proposal-schema";
import { createChatGptProposal } from "@/lib/chatgpt/proposals";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = chatGptIntegrationConfig();
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"), config)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (fragmentBackend() !== "mongodb" || !isFragmentWriteConfigured()) {
    return NextResponse.json({ error: "MongoDB data store is not ready." }, { status: 503 });
  }

  // Strict cap to prevent oversized untrusted proposals.
  let value: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 64 * 1024) {
      return NextResponse.json({ error: "Proposal too large." }, { status: 413 });
    }
    value = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = chatGptProposalRequestSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Proposal schema invalid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const proposal = await createChatGptProposal(parsed.data.draft, config!.ownerId);
    return NextResponse.json({
      proposal_id: proposal._id,
      status: "pending",
      expires_at: proposal.expires_at.toISOString(),
      review_path: `/chatgpt/review/${proposal._id}`,
      message: "Open the review page while logged in; only GitHub-authenticated human approval creates a Fragment.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FragmentDataValidationError) {
      return NextResponse.json({ error: "Fragment relation validation failed.", issues: error.issues }, { status: 422 });
    }
    return NextResponse.json({ error: "Proposal service unavailable." }, { status: 503 });
  }
}
