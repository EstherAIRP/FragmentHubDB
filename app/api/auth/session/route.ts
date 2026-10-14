import { NextResponse } from "next/server";

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

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const cookie = expiredSessionCookie();

  response.cookies.set(
    cookie.name,
    cookie.value,
    cookie.options,
  );

  return response;
}
