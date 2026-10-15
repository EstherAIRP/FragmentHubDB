import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import { isTrustedBrowserMutation } from "@/lib/security/browser-mutation";
import { logSafeStorageError } from "@/lib/security/storage-log";
import { fragmentBackend, isFragmentWriteConfigured } from "@/lib/fragments/backend";
import { readLimitedJson, statusBatchRequestSchema } from "@/lib/fragments/status-batch";
import { GitHubApiError } from "@/lib/github/client";
import { applyGitHubStatusBatch } from "@/lib/github/fragment-store";
import { applyMongoStatusBatch } from "@/lib/mongodb/fragment-store";

export const runtime = "nodejs";

/**
 * POST /api/fragments/status-batch
 * One human-confirmed atomic status batch in the selected data store.
 */
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

  const body = await readLimitedJson(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const payload = statusBatchRequestSchema.safeParse(body.value);
  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Status batch request validation failed.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const backend = fragmentBackend();
    const outcome = backend === "mongodb"
      ? await applyMongoStatusBatch(payload.data.changes)
      : await applyGitHubStatusBatch(payload.data.changes);

    switch (outcome.kind) {
      case "committed":
        return NextResponse.json({
          fragments: outcome.fragments,
          commit: backend === "github" ? outcome.commit : null,
        });
      case "missing":
        return NextResponse.json(
          { error: "部分 Fragment 已不存在，請重新載入後再調整。", missing: outcome.missing },
          { status: 404 },
        );
      case "conflict":
        return NextResponse.json(
          {
            error: "部分 Fragment 已被其他操作更新，請重新載入後再試一次。",
            conflicts: outcome.conflicts,
          },
          { status: 409 },
        );
      case "noop":
        return NextResponse.json(
          { error: "沒有需要更新的狀態。" },
          { status: 400 },
        );
      case "invalid":
        return NextResponse.json(
          {
            error: "部分 Fragment 未通過資料驗證，所有變更都未寫入。",
            invalid: outcome.invalid,
          },
          { status: 422 },
        );
    }
  } catch (error) {
    if (error instanceof GitHubApiError) {
      console.error("GitHub status batch failed:", error.status);
      return NextResponse.json({ error: "GitHub write failed." }, { status: 502 });
    }
    logSafeStorageError("fragment_batch", error);
    return NextResponse.json(
      { error: "Fragment status batch failed." },
      { status: 500 },
    );
  }
}
