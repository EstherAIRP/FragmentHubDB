# FragmentHubDB — Vercel 開發分支預覽部署

> 僅供測試環境驗收。本文件所述部署**不**合併或改動 `main`、不切換正式資料來源、不匯入舊 Fragment。

## 獨立預覽環境

- Vercel 專案：`fragment-hub-db`
- GitHub Repository：`EstherAIRP/FragmentHubDB`
- 開發分支：`feature/mongodb-atlas-store`
- 部署目標：**Preview**（正式環境仍由 `main` 控制）
- 固定分支預覽網址：`https://fragment-hub-db-git-feature-mongodb-cd5c25-esther1oos-projects.vercel.app`

此分支預覽與正式部署共用**同一個 Vercel 專案**，但使用不同部署目標及分支專用環境變數。請不要將測試資料庫憑證加到 Production。

## Preview 專用環境變數

在 Vercel 專案設定 → Environment Variables，**Target: Preview**，且 **Git Branch: `feature/mongodb-atlas-store`**：

| 名稱 | 用途 |
|---|---|
| `FragmentHubDB_DATA_STORE` | `mongodb` |
| `FragmentHubDB_MONGODB_DATABASE` | `fragmenthubdb_test` |
| `FragmentHubDB_PUBLIC_URL` | 上述固定分支預覽網址（須與實際用來登入的網址一致） |
| `FragmentHubDB_SESSION_SECRET` | 獨立產生的至少 32 位元組亂數；**只存 Vercel Sensitive env** |
| `FragmentHubDB_ALLOWED_GITHUB_IDS` | 已授權 GitHub 登入者的**數字** ID |
| `FragmentHubDB_CHATGPT_OWNER_GITHUB_ID` | 指定可核准 ChatGPT 提案的 GitHub 數字 ID |
| `FragmentHubDB_MONGODB_URI` | **待使用者在 Vercel Sensitive env 私下填入**，只連到 FragmentHubDB 專用測試 Atlas |
| `FragmentHubDB_GITHUB_CLIENT_ID` | 已於測試分支 Preview 設定；只記錄名稱，不記錄值 |
| `FragmentHubDB_GITHUB_CLIENT_SECRET` | 已於測試分支 Preview 的 Sensitive env 設定；更新後須重新部署 |
| `FragmentHubDB_CHATGPT_API_TOKEN` | **待工具連線階段設定**：獨立 Bearer token；未設定時 ChatGPT API 維持停用 |

GitHub OAuth App 的 Homepage URL 指向上述固定分支預覽網址；Authorization callback URL 為：

```text
https://fragment-hub-db-git-feature-mongodb-cd5c25-esther1oos-projects.vercel.app/api/auth/callback
```

不應使用每次部署可能改變的 `fragment-hub-<random>...` 網址做 OAuth callback。OAuth callback 設定完成且預覽站可存取後，才開始登入測試。

## 安全限制與進度

1. Atlas `fragmenthubdb_test` 已在**使用者本機**通過唯讀、transaction commit、rollback、temporary collection cleanup 測試；但尚未驗證 Vercel 出口至 Atlas 的連線。
2. Atlas Network Access 的本機 IP 白名單**不**等於允許 Vercel 的雲端出口 IP。請先評估專用固定出口／網路政策再決定允許來源，不要在未告知風險前直接開放 `0.0.0.0/0`。
3. Vercel 的預覽網址可能啟用 Vercel Authentication（部署保護），這對未登入的 API 工具與 GitHub OAuth callback 測試有影響；**不要為了方便就直接關閉私人資料的保護**。若須允許外部工具呼叫，另規劃身分驗證、安全入口或專用測試網域。
4. 禁止複製其他系統的 GitHub OAuth secret、Session secret、MongoDB URI。所有敏感變數不得提交 Git、放在 `NEXT_PUBLIC_` 或貼到聊天。
5. `FragmentHubDB_DATA_STORE=mongodb` 代表測試站不會默默回退到 GitHub；在 `FragmentHubDB_MONGODB_URI` 未設定前，正式讀寫 API 不會連上 Atlas，屬預期的「尚未完成設定」狀態。
6. 正式 Fragment 仍為零筆；此 Preview 上線不代表可以遷移或匯入真實資料。
7. 設定或修改 Vercel 環境變數後，必須產生**新部署**才會生效；同 Commit 重新部署可能被 `vercel.json` 的 ignore-build 規則略過。

## 驗收順序

1. GitHub Actions 確認建置和 MongoDB 隔離測試通過。
2. 確認 Preview 的來源為 `feature/mongodb-atlas-store`，Production 仍為 `main`。
3. 確認 OAuth App 的固定網址回呼與私人路由授權正常。
4. 填好 Preview 專用 Atlas URI，檢查 Vercel 連線能否成功；若失敗，先處理 Atlas 網路存取控制，不要修改正式叢集。
5. 經使用者允許後，才在測試站驗證手動新增、語意檢查、原始輸入保留與交易。
6. ChatGPT 工具專用 Bearer token 及外部連線驗收必須另行進行，**Web 人工核准**仍是最後提交的唯一途徑。


## OAuth 設定後重新部署

當使用者在 Vercel 新增 `FragmentHubDB_GITHUB_CLIENT_ID` 或
`FragmentHubDB_GITHUB_CLIENT_SECRET` 後，應確認：

- 兩者皆設為 **Preview → Git Branch: feature/mongodb-atlas-store**，且不勾選 Production。
- 憑證值不需貼到 GitHub、CI、聊天或文件；此文件只記錄環境變數名稱。
- 重新建立**新 Preview Deployment**，使最新設定載入；只看舊部署的 Ready 狀態不能推論新憑證已生效。
- GitHub OAuth 將以固定分支預覽網址作為 `FragmentHubDB_PUBLIC_URL` 與 callback origin；若啟用了 Vercel Deployment Protection，須先確保測試者有存取權。
- 本機 Atlas 已驗證交易，但未設定 `FragmentHubDB_MONGODB_URI` 前，預覽版尚無資料庫連線，不能視為完整上線。



## OAuth 失敗排查（2026-10-15）

實際登入曾出現 GitHub OAuth callback 伺服器錯誤：

```text
The client_id and/or client_secret passed are incorrect.
```

先檢查 **Vercel 部署建立時間**與 `FragmentHubDB_GITHUB_CLIENT_ID`、`FragmentHubDB_GITHUB_CLIENT_SECRET` **環境變數最後更新時間**。如果部署比設定舊，即使 Vercel 控制台已顯示新值，網站執行環境仍會使用舊憑證。部署紀錄應顯示來源為 `feature/mongodb-atlas-store`、target 為 Preview，不能以 Production `main` 的部署代替。

此專案的 `vercel.json` 設有 `ignoreCommand`；**相同 Git Commit 的重新部署可能被取消（ignored build step）**，即使環境變數剛更新。因此更新密鑰後請先驗證實際部署已成功，必要時在本分支建立有意義的文件或程式提交，觸發新 Git Commit 的 Preview 建置。不可修改 Production 或降低分支保護。

若**全新且 Ready** 的 Preview 部署仍回傳同一錯誤，再確認 GitHub OAuth App 的 Client ID 與 Secret 來自**同一個 OAuth App**；必要時在該 App 產生新 Secret，更新 Vercel 的 Preview 分支環境變數，並重複完整的新部署檢查。不要把 GitHub OAuth Secret、OAuth code、access token 或其他密鑰輸出到公開日誌、GitHub 或聊天中。


## 2026-10-15 Client ID 再次更新後的部署核對

在排查 GitHub 授權端點 404 時，確認 `FragmentHubDB_GITHUB_CLIENT_ID` 的 Vercel Preview 環境變數於**前一次成功的 Preview 部署之後再次更新**。Vercel 後續因環境變數更新觸發的 `main` 部署被 ignored-build 規則取消，並沒有讓新值套用到 **`feature/mongodb-atlas-store`** 的已部署伺服器。

處理方式：只更新本測試分支文件，觸發新的 Preview 建置；然後以 Vercel 的部署 ID、Git Commit 與 Ready 狀態，確認其建立時間晚於 Client ID 和 Secret 的更新時間。尚未完成新部署前，不應推論 GitHub 404 是新版憑證或授權參數的問題。正式 `main`、既有資料與其他 Vercel 專案不變。
