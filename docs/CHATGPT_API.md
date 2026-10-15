# FragmentHubDB ChatGPT 專用 API（草稿 PR）

> 狀態：已實作於 `feature/mongodb-atlas-store`；尚未部署、尚未連線到正式 Atlas，請勿以此視為已可從 ChatGPT 線上呼叫。

## 設計原則

- **只能存取 FragmentHubDB**：正式資料寫入限 `FragmentHubDB_DATA_STORE=mongodb`，不會回退到 GitHub JSON。
- **ChatGPT Bearer token 不是人工確認憑證**：工具可以查詢、建立待確認提案與取得狀態，但沒有核准權。
- **使用者本人在 Web 按下最後確認**：透過 GitHub OAuth 簽章工作階段、數字 ID 白名單、指定 owner 和同源 POST 檢查。
- **正式提交使用 MongoDB 交易**：同一交易內重驗關聯、分配不重複 ID、插入 Fragment、標記 proposal 已提交。重複核准不會新增第二筆。
- 待確認資料存入 **`chatgpt_proposals`** 集合，與正式 `fragments` 分開；30 分鐘過期並建立 TTL 索引。過期檢查在應用程式進行，不依賴 TTL 清理即時完成。
- ChatGPT 操作 `original_input` 必須保留人類原始輸入；若用戶更改分類，必須重新預覽／核對。API 本身不提供 LLM 功能。

## 伺服器環境變數

```dotenv
FragmentHubDB_DATA_STORE=mongodb
FragmentHubDB_MONGODB_URI=<only store in server environment>
FragmentHubDB_MONGODB_DATABASE=fragmenthubdb

# Independent of OAuth and MongoDB credentials:
FragmentHubDB_CHATGPT_API_TOKEN=<random 32+ characters; recommend openssl rand -hex 32>
FragmentHubDB_CHATGPT_OWNER_GITHUB_ID=<allowlisted numeric GitHub ID>

# Existing GitHub OAuth configuration remains necessary for final approval:
FragmentHubDB_GITHUB_CLIENT_ID=<id>
FragmentHubDB_GITHUB_CLIENT_SECRET=<secret>
FragmentHubDB_PUBLIC_URL=https://your-dedicated-fragmenthubdb-host
FragmentHubDB_SESSION_SECRET=<secret>
FragmentHubDB_ALLOWED_GITHUB_IDS=<same numeric owner ID>
```

僅伺服器端保管 API token；不可提交 Git、不可設定 `NEXT_PUBLIC_`，也不可直接貼在 ChatGPT 對話。API token 與 MongoDB 的使用者／密碼不同。未設定或 owner 未列入 OAuth ID 白名單時，工具 API 預設拒絕存取。

## API（機器端：Bearer token）

每個請求帶 `Authorization: Bearer <token>`，回應的敏感內容設為 `Cache-Control: no-store`，不要放入公開快取。

| 方法 | 路徑 | 功能 |
| --- | --- | --- |
| GET | `/api/chatgpt/metadata` | 讀取分類規則、受控領域 |
| GET | `/api/chatgpt/fragments` | 讀取與搜尋碎片；支援 `q`、`scope`、`type`、`status`、`domain`、`tag`、`limit`（1–100）、`offset` |
| GET | `/api/chatgpt/fragments/{id}` | 讀取單筆完整 Fragment |
| POST | `/api/chatgpt/proposals` | 建立**待確認提案**，只寫 `chatgpt_proposals` |
| GET | `/api/chatgpt/proposals/{id}` | 查詢 `pending`、`expired`、`committed` 與新 Fragment ID |

OpenAPI：`docs/chatgpt-openapi.yaml`，**刻意不將網頁人工核准路由列為 ChatGPT 工具操作**。

### 提案格式

`POST /api/chatgpt/proposals`

```json
{
  "draft": {
    "scope": "personal",
    "type": "note",
    "status": "inbox",
    "priority": "none",
    "urgency": "none",
    "domains": [],
    "tags": ["mongodb"],
    "project": null,
    "related": [],
    "title": "理解 MongoDB 交易",
    "summary": "研究跨文件資料一致性",
    "next_action": null,
    "original_input": "我想了解 MongoDB 交易",
    "notes": null,
    "interview": [],
    "source": { "channel": "chatgpt" },
    "ai": { "classification_confirmed": true, "interview_used": false }
  }
}
```

工具必須先和使用者確認分類，然後提交最終完整草稿；即便 `classification_confirmed=true`，**仍不代表核准寫入**。

成功回傳：

```json
{
  "proposal_id": "<random opaque ID>",
  "status": "pending",
  "expires_at": "<ISO timestamp>",
  "review_path": "/chatgpt/review/<proposal_id>",
  "message": "Open the review page while logged in..."
}
```

### 人工核准路由（**不向 ChatGPT 暴露**）

登入 FragmentHubDB 網站後開啟 `review_path`，顯示完整草稿 JSON 讓人核對；由使用者按鈕以瀏覽器表單發出 `POST /api/chatgpt/proposals/{id}/approve`。伺服器必須驗證：

1. GitHub OAuth 簽章 session 有效，且 `session.id` 等於指定 owner。
2. `Origin` 與伺服器 `FragmentHubDB_PUBLIC_URL` 相同。
3. MongoDB 後端啟用、proposal 尚未過期且仍為 pending。
4. 正式資料語意檢查、關聯、ID 分配、狀態轉換可同一交易提交。

成功後 303 重導到新 Fragment 詳情；失效、重複提交或資料已變更則拒絕，不會部分寫入。ChatGPT 可透過狀態端點查詢結果，不需要也不能持有瀏覽器 session。

## 上線前尚未完成的事項

- 建立並連接 **FragmentHubDB 專用** Atlas 叢集、Web 與工具整合的獨立環境。
- 部署獨立的 FragmentHubDB 測試站，驗證 GitHub OAuth、同源 POST、正式 HTTPS 與實際網路權限。
- 在 ChatGPT 安全安裝或設定可持有 Bearer token 的專用工具；OpenAPI 檔案本身不會自動在 ChatGPT 安裝或連接 API。
- 完成資料備份、真正匯入與人工驗收後，才切換正式環境。
- 若需既有 Fragment 編輯或封存的 ChatGPT 兩階段流程，應另加提案類型及獨立的版本檢查；本版**只支援新增提案**。

此 API 不得使用或更動另一個獨立專案 `EstherAIRP/FragmentHub`。
