import { NextRequest, NextResponse } from "next/server";

import {
  createOAuthFlow,
  getGitHubOAuthConfig,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const config = getGitHubOAuthConfig();
    const flow = createOAuthFlow(config);
    const response = NextResponse.redirect(flow.authorizeUrl, 302);

    response.cookies.set(
      flow.cookie.name,
      flow.cookie.value,
      flow.cookie.options,
    );

    return response;
  } catch (error) {
    console.error("GitHub OAuth login initialization failed:", error);
    return NextResponse.redirect(
      new URL("/login?error=unconfigured", request.url),
      303,
    );
  }
}
