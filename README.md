# FragmentHub

以 ChatGPT 協助整理工作、生活、學習與靈感碎片的私人管理系統。每筆 Fragment 都保留原始輸入，經使用者確認後保存為 GitHub JSON，再透過 Web 瀏覽與管理。

**ChatGPT 負責 AI 分析，GitHub 保存正式資料，Web 提供管理介面。** Web 不呼叫模型 API，也不需要 `OPENAI_API_KEY`。

## 目前功能

- **看板**：檢視待處理、進行中與卡住的項目，切換醞釀中檢視，依工作／個人範圍篩選。
- **狀態調整**：拖曳或使用「移到」選單建立變更，確認清單後一次儲存；支援取消與衝突處理。
- **Fragment 庫**：關鍵字搜尋，以及 Scope、Type、Status、Priority、Urgency、Domain、Tag 篩選。
- **詳細頁**：查看原始輸入、摘要、下一步、提問紀錄，以及 Project、Related、Backlink 關係。
- **手動新增與編輯**：驗證草稿、預覽 JSON，最終確認後寫入 GitHub；可將項目封存。
- **私人存取**：GitHub OAuth 登入、數字 ID 白名單與簽章 Session Cookie。

## 快速開始

### 1. 安裝與啟動

使用 **Node.js 24.x** 與 npm，於專案根目錄執行：

```bash
npm install
```

首次設定時，將 [`.env.example`](.env.example) 複製為 `.env.local`，再填入下一節的環境變數。已有 `.env.local` 時保留原設定。

```bash
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。私人頁面需要登入；未設定 OAuth 時，仍可執行資料驗證與測試，但無法瀏覽私人內容。

本機 OAuth 請使用對應的 GitHub OAuth App，將 `FRAGMENTHUB_PUBLIC_URL` 設為 `http://localhost:3000`，Callback URL 設為 `http://localhost:3000/api/auth/callback`。正式環境使用正式 HTTPS 網址與對應的 Callback，詳見[部署說明](docs/DEPLOYMENT.md)。

### 2. 設定環境變數

所有憑證僅供伺服器使用，不得加上 `NEXT_PUBLIC_` 前綴或提交至 Git。

| 變數 | 用途 |
| --- | --- |
| `FRAGMENTHUB_GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `FRAGMENTHUB_GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `FRAGMENTHUB_PUBLIC_URL` | 網站 origin，不含路徑或查詢參數；正式環境須使用 HTTPS |
| `FRAGMENTHUB_SESSION_SECRET` | 隨機 Session 簽章密鑰，至少 32 個字元 |
| `FRAGMENTHUB_ALLOWED_GITHUB_IDS` | 允許登入的不可變數字 GitHub user ID，以逗號分隔 |
| `FRAGMENTHUB_GITHUB_TOKEN` | GitHub 資料讀寫憑證；限定目標 Repository，授予 `Contents: Read and write` |
| `FRAGMENTHUB_GITHUB_REPOSITORY` | 選填，預設 `EstherAIRP/FragmentHub` |
| `FRAGMENTHUB_GITHUB_BRANCH` | 選填，預設 `main` |

**資料來源取決於是否設定 `FRAGMENTHUB_GITHUB_TOKEN`：**

- 未設定：讀取本機 `data/fragments/`，Web 正式儲存停用。
- 已設定：讀取 GitHub 即時資料，確認後的 Web 儲存會寫入指定 Repository／Branch，產生 Git commit。開發時請確認目標設定。

OAuth 憑證只負責確認登入身分；OAuth user access token 不持久保存，也不作為資料寫入憑證。詳細規則見[身分驗證規格](docs/AUTHENTICATION.md)。

## 使用流程與確認規則

### ChatGPT 整理碎片

```text
原始輸入 → AI 分類提案 → 討論與修改 → 使用者確認分類
                                            ↓
                                  選擇提問紀錄／跳過
                                            ↓
                              最終 Fragment 預覽 → 最終確認
                                            ↓
                                     寫入 GitHub JSON
```

- AI 提出的分類、標籤、優先度、關係與下一步都是提案；人工確認流程產生 `confirmed: true` 前，不得視為定案。
- 分類確認後才能進入提問紀錄模式；v0.1 最多六個已回答問題。
- 最終整理只能改寫 `title`、`summary`、`next_action`、`notes`；已確認的分類 metadata 與 `original_input` 必須由程式組裝原樣保留。
- 完成預覽並取得最終確認後，才能寫入正式資料。不得自動重新分類、合併、封存、刪除或調整既有 Fragment 優先度。

完整契約與 Prompt 說明見 [ChatGPT 操作契約](docs/CHATGPT_WORKFLOW.md)與 [Prompt 文件](config/prompts/README.md)。

### Web 手動管理

```text
新增／編輯 → 草稿驗證 → JSON 預覽 → 最終確認 → 已驗證身分的 API → GitHub
```

看板狀態調整也先保留本機變更，確認後才批次寫入。更新保留樂觀併發控制；資料已在別處更新時回傳 `409`，避免覆蓋新版本。

## 架構與資料規則

```text
ChatGPT                                 FragmentHub Web
分析／分類／提問／人工確認               瀏覽／搜尋／手動管理／人工確認
    │                                         │
    │                              已驗證身分的 API + Server-side Token
    ▼                                         ▼
                   GitHub Private Repository
                   data/fragments/*.json
                   正式資料 + Git 版本歷史
```

JSON 是唯一正式資料格式，工作與私人內容共用資料池，以 `scope` 等 metadata 分類：

```text
data/fragments/
├─ F-000001.json
├─ F-000002.json
└─ ...
```

- ID 使用 `F-000001` 格式，不編碼分類，也不以路徑區隔工作與私人內容。
- JSON 必須符合 `config/fragment.schema.json` 與 `lib/fragment-schema.ts`；建立或更新時必須通過 `lib/fragments/semantic-validator.ts`。
- Domain 只能使用 `config/domains.json` 的受控 ID；缺少分類時提出建議，不自行建立並寫入。
- `project`、`related` 必須引用既有 Fragment；`project` 的目標必須為 Project 類型。
- `original_input` 保留使用者最初文字，不以 AI 摘要覆寫。
- 優先封存；真正刪除必須由使用者明確要求，且不能留下指向該項目的 Project／Related 關係。
- `generated/index.json` 是可重建索引，不是正式資料來源。

**Private Repository 不等於私人網站。** 正式環境必須啟用身分驗證後才能提供私人內容；Fragment 資料、GitHub Token 與其他密鑰不得放入 `public/`。GitHub 存取維持在伺服器端，授權使用不可變的數字 GitHub user ID。


## 專案結構

```text
app/          Next.js 頁面與 API routes
components/   Web 介面元件
config/       Schema、分類規則、Domain 與 Prompts
data/fragments/  正式 Fragment JSON
generated/    可重建索引
lib/          身分驗證、資料驗證、查詢與 GitHub 存取
scripts/      資料驗證、索引與部署輔助腳本
tests/        自動化測試
docs/         規格、操作契約與部署文件
```

技術組合：Next.js、React、TypeScript、Zod、JSON Schema、GitHub API 與 Vercel。


## 文件索引

| 文件 | 內容 |
| --- | --- |
| [資料規格](docs/DATA_SPEC.md) | Fragment 欄位、分類與資料約束 |
| [資料層](docs/DATA_LAYER.md) | 本機／GitHub Store、驗證、ID 與併發控制 |
| [ChatGPT 操作契約](docs/CHATGPT_WORKFLOW.md) | AI 提案、人工確認、提問與最終組裝 |
| [Web MVP](docs/WEB_MVP.md) | 頁面、看板、搜尋、草稿與狀態操作 |
| [身分驗證](docs/AUTHENTICATION.md) | OAuth、PKCE、白名單與 Session |
| [部署說明](docs/DEPLOYMENT.md) | 環境變數、權限、部署與驗收 |
| [Agent 規則](AGENTS.md) | 開發與 AI 操作必須遵守的邊界 |
