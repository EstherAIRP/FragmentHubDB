import { NextResponse } from "next/server";

import { isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";
import { fragmentIdSchema } from "@/lib/fragment-schema";
import { fragmentBackend } from "@/lib/fragments/backend";
import { getMongoFragment } from "@/lib/mongodb/fragment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (fragmentBackend() !== "mongodb") {
    return NextResponse.json({ error: "MongoDB data store is not active." }, { status: 503 });
  }
  const { id: rawId } = await context.params;
  const parsed = fragmentIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Fragment ID." }, { status: 400 });
  }
  try {
    const item = await getMongoFragment(parsed.data);
    return item
      ? NextResponse.json({ fragment: item }, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "Fragment not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Fragment data unavailable." }, { status: 503 });
  }
}
