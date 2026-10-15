import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { chatGptIntegrationConfig, isSameOriginApproval } from "@/lib/chatgpt/auth";
import { approveChatGptProposal, ProposalNotReadyError } from "@/lib/chatgpt/proposals";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  const config = chatGptIntegrationConfig();
  if (!session || !config || session.id !== config.ownerId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isSameOriginApproval(
    request.headers.get("origin"),
    process.env.FragmentHubDB_PUBLIC_URL,
  )) {
    return NextResponse.json({ error: "Cross-origin approval refused." }, { status: 403 });
  }
  if (fragmentBackend() !== "mongodb" || !isFragmentWriteConfigured()) {
    return NextResponse.json({ error: "MongoDB data store is not ready." }, { status: 503 });
  }

  const { id } = await context.params;
  try {
    const fragmentId = await approveChatGptProposal(id, session.id);
    return NextResponse.redirect(
      new URL(`/fragments/${fragmentId}`, process.env.FragmentHubDB_PUBLIC_URL),
      { status: 303 },
    );
  } catch (error) {
    if (error instanceof ProposalNotReadyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof FragmentDataValidationError) {
      return NextResponse.json(
        { error: "Fragment validation failed after preview; refresh and review relations.", issues: error.issues },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "Unable to commit proposal." }, { status: 503 });
  }
}
