import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthenticated } from "@/lib/auth";
import { manualFragmentDraftSchema } from "@/lib/fragments/manual-draft";
import { prepareCreateInput } from "@/lib/fragments/write";
import {
  createGitHubFragment,
} from "@/lib/github/fragment-store";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import {
  FragmentDataValidationError,
} from "@/lib/fragments/semantic-validator";
import { GitHubApiError } from "@/lib/github/client";

const requestSchema = z.object({
  draft: manualFragmentDraftSchema,
});

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGitHubRemoteConfigured()) {
    return NextResponse.json(
      { error: "GitHub Remote Store is not configured." },
      { status: 503 },
    );
  }

  const payload = requestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Fragment draft validation failed.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const stored = await createGitHubFragment(
      prepareCreateInput(payload.data.draft),
    );

    return NextResponse.json(
      {
        fragment: stored.fragment,
        sha: stored.sha,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FragmentDataValidationError) {
      return NextResponse.json(
        { error: "Fragment semantic validation failed.", issues: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof GitHubApiError) {
      console.error("GitHub create failed:", error.responseBody);
      return NextResponse.json(
        { error: "GitHub write failed." },
        { status: error.status >= 500 ? 502 : 400 },
      );
    }

    console.error("Fragment create failed:", error);
    return NextResponse.json(
      { error: "Fragment create failed." },
      { status: 500 },
    );
  }
}
