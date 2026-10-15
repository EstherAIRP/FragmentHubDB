import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthenticated } from "@/lib/auth";
import { isTrustedBrowserMutation } from "@/lib/security/browser-mutation";
import { logSafeStorageError } from "@/lib/security/storage-log";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { manualFragmentDraftSchema } from "@/lib/fragments/manual-draft";
import { prepareCreateInput } from "@/lib/fragments/write";
import { createGitHubFragment } from "@/lib/github/fragment-store";
import { createMongoFragment } from "@/lib/mongodb/fragment-store";
import { FragmentDataValidationError } from "@/lib/fragments/semantic-validator";
import { GitHubApiError } from "@/lib/github/client";

export const runtime = "nodejs";

const requestSchema = z.object({
  draft: manualFragmentDraftSchema,
});

export async function POST(request: Request) {
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

  const payload = requestSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json(
      { error: "Fragment draft validation failed.", details: payload.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const input = prepareCreateInput(payload.data.draft);
    if (fragmentBackend() === "mongodb") {
      const fragment = await createMongoFragment(input);
      return NextResponse.json({ fragment }, { status: 201 });
    }

    const stored = await createGitHubFragment(input);
    return NextResponse.json(
      { fragment: stored.fragment, sha: stored.sha },
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
      console.error("GitHub create failed:", error.status);
      return NextResponse.json(
        { error: "GitHub write failed." },
        { status: error.status >= 500 ? 502 : 400 },
      );
    }
    logSafeStorageError("fragment_create", error);
    return NextResponse.json({ error: "Fragment create failed." }, { status: 500 });
  }
}
