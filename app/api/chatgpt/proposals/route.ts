import { NextResponse } from "next/server";

import { isAuthConfigured } from "@/lib/auth";

import { chatGptIntegrationConfig, isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";
import { chatGptProposalRequestSchema } from "@/lib/chatgpt/proposal-schema";
import { createChatGptProposal } from "@/lib/chatgpt/proposals";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";
import { readLimitedJson } from "@/lib/fragments/status-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = chatGptIntegrationConfig();
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"), config)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (fragmentBackend() !== "mongodb" || !isFragmentWriteConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: "MongoDB data store is not ready." }, { status: 503 });
  }

  // Bound the incoming stream while reading, before allocating the payload.
  const body = await readLimitedJson(request, 64 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error.includes("too large") ? 413 : 400 },
    );
  }
  const parsed = chatGptProposalRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Proposal schema invalid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const proposal = await createChatGptProposal(parsed.data.draft, config!.ownerId);
    const reviewPath = `/chatgpt/review/${proposal._id}`;
    return NextResponse.json({
      proposal_id: proposal._id,
      status: "pending",
      expires_at: proposal.expires_at.toISOString(),
      review_path: reviewPath,
      review_url: new URL(reviewPath, process.env.FragmentHubDB_PUBLIC_URL).toString(),
      message: "Open the review page while logged in; only GitHub-authenticated human approval creates a Fragment.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FragmentDataValidationError) {
      return NextResponse.json({ error: "Fragment relation validation failed.", issues: error.issues }, { status: 422 });
    }
    return NextResponse.json({ error: "Proposal service unavailable." }, { status: 503 });
  }
}
