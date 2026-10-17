# FragmentHubDB Agent 規則

## 一、產品規則（Product Rules）

FragmentHubDB 的設計核心是由使用者確認後才正式生效。

在實作 AI 輔助的 Fragment（片段）工作流程時，必須遵守以下規則：

1. AI 可以提出分類、標籤、優先級、緊急程度、領域、關聯、摘要及下一步行動的建議。
2. 所有 AI 建議的內容，在使用者確認前都不視為最終結果。
3. 使用者確認前，不得將新的 Fragment 寫入正式資料儲存區。
4. 若使用訪談模式，必須先展示完整整理結果，並取得使用者最終確認後才能寫入。
5. 不得自動重新分類、合併、封存、刪除現有 Fragment，或調整其優先級。
6. 必須保留 `original_input`（原始輸入）；AI 補充或分析的內容不得覆寫使用者的原始文字。

## 二、資料規則（Data Rules）

- JSON 是正式的標準資料格式。
- Fragment 的正式儲存來源由 `FragmentHubDB_DATA_STORE` 決定：切換後使用 MongoDB Atlas；`data/fragments/` 是舊版 GitHub JSON 來源及無破壞性遷移備份。
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
- GitHub 及 MongoDB Atlas 的存取操作都必須在伺服器端執行；Atlas URI 不得提交 Git 或交給瀏覽器。
- FragmentHubDB Web 不得直接呼叫模型 API。
- 未經身分驗證，不得開放正式環境存取私有 Fragment 內容。
- 網站身分驗證採用 GitHub OAuth、PKCE 與簽章工作階段 Cookie。
- 使用者授權必須依據 `FragmentHubDB_ALLOWED_GITHUB_IDS` 中設定的不可變更 GitHub 數字使用者 ID，不得使用可變更的使用者名稱作為授權依據。
- OAuth 身分驗證憑證必須與用於正式資料寫入的 `FragmentHubDB_GITHUB_TOKEN` 分開管理。
- 不得將 OAuth 使用者存取權杖儲存或重複用作 Fragment 資料的寫入憑證。

## 四、實作範圍（Scope）

GitHub Actions 可用於測試、型別檢查、建置及獨立的 MongoDB 測試資料庫整合驗證；不得在 CI 中匯入或更新正式 Fragment，也不得在未完成使用者確認前執行正式資料維護。

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
- ChatGPT 是唯一的 AI 分析介面。 不得在 FragmentHubDB Web 中新增模型 API 路由、模型 SDK 或 AI 自動分類功能。
- FragmentHubDB Web 的手動新增與編輯功能，可以對草稿進行驗證與預覽。
- 正式環境的資料寫入必須經已完成身分驗證的 Web API 或具備等效 Schema、語意驗證與人工確認的專用工具，並保留樂觀並行控制；不得因 MongoDB 外掛可直接寫入就跳過確認。

核心原則：AI 負責提出建議與整理內容，使用者負責確認決策；只有經過確認及驗證的資料，才能寫入正式儲存區。
## 六、MongoDB Atlas 儲存後端

- 當 `FragmentHubDB_DATA_STORE=mongodb`，Atlas `fragments` 集合為唯一正式資料來源，GitHub JSON 不可與 Atlas 同時寫入。
- 切換時先凍結 GitHub 寫入、進行 dry-run、明確執行匯入及讀回比對，再切換正式環境。
- Atlas 連線失敗不得默默退回 GitHub 或本機資料。
- 細節遵守 `docs/MONGODB_ATLAS.md`。
