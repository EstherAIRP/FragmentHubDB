import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthenticated } from "@/lib/auth";
import { isTrustedBrowserMutation } from "@/lib/security/browser-mutation";
import { logSafeStorageError } from "@/lib/security/storage-log";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { fragmentIdSchema } from "@/lib/fragment-schema";
import { manualFragmentDraftSchema } from "@/lib/fragments/manual-draft";
import { prepareReplacement } from "@/lib/fragments/write";
import {
  getGitHubFragment,
  GitHubFragmentConflictError,
  replaceGitHubFragment,
} from "@/lib/github/fragment-store";
import {
  getMongoFragment,
  MongoFragmentConflictError,
  replaceMongoFragment,
} from "@/lib/mongodb/fragment-store";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";
import { GitHubApiError } from "@/lib/github/client";

export const runtime = "nodejs";

const requestSchema = z.object({
  draft: manualFragmentDraftSchema,
  expected_updated_at: z.string().min(1),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isTrustedBrowserMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  if (!isFragmentWriteConfigured()) {
    return NextResponse.json(
      { error: "The selected Fragment data store is not configured for writes." },
      { status: 503 },
    );
  }

  const { id: rawId } = await context.params;
  const id = fragmentIdSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid Fragment ID." }, { status: 400 });
  }

  const payload = requestSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json(
      { error: "Fragment draft validation failed.", details: payload.error.flatten() },
      { status: 400 },
    );
  }

  try {
    if (fragmentBackend() === "mongodb") {
      const current = await getMongoFragment(id.data);
      if (!current) {
        return NextResponse.json({ error: "Fragment not found." }, { status: 404 });
      }
      const fragment = await replaceMongoFragment(
        id.data,
        prepareReplacement(current, payload.data.draft),
        payload.data.expected_updated_at,
      );
      return NextResponse.json({ fragment });
    }

    const current = await getGitHubFragment(id.data);
    if (!current) {
      return NextResponse.json({ error: "Fragment not found." }, { status: 404 });
    }
    if (current.fragment.updated_at !== payload.data.expected_updated_at) {
      return NextResponse.json(
        {
          error: "這筆 Fragment 已在 GitHub 被更新，請重新載入後再修改。",
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
    return NextResponse.json({ fragment: stored.fragment, sha: stored.sha });
  } catch (error) {
    if (
      error instanceof GitHubFragmentConflictError ||
      error instanceof MongoFragmentConflictError
    ) {
      return NextResponse.json(
        { error: "Fragment 版本衝突，請重新載入後再修改。" },
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
      console.error("GitHub update failed:", error.status);
      return NextResponse.json(
        { error: "GitHub write failed." },
        { status: error.status >= 500 ? 502 : 400 },
      );
    }
    logSafeStorageError("fragment_update", error);
    return NextResponse.json({ error: "Fragment update failed." }, { status: 500 });
  }
}
