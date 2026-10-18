import { NextResponse } from "next/server";

import classification from "@/config/classification.json";
import domains from "@/config/domains.json";
import { isAuthorizedChatGptRequest } from "@/lib/chatgpt/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedChatGptRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json(
    { classification, domains },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
