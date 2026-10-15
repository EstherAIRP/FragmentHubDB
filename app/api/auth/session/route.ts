import { NextResponse } from "next/server";
import { isTrustedBrowserMutation } from "@/lib/security/browser-mutation";

import {
  expiredSessionCookie,
  getCurrentSession,
  isAuthConfigured,
} from "@/lib/auth";

export async function GET() {
  const session = await getCurrentSession();

  return NextResponse.json({
    configured: isAuthConfigured(),
    authenticated: Boolean(session),
    user: session
      ? {
          id: session.id,
          login: session.login,
          avatarUrl: session.avatarUrl,
          expiresAt: new Date(session.exp).toISOString(),
        }
      : null,
  });
}

export async function POST(request: Request) {
  if (!isTrustedBrowserMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  const cookie = expiredSessionCookie();

  response.cookies.set(
    cookie.name,
    cookie.value,
    cookie.options,
  );

  return response;
}
