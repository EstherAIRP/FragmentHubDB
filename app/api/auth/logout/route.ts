import { NextResponse } from "next/server";

import {
  expiredFlowCookie,
  expiredSessionCookie,
} from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  const sessionCookie = expiredSessionCookie();
  const flowCookie = expiredFlowCookie();

  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
  response.cookies.set(
    flowCookie.name,
    flowCookie.value,
    flowCookie.options,
  );

  return response;
}
