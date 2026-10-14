import { NextResponse } from "next/server";

import { isAuthenticated } from "@/lib/auth";
import {
  readLimitedJson,
  statusBatchRequestSchema,
} from "@/lib/fragments/status-batch";
import { isGitHubRemoteConfigured } from "@/lib/github/availability";
import { GitHubApiError } from "@/lib/github/client";
import { applyGitHubStatusBatch } from "@/lib/github/fragment-store";

/**
 * POST /api/fragments/status-batch
 *
 * Writes several human-confirmed kanban status moves as ONE GitHub commit,
 * all-or-nothing. Only `status` and `updated_at` change on each Fragment.
 */
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
    const outcome = await applyGitHubStatusBatch(payload.data.changes);

    switch (outcome.kind) {
      case "committed":
        return NextResponse.json({
          fragments: outcome.fragments,
          commit: outcome.commit,
        });

      case "missing":
        return NextResponse.json(
          {
            error: "部分 Fragment 已不存在，請重新載入後再調整。",
            missing: outcome.missing,
          },
          { status: 404 },
        );

      case "conflict":
        return NextResponse.json(
          {
            error:
              outcome.reason === "stale"
                ? "部分 Fragment 已在 GitHub 被更新，請重新載入後再調整。"
                : "GitHub 資料同時有其他更新，請重新載入後再試一次。",
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
      console.error(
        "GitHub status batch failed:",
        error.status,
        error.responseBody,
      );
      return NextResponse.json(
        { error: "GitHub write failed." },
        { status: 502 },
      );
    }

    console.error("Fragment status batch failed:", error);
    return NextResponse.json(
      { error: "Fragment status batch failed." },
      { status: 500 },
    );
  }
}
