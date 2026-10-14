# FragmentHub Authentication

> 狀態：正式架構
> 參考實作：MilkboxViewer 的 GitHub OAuth + PKCE + signed session 模式
> FragmentHub 簡化版：不含 resident mapping、preview handoff、audit。

## 1. 目標

FragmentHub Web 不使用自訂密碼登入。

正式登入方式：

~~~text
GitHub OAuth
    ↓
確認 GitHub user identity
    ↓
numeric GitHub ID allowlist
    ↓
FragmentHub signed session
    ↓
Private Web access
~~~

GitHub OAuth 只負責確認登入者是誰。

正式 Fragment JSON 的 GitHub 讀寫仍使用獨立的 Server-side FRAGMENTHUB_GITHUB_TOKEN。

## 2. numeric GitHub ID

GitHub username 可以改名，因此授權判斷不以 login 字串作為永久識別。

FragmentHub 使用 GitHub user.id 作為 allowlist 主鍵。

環境變數：

~~~text
FRAGMENTHUB_ALLOWED_GITHUB_IDS=12345678,87654321
~~~

可允許一個或多個 GitHub 帳號。

## 3. OAuth Flow

~~~text
/login
    ↓
GET /api/auth/login
    ↓
產生 state + PKCE verifier/challenge
    ↓
暫存 signed OAuth flow cookie
    ↓
GitHub /login/oauth/authorize
    ↓
GET /api/auth/callback
    ↓
驗證 state / flow cookie
    ↓
使用 code + code_verifier 交換 access token
    ↓
GET https://api.github.com/user
    ↓
取得 numeric id / login / avatar
    ↓
檢查 FRAGMENTHUB_ALLOWED_GITHUB_IDS
    ↓
簽發 FragmentHub session cookie
    ↓
redirect /
~~~

OAuth flow 使用 PKCE S256 與不可預測的 state。

## 4. Session

Session Cookie：

~~~text
__Host-fragmenthub_session
~~~

Production 屬性：

- HttpOnly
- Secure
- SameSite=Lax
- Path=/
- HMAC-SHA256 signed
- 7 days expiration

Session payload 只保存：

- numeric GitHub user ID
- GitHub login
- avatar URL
- expiration timestamp

GitHub OAuth access token 不保存進 cookie，也不作為 FragmentHub 資料寫入 token。

## 5. OAuth Flow Cookie

短期 OAuth state cookie：

~~~text
__Host-fragmenthub_oauth
~~~

內容包含：

- state
- PKCE verifier
- expiration timestamp

有效期 10 分鐘。

Callback 完成或失敗後都應清除。

## 6. Authorization

登入成功除了 OAuth identity 外，還必須：

~~~text
String(githubUser.id) ∈ FRAGMENTHUB_ALLOWED_GITHUB_IDS
~~~

不在 allowlist：

~~~text
OAuth 成功
→ 不建立 FragmentHub Session
→ redirect /login?error=forbidden
~~~

此規則與 Repository Storage Token 分離。

## 7. Credential Separation

Authentication credentials：

~~~text
FRAGMENTHUB_GITHUB_CLIENT_ID
FRAGMENTHUB_GITHUB_CLIENT_SECRET
FRAGMENTHUB_PUBLIC_URL
FRAGMENTHUB_SESSION_SECRET
FRAGMENTHUB_ALLOWED_GITHUB_IDS
~~~

用途：GitHub OAuth 與 FragmentHub Session。

Storage credential：

~~~text
FRAGMENTHUB_GITHUB_TOKEN
~~~

用途：Server-side 讀寫 EstherAIRP/FragmentHub 的 data/fragments/*.json。

不得把 OAuth user access token 當成 FragmentHub canonical data write token。

## 8. Web UI

登入頁只提供：

~~~text
[ 使用 GitHub 登入 ]
~~~

登入後導覽列顯示目前 GitHub identity：

~~~text
avatar  @login
~~~

並提供登出。

## 9. OAuth App 設定

建立 GitHub OAuth App。

Production Homepage URL：

~~~text
https://<fragmenthub-domain>
~~~

Authorization callback URL：

~~~text
https://<fragmenthub-domain>/api/auth/callback
~~~

FragmentHub v0.1 使用 production callback，不處理任意 Vercel Preview URL OAuth handoff。

## 10. Security invariants

- 必須驗證 OAuth state。
- 必須使用 PKCE S256。
- OAuth flow cookie 必須有短 expiration。
- Session 必須由 Server 簽章。
- Authorization 使用 numeric GitHub ID。
- OAuth Client Secret、Session Secret、Storage Token 均不得送到瀏覽器。
- Save API 仍需重新檢查 FragmentHub Session。
- OAuth user token 不持久化。
- Web 不因 GitHub username 改名而失去或取得權限。
