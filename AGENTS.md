# FragmentHub Agent 規則

## 一、產品規則（Product Rules）

FragmentHub 的設計核心是由使用者確認後才正式生效。

在實作 AI 輔助的 Fragment（片段）工作流程時，必須遵守以下規則：

1. AI 可以提出分類、標籤、優先級、緊急程度、領域、關聯、摘要及下一步行動的建議。
2. 所有 AI 建議的內容，在使用者確認前都不視為最終結果。
3. 使用者確認前，不得將新的 Fragment 寫入正式資料儲存區。
4. 若使用訪談模式，必須先展示完整整理結果，並取得使用者最終確認後才能寫入。
5. 不得自動重新分類、合併、封存、刪除現有 Fragment，或調整其優先級。
6. 必須保留 `original_input`（原始輸入）；AI 補充或分析的內容不得覆寫使用者的原始文字。

## 二、資料規則（Data Rules）

- JSON 是正式的標準資料格式。
- Fragment 的正式資料存放於 `data/fragments/`。
- 不得將工作與個人資料拆分至不同的儲存路徑。
- 使用 `scope` 中繼資料區分工作與個人內容。
- Fragment ID 採用 `F-000001` 格式，不得在 ID 中編入分類資訊。
- JSON 必須符合 `config/fragment.schema.json` 與 `lib/fragment-schema.ts` 的規範。
- 建立或更新正式 Fragment 資料時，不得繞過 `lib/fragments/semantic-validator.ts` 的語意驗證。
- 領域 ID 必須使用 `config/domains.json` 中定義的受控 ID；AI 不得自行建立並儲存新的領域 ID。
- 更新已儲存的 Fragment 時，必須保留樂觀並行控制（Optimistic Concurrency Control）機制。
- 優先採用封存，而非刪除。任何永久刪除操作都必須由使用者明確要求，且刪除後不得留下其他專案或關聯資料指向已刪除 Fragment 的參照。

## 三、安全規則（Security Rules）

- 即使 GitHub 儲存庫是私有的，也不得假設部署後的網站同樣是私有的。
- 不得將 Fragment 資料、GitHub Token、模型 API 金鑰或其他機密資訊放置於 `public/` 目錄下。
- GitHub 存取操作必須在伺服器端執行。
- FragmentHub Web 不得直接呼叫模型 API。
- 未經身分驗證，不得開放正式環境存取私有 Fragment 內容。
- 網站身分驗證採用 GitHub OAuth、PKCE 與簽章工作階段 Cookie。
- 使用者授權必須依據 `FRAGMENTHUB_ALLOWED_GITHUB_IDS` 中設定的不可變更 GitHub 數字使用者 ID，不得使用可變更的使用者名稱作為授權依據。
- OAuth 身分驗證憑證必須與用於正式資料寫入的 `FRAGMENTHUB_GITHUB_TOKEN` 分開管理。
- 不得將 OAuth 使用者存取權杖儲存或重複用作 Fragment 資料的寫入憑證。

## 四、實作範圍（Scope）

除非出現明確的批次維護需求，否則 v0.1 版本刻意不納入 GitHub Actions。

## 五、AI 工作流程規則（AI Workflow Rules）

- AI 的分類結果一律視為建議，直到經過使用者確認流程並產生 `confirmed: true`，才視為正式確認。
- AI 只能儲存 `config/domains.json` 中已定義的領域 ID。若缺少適合的分類，必須將其呈現為新增建議，不得自行建立並默默儲存。
- 訪談模式只能在分類確認後啟動，且 v0.1 版本最多允許使用者回答六個問題。
- 最終整理階段只能改寫以下欄位：
  - `title`：標題
  - `summary`：摘要
  - `next_action`：下一步行動
  - `notes`：備註
- 最終整理時，必須透過程式組裝資料，確保已確認的分類中繼資料與 `original_input` 完全保留，不得由 AI 改寫。
- ChatGPT 是唯一的 AI 分析介面。 不得在 FragmentHub Web 中新增模型 API 路由、模型 SDK 或 AI 自動分類功能。
- FragmentHub Web 的手動新增與編輯功能，可以對草稿進行驗證與預覽。
- 正式環境的資料寫入必須透過已完成身分驗證的 Phase 5 GitHub API 路由，並保留樂觀並行控制機制。

核心原則：AI 負責提出建議與整理內容，使用者負責確認決策；只有經過確認及驗證的資料，才能寫入正式儲存區。