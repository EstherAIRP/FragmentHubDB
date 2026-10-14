import { NextRequest, NextResponse } from "next/server";

import {
  createSessionCookie,
  exchangeGitHubCode,
  expiredFlowCookie,
  expiredSessionCookie,
  fetchGitHubIdentity,
  getGitHubOAuthConfig,
  isAllowedGitHubIdentity,
  oauthFlowCookieName,
  verifyOAuthFlow,
} from "@/lib/auth";

function redirectToLogin(request: NextRequest, error: string) {
  const response = NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(error)}`, request.url),
    303,
  );

  const flowCookie = expiredFlowCookie();
  const sessionCookie = expiredSessionCookie();

  response.cookies.set(
    flowCookie.name,
    flowCookie.value,
    flowCookie.options,
  );
  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );

  return response;
}

export async function GET(request: NextRequest) {
  const denied = request.nextUrl.searchParams.get("error");

  if (denied) {
    return redirectToLogin(request, "cancelled");
  }

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";

  try {
    const config = getGitHubOAuthConfig();
    const flow = verifyOAuthFlow(
      request.cookies.get(oauthFlowCookieName())?.value,
      state,
      config,
    );

    if (!code || !flow) {
      return redirectToLogin(request, "invalid");
    }

    const accessToken = await exchangeGitHubCode(
      code,
      flow.verifier,
      config,
    );

    const identity = await fetchGitHubIdentity(accessToken);

    if (!isAllowedGitHubIdentity(identity.id, config)) {
      return redirectToLogin(request, "forbidden");
    }

    const response = NextResponse.redirect(
      new URL("/", request.url),
      303,
    );

    const flowCookie = expiredFlowCookie();
    const sessionCookie = createSessionCookie(identity, config);

    response.cookies.set(
      flowCookie.name,
      flowCookie.value,
      flowCookie.options,
    );
    response.cookies.set(
      sessionCookie.name,
      sessionCookie.value,
      sessionCookie.options,
    );

    return response;
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    return redirectToLogin(request, "unavailable");
  }
}
