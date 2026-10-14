import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthenticated } from "@/lib/auth";
import { fragmentIdSchema } from "@/lib/fragment-schema";
import { manualFragmentDraftSchema } from "@/lib/fragments/manual-draft";
import { prepareReplacement } from "@/lib/fragments/write";
import {
  getGitHubFragment,
  GitHubFragmentConflictError,
  replaceGitHubFragment,
} from "@/lib/github/fragment-store";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";
import { GitHubApiError } from "@/lib/github/client";

const requestSchema = z.object({
  draft: manualFragmentDraftSchema,
  expected_updated_at: z.string().min(1),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGitHubRemoteConfigured()) {
    return NextResponse.json(
      { error: "GitHub Remote Store is not configured." },
      { status: 503 },
    );
  }

  const { id: rawId } = await context.params;
  const id = fragmentIdSchema.safeParse(rawId);

  if (!id.success) {
    return NextResponse.json(
      { error: "Invalid Fragment ID." },
      { status: 400 },
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
    const current = await getGitHubFragment(id.data);

    if (!current) {
      return NextResponse.json(
        { error: "Fragment not found." },
        { status: 404 },
      );
    }

    if (
      current.fragment.updated_at !== payload.data.expected_updated_at
    ) {
      return NextResponse.json(
        {
          error:
            "這筆 Fragment 已在 GitHub 被更新，請重新載入後再修改。",
          current_updated_at: current.fragment.updated_at,
        },
        { status: 409 },
      );
    }

    const stored = await replaceGitHubFragment(
      id.data,
      prepareReplacement(current.fragment, payload.data.draft),
      current.sha,
    );

    return NextResponse.json({
      fragment: stored.fragment,
      sha: stored.sha,
    });
  } catch (error) {
    if (error instanceof GitHubFragmentConflictError) {
      return NextResponse.json(
        { error: "GitHub 版本衝突，請重新載入後再修改。" },
        { status: 409 },
      );
    }

    if (error instanceof FragmentDataValidationError) {
      return NextResponse.json(
        { error: "Fragment semantic validation failed.", issues: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof GitHubApiError) {
      console.error("GitHub update failed:", error.responseBody);
      return NextResponse.json(
        { error: "GitHub write failed." },
        { status: error.status >= 500 ? 502 : 400 },
      );
    }

    console.error("Fragment update failed:", error);
    return NextResponse.json(
      { error: "Fragment update failed." },
      { status: 500 },
    );
  }
}
