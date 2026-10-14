import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieNameFor } from "@/lib/auth-core";

/**
 * Defense in depth for the private pages: requests without a session cookie
 * are redirected to /login before any page code runs.
 *
 * This is an optimistic check only (cookie presence, no signature check).
 * The authoritative gate is requireSession() at the top of every
 * app/(private)/**\/page.tsx, and the API routes keep their own JSON 401s.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get(sessionCookieNameFor(process.env.NODE_ENV))?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// Positive allow-list of the private page routes only. /login, /api/*,
// /_next/* and static assets are intentionally not matched.
export const config = {
  matcher: ["/", "/fragments", "/fragments/:path*"],
};
