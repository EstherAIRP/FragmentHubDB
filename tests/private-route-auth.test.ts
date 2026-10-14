import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { sessionCookieNameFor } from "../lib/auth-core";
import { config as proxyConfig, proxy } from "../proxy";

const root = path.resolve(__dirname, "..");
const privateDir = path.join(root, "app", "(private)");

function findPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findPages(full);
    return /^page\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Returns the body (text after the opening brace) of the default export. */
function defaultExportBody(source: string, file: string): string {
  const match = /export\s+default\s+async\s+function\s+\w*\s*\(/.exec(source);
  assert.ok(match, `${file}: default export must be an async function`);

  // Skip the parameter list, which may contain nested braces/parens.
  let depth = 1;
  let i = match.index + match[0].length;
  while (depth > 0 && i < source.length) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    i++;
  }

  // Skip an optional return type annotation up to the body's opening brace.
  const braceIndex = source.indexOf("{", i);
  assert.ok(braceIndex > 0, `${file}: function body not found`);
  return source.slice(braceIndex + 1);
}

const firstStatementGate =
  /^\s*(?:(?:const|let)\s+\w+\s*=\s*)?await\s+requireSession\(\s*\)\s*;/;

test("every private page calls requireSession() before any data access", () => {
  const pages = findPages(privateDir);
  const relative = pages.map((page) =>
    path.relative(privateDir, page).split(path.sep).join("/"),
  );

  for (const expected of [
    "page.tsx",
    "fragments/page.tsx",
    "fragments/new/page.tsx",
    "fragments/[id]/page.tsx",
    "fragments/[id]/edit/page.tsx",
  ]) {
    assert.ok(relative.includes(expected), `missing private page ${expected}`);
  }

  for (const page of pages) {
    const name = path.relative(root, page);
    const source = stripComments(readFileSync(page, "utf8"));

    assert.match(
      source,
      /import\s*\{[^}]*\brequireSession\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/,
      `${name}: must import requireSession from @/lib/auth`,
    );
    assert.doesNotMatch(
      source,
      /export\s+(?:const|async\s+function|function)\s+generate(?:Metadata|StaticParams)\b/,
      `${name}: generateMetadata/generateStaticParams run outside the page gate; guard them explicitly`,
    );

    const body = defaultExportBody(source, name);
    assert.match(
      body,
      firstStatementGate,
      `${name}: the first statement of the page must be \`await requireSession();\``,
    );
  }
});

test("private layout still resolves the session through requireSession()", () => {
  const source = stripComments(
    readFileSync(path.join(privateDir, "layout.tsx"), "utf8"),
  );
  assert.match(defaultExportBody(source, "layout.tsx"), firstStatementGate);
});

test("getCurrentSession reads cookies before the auth-config early return", () => {
  const source = readFileSync(path.join(root, "lib", "auth.ts"), "utf8");
  const start = source.indexOf("export async function getCurrentSession");
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf("\n}\n", start));

  const cookiesAt = body.indexOf("await cookies()");
  const configuredAt = body.indexOf("isAuthConfigured()");
  assert.ok(cookiesAt > 0, "getCurrentSession must call cookies()");
  assert.ok(
    cookiesAt < configuredAt,
    "cookies() must run before isAuthConfigured() so private routes are never prerendered",
  );

  const gateStart = source.indexOf("export async function requireSession");
  assert.ok(gateStart >= 0, "lib/auth.ts must export requireSession");
  const gate = source.slice(gateStart, source.indexOf("\n}\n", gateStart));
  assert.match(gate, /if\s*\(\s*!session\s*\)\s*\{?\s*redirect\(\s*["']\/login["']\s*\)/);
});

test("proxy redirects cookieless private requests to /login", () => {
  for (const pathname of ["/", "/fragments", "/fragments/F-000001/edit"]) {
    const variants: Record<string, string>[] = [{}, { RSC: "1" }];
    for (const headers of variants) {
      const response = proxy(
        new NextRequest(`https://fragmenthub.test${pathname}`, { headers }),
      );
      assert.equal(response.status, 307, pathname);
      assert.equal(
        response.headers.get("location"),
        "https://fragmenthub.test/login",
      );
    }
  }
});

test("proxy lets requests with a session cookie through to the page gate", () => {
  const request = new NextRequest("https://fragmenthub.test/fragments", {
    headers: {
      cookie: `${sessionCookieNameFor(process.env.NODE_ENV)}=signed.value`,
    },
  });
  const response = proxy(request);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
});

test("proxy only matches private page routes", () => {
  assert.deepEqual(proxyConfig.matcher, ["/", "/fragments", "/fragments/:path*"]);
  for (const pattern of proxyConfig.matcher) {
    assert.doesNotMatch(pattern, /^\/(api|login|_next)/);
  }
});
