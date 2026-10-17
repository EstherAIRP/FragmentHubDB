import { NextResponse } from "next/server";

import { isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";
import { fragmentBackend } from "@/lib/fragments/backend";
import { filterFragments } from "@/lib/fragments/query";
import { listMongoFragments } from "@/lib/mongodb/fragment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only, bearer-authenticated pagination over canonical MongoDB data. */
export async function GET(request: Request) {
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (fragmentBackend() !== "mongodb") {
    return NextResponse.json({ error: "MongoDB data store is not active." }, { status: 503 });
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit") ?? "50";
  const rawOffset = url.searchParams.get("offset") ?? "0";
  if (
    !/^\d{1,3}$/.test(rawLimit) ||
    !/^\d{1,8}$/.test(rawOffset) ||
    Number(rawLimit) < 1 ||
    Number(rawLimit) > 100
  ) {
    return NextResponse.json({ error: "Invalid pagination parameters." }, { status: 400 });
  }

  try {
    const items = filterFragments(await listMongoFragments(), {
      q: url.searchParams.get("q") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      domain: url.searchParams.get("domain") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
    });
    const offset = Number(rawOffset);
    const limit = Number(rawLimit);
    return NextResponse.json(
      { items: items.slice(offset, offset + limit), total: items.length, offset, limit },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Fragment data unavailable." }, { status: 503 });
  }
}
