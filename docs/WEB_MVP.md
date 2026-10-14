# FragmentHub Web MVP

> Phase：4 — Web MVP
> 狀態：完成
> 架構：純資料管理介面，不執行 AI。

## 1. Web 的責任

FragmentHub Web 負責：

- GitHub OAuth 登入門
- 看板首頁
- Fragment List
- Search
- Filter
- Fragment Detail
- 手動新增草稿
- 手動編輯草稿
- Archive 狀態操作
- 看板「調整狀態」編輯模式：拖曳或「移到」批次調整狀態（確認後一次寫入）
- Project / Related / Backlink 顯示
- JSON 草稿預覽

Web 不負責：

- AI 分析
- AI 分類
- AI 提問
- AI Finalize
- OpenAI API 呼叫
- 自動寫入 GitHub

### 目前手動儲存介面

新增與編輯採單欄表單，不再顯示「待儲存 JSON」側面板。按「建立 Fragment」或「儲存變更」後，先驗證草稿，再開啟中文內容確認視窗；按「確認儲存」才呼叫 Phase 5 寫入 API。返回編輯或按 Esc 不寫入，修改後必須重新確認。儲存失敗時保留內容與錯誤訊息，更新仍傳送 `expected_updated_at`。下方 Phase 4 的 JSON 預覽描述為原階段驗收流程。

## 2. Routes

主要路由：

- /login
- /
- /fragments
- /fragments/new
- /fragments/[id]
- /fragments/[id]/edit

### /login

GitHub OAuth 登入頁。

流程：

GitHub OAuth → numeric GitHub ID allowlist → FragmentHub signed session。

需要環境變數：

- FRAGMENTHUB_GITHUB_CLIENT_ID
- FRAGMENTHUB_GITHUB_CLIENT_SECRET
- FRAGMENTHUB_PUBLIC_URL
- FRAGMENTHUB_SESSION_SECRET
- FRAGMENTHUB_ALLOWED_GITHUB_IDS

Session 使用 HttpOnly Cookie。

### /

看板首頁：

- 檢視切換：`看板`（預設）／`醞釀中`（`?view=incubating`）
- 範圍切換：`全部`／`工作`／`個人`（`?scope=work|personal`），兩個參數互相保留
- 看板三欄：待處理（`inbox`）、進行中（`active`）、卡住（`waiting`），欄標題顯示數量
- 每欄依分數（priority + urgency，high 3／medium 2／low 1／none 0）由高到低，再依 `updated_at` 由新到舊排序
- 進行中超過 3 件時顯示提示，不阻擋操作
- 看板下方顯示「近 7 天完成 N 件」，連到 `/fragments?status=done`（保留 scope）；以 `updated_at` 作為完成時間的近似值
- 醞釀中檢視列出 `incubating` Fragment，依 `updated_at` 由新到舊
- `archived` 不出現在看板或醞釀中，仍可在 Fragment 庫篩選

一般模式為唯讀：卡片只連到詳細頁，不能直接改狀態。卡片資料只送出顯示需要的欄位（標題、下一步、優先度、前兩個 domain 標籤、scope）加上 `id`、`status`、`updated_at`，不送 `original_input`、`notes`、`interview` 等內容。

「調整狀態」按鈕（GitHub Remote 未設定時停用）進入編輯模式：

- 顯示五個放置區：醞釀中（上方托盤）、待處理／進行中／卡住（三欄）、完成（下方托盤），沿用目前的 scope 篩選；`archived` 不顯示、也不是放置區。
- 以 `@dnd-kit/core` 拖曳（滑鼠、觸控長按、鍵盤：拖曳把手上按空白鍵／Enter 拿起，方向鍵在狀態區間跳動，再按一次放下，Esc 取消），並有中文螢幕閱讀器提示。
- 每張卡片另有「移到 ▸」選單（含分隔的封存）作為鍵盤／手機替代方式；只改本機狀態，不寫入。封存的卡片離開畫面，但列在變更清單中，可「復原」。
- 欄內位置不重要，欄位仍依分數排序；只有目標狀態算數。改過的卡片顯示「待處理 → 進行中」標記，移回原狀態即從變更清單移除。
- 底部固定列「N 項變更 [取消] [儲存]」；編輯模式下卡片不可點進詳細頁；有未儲存變更時，重新整理／關閉分頁與站內連結都會先確認。
- 「儲存」先開確認對話框列出每一項變更（例如「F-000003 標題：待處理 → 進行中」），按「確認」才呼叫 `POST /api/fragments/status-batch`，以每張卡片載入時的 `updated_at` 作為 `expected_updated_at`，全部成功或全部不寫入（單一 commit）。
- 409：列出已在別處更新的項目並移除那些變更，重新載入資料後保留其他變更；404／422：列出項目與原因，變更保留；401：提示重新登入；其他錯誤顯示訊息並保留變更。

### /fragments

支援：

- 關鍵字搜尋
- Scope
- Type
- Status
- Priority
- Urgency
- Domain
- Tag

搜尋範圍包含 ID、Title、Summary、Domain、Tag。

### /fragments/[id]

顯示：

- 完整內容
- Original input
- Notes
- Interview
- Metadata
- Project
- Related
- Backlinks
- Project children

### /fragments/new

純手動新增，不呼叫 AI。

使用者自行設定 Scope、Type、Status、Priority、Urgency、Domains、Tags、Project、Related、Title、Summary、Next action、Original input、Notes。

Phase 4 只驗證並預覽 JSON，不正式寫入 GitHub。

### /fragments/[id]/edit

手動編輯既有 Fragment 草稿。

保護規則：

- id 不可修改
- created_at 不可修改
- original_input 在 Web Edit 中為唯讀
- 既有 interview 保留
- 既有 source 保留
- Archive 只是把草稿 status 改成 archived

正式儲存留到 Phase 5。

## 3. Authentication

正式 Authentication 採 GitHub OAuth。

所有 (private) Route Group 會先檢查 signed Session Cookie，未登入則導向 /login。

GitHub OAuth 使用 PKCE + state，Callback 後以 numeric GitHub user ID 對照 allowlist。

Repository 為 Private 不代表 Vercel 網站本身是 Private，因此 Web 身分驗證仍是必要的。

詳細規格見 docs/AUTHENTICATION.md。

## 4. Manual Draft

手動新增／編輯使用 lib/fragments/manual-draft.ts。

草稿會經 Zod 驗證，Domain 仍受 config/domains.json 限制。

新增草稿預覽不會產生真正的 Fragment ID、created_at、updated_at；這些仍由 Phase 2 Data Layer 在 Phase 5 正式 Save 時處理。

## 5. Search / Filter

查詢邏輯集中於 lib/fragments/query.ts，避免把搜尋規則散落在 React Component。

## 6. Relations

Detail 頁面直接顯示：

- Parent Project
- Related
- Backlinks
- Project children

Backlink 不需要寫回 Canonical JSON，仍由現有資料關係推導。

## 7. Phase 4 / Phase 5 邊界

Phase 4：

Read JSON → Browse / Search / Filter → Manual Edit → Validate Draft → Preview JSON

Phase 5：

Final Confirm → GitHub Store → Commit JSON → Refresh / Redeploy / Conflict Handling

所以 Phase 4 的「新增／編輯」代表 UI 與草稿流程完成，不代表資料已持久化。

## 8. Web MVP 驗收

Phase 4 完成條件：

1. 未登入無法查看私人頁面。
2. Dashboard 可讀取現有 Fragment。
3. List 可搜尋與篩選。
4. Detail 可查看完整資料與關聯。
5. New 可建立合法手動草稿。
6. Edit 可修改既有草稿且保留系統欄位。
7. Archive 可在 Edit 中設定。
8. JSON Preview 可呈現 Phase 5 待寫入內容。
9. Web Runtime 不存在 OpenAI API 呼叫。
10. Web 不需要 OPENAI_API_KEY。
