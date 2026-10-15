/**
 * CSRF guard for browser requests authenticated by session cookies.
 * Do not apply it to machine clients authenticated by a Bearer token.
 * Canonical site origin is pinned; neither Host nor X-Forwarded-Host
 * can override the expected deployed origin.
 */
export function isTrustedBrowserMutation(
  request: Pick<Request, "headers" | "url">,
  publicUrl = process.env.FragmentHubDB_PUBLIC_URL,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin || suppliedOrigin === "null") return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const expected = publicUrl ??
    (nodeEnv === "development" || nodeEnv === "test"
      ? new URL(request.url).origin
      : null);
  if (!expected) return false;

  try {
    const origin = new URL(suppliedOrigin);
    const canonical = new URL(expected);
    const destination = new URL(request.url);
    // Require one serialized HTTP(S) Origin; no path, userinfo or query.
    if (!["http:", "https:"].includes(origin.protocol) ||
        suppliedOrigin !== origin.origin || origin.username || origin.password) {
      return false;
    }
    if (canonical.username || canonical.password ||
        canonical.search || canonical.hash || canonical.pathname !== "/") {
      return false;
    }
    return origin.origin === canonical.origin &&
      destination.origin === canonical.origin;
  } catch {
    return false;
  }
}
