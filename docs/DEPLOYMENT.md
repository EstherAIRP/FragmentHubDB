# FragmentHubDB Deployment

> Phase：5 — GitHub / Vercel Integration  
> Architecture：ChatGPT → GitHub JSON ← FragmentHubDB Web

## 1. Runtime data flow

Production Web uses GitHub as the live data source when `FragmentHubDB_GITHUB_TOKEN` exists.

```text
FragmentHubDB Web
    ↓
authenticated API route
    ↓
server-side validation
    ↓
GitHub Contents API
    ↓
data/fragments/F-xxxxxx.json
```

After a successful write, Web reads GitHub directly, so the new Fragment is visible without waiting for a Vercel rebuild.

Without `FragmentHubDB_GITHUB_TOKEN`, local development falls back to the checked-out `data/fragments/` directory and Web save is disabled.

## 2. Required Vercel project

Import the private GitHub repository:

```text
EstherAIRP/FragmentHubDB
```

Recommended settings:

- Framework Preset：Next.js
- Root Directory：repository root
- Production Branch：main
- Node.js：20.9 or newer

No GitHub Actions deployment workflow is required. Use Vercel Git Integration.

## 3. GitHub OAuth App

Before setting Vercel secrets, create a GitHub OAuth App for FragmentHubDB.

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

Set:

~~~text
Application name:
FragmentHubDB

Homepage URL:
<FragmentHubDB_PUBLIC_URL>

Authorization callback URL:
<FragmentHubDB_PUBLIC_URL>/api/auth/callback
~~~

FragmentHubDB v0.1 uses the production callback only. Arbitrary Vercel Preview URLs are not OAuth callback targets.

After creating the OAuth App, copy its Client ID and generate a Client Secret. Store both only in Vercel Environment Variables.

The OAuth request intentionally does not request repository scopes. It uses the resulting token only once to call GitHub /user and resolve immutable numeric user identity.

## 4. Required environment variables

Production requires:

```text
FragmentHubDB_GITHUB_CLIENT_ID
FragmentHubDB_GITHUB_CLIENT_SECRET
FragmentHubDB_PUBLIC_URL
FragmentHubDB_SESSION_SECRET
FragmentHubDB_ALLOWED_GITHUB_IDS
FragmentHubDB_GITHUB_TOKEN
```

Optional because defaults already exist:

```text
FragmentHubDB_GITHUB_REPOSITORY=EstherAIRP/FragmentHubDB
FragmentHubDB_GITHUB_BRANCH=main
```

### FragmentHubDB_GITHUB_CLIENT_ID / FragmentHubDB_GITHUB_CLIENT_SECRET

GitHub OAuth App credentials used only for user authentication.

OAuth App callback URL must be:

```text
<FragmentHubDB_PUBLIC_URL>/api/auth/callback
```

### FragmentHubDB_PUBLIC_URL

Production origin only, for example:

```text
https://FragmentHubDB.example.com
```

v0.1 does not implement arbitrary Vercel Preview OAuth handoff.

### FragmentHubDB_ALLOWED_GITHUB_IDS

Comma-separated immutable numeric GitHub user IDs.

Example:

```text
12345678,87654321
```

GitHub username is not used as the durable authorization key.

How to find the numeric GitHub ID:

```text
GET https://api.github.com/users/<github-login>
→ read the numeric "id" field
```

For a single-user FragmentHubDB, configure exactly one numeric user ID.

### FragmentHubDB_SESSION_SECRET

Random session-signing secret. A suitable value can be generated locally with:

```bash
openssl rand -hex 32
```

### FragmentHubDB_GITHUB_TOKEN

Use a fine-grained GitHub token scoped to:

```text
EstherAIRP/FragmentHubDB
```

Minimum repository permission:

```text
Contents: Read and write
```

The token is server-side only and must not use a `NEXT_PUBLIC_` prefix.

## 5. Save flow

### Create

```text
Web form
→ Preview
→ Final confirm
→ POST /api/fragments
→ Allocate F-xxxxxx
→ Semantic validation
→ GitHub create
→ Redirect to Fragment Detail
```

### Update

```text
Web edit
→ Preview
→ Final confirm
→ PUT /api/fragments/[id]
→ compare expected_updated_at with GitHub
→ use current Content SHA
→ semantic validation
→ GitHub update
→ Redirect to Fragment Detail
```

If GitHub changed after the edit page was loaded, API returns HTTP 409 and does not overwrite the newer version.

## 6. Immutable fields

Web update cannot modify these fields even if a caller bypasses the UI:

- `id`
- `created_at`
- `original_input`
- `interview`
- `source`
- `ai`

These fields are restored from the current canonical GitHub Fragment on the server.

## 7. Data-only commits do not rebuild Vercel

A Web save creates a Git commit because GitHub is the Source of Truth.

Rebuilding Next.js for every Fragment would be wasteful, so `vercel.json` uses:

```text
scripts/vercel-ignore-build.sh
```

Behavior:

- only `data/fragments/**` or `generated/**` changed → exit 0 → Vercel ignores the build
- application/config/schema/docs changed → exit 1 → Vercel continues the build
- first deployment / missing previous SHA → build continues

This is safe because production pages read live Fragment data from GitHub instead of relying on build-time embedded data.

## 8. Authentication

Private routes are protected by the server layout.

Authentication flow:

```text
GitHub OAuth
→ PKCE + state verification
→ GET /user
→ numeric GitHub ID allowlist
→ signed FragmentHubDB session
```

Production session uses an HttpOnly, Secure, SameSite=Lax cookie.

The OAuth user access token is used only to resolve GitHub identity and is not persisted.

Save APIs independently verify the FragmentHubDB session before performing GitHub writes.

FragmentHubDB_GITHUB_TOKEN remains a separate server credential for canonical Fragment data access.

Logout clears the session cookie.

## 9. Deployment verification checklist

After the first production deployment:

1. Opening `/` while logged out redirects to `/login`.
2. GitHub OAuth starts from `/api/auth/login`.
3. Invalid / cancelled OAuth does not create a FragmentHubDB session.
4. GitHub identity not present in the numeric ID allowlist is rejected.
5. Allowed GitHub identity opens Dashboard.
6. Manual create shows a readable content confirmation dialog before save.
7. Save creates `data/fragments/F-xxxxxx.json` in GitHub.
8. Detail page immediately shows the new Fragment.
9. Edit updates the same JSON file.
10. Editing an old version produces HTTP 409 instead of overwriting newer data.
11. Archive updates `status` to `archived`.
12. Logout returns to `/login`.
13. A data-only commit is ignored by Vercel deployment.
14. No `OPENAI_API_KEY` or model runtime exists in the Web project.

## 10. Build verification

Before production activation run:

```bash
npm install
npm run test
npm run typecheck
npm run build
```

`npm run build` runs data validation and index generation through `prebuild`.

## 11. External activation boundary

Repository implementation does not contain user secrets.

A production deployment cannot be activated until the Vercel project exists, the GitHub OAuth App is registered, and the required OAuth/session/storage secret values are supplied by the account owner.
