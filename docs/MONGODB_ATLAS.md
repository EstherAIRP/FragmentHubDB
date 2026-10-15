# FragmentHubDB → MongoDB Atlas 遷移指南

> 狀態：可選資料層，**預設未啟用**。完成匯入及驗證後才切換正式環境。

## 分工

- **ChatGPT**：AI 分類建議、討論、最終確認。
- **FragmentHubDB Web/API**：GitHub OAuth、使用者白名單、Schema 與語意驗證、並行控制。
- **MongoDB Atlas**：切換後唯一正式 Fragment 來源。資料庫預設 `fragmenthubdb`，集合 `fragments`。
- **GitHub**：保留程式碼、分類設定、Prompt、規則及原始 JSON 備份。

Web 使用官方 MongoDB Node.js Driver；Atlas 舊版 App Services Data API 已於 2025-09-30 結束服務，不應使用。ChatGPT 若要直接操作 Atlas，必須另行連接經授權的 MongoDB 工具。**通用 MongoDB 外掛寫入會繞過 FragmentHubDB Web 的語意驗證**，應優先透過具備同等驗證的專用寫入工具。

## 資料契約

- Fragment 欄位維持原本 JSON/Zod Schema，不改寫 `original_input`。
- MongoDB `_id` 直接使用 `F-000001` 格式；不改採 ObjectId。
- 新增依唯一 `_id` 避免競爭碰撞；更新使用 `expected_updated_at` 原子條件檢查。
- `metadata` 交易同步文件另維護 `highest_allocated`；已刪除的最大 Fragment 編號仍不會再次發給新資料。
- 看板批次狀態更新以 MongoDB Transaction 一次提交或一次取消。
- MongoDB 快照**不等於 Git 歷史**；逐筆版本紀錄須另外設計 audit/history 集合。

## 跨碎片寫入一致性

MongoDB 儲存採用以下兩個集合：

- `fragments`：正式 Fragment 文件，`_id` 為 `F-000001` 格式。
- `metadata`：交易同步文件 `_id: "fragments"`，`version` 僅作為寫入同步計數器，**不是 Fragment 或版本歷史**。

正式 API 的新增、編輯、刪除及看板狀態批次，都在同一個 MongoDB 交易內先更新 `metadata` 同步文件，再讀取與檢查 Fragment 關聯、最後寫入正式內容。並行請求因共用同步文件產生交易衝突時，MongoDB 驅動程式會按交易規則重新嘗試，使新快照能看到其他已提交的變更。

此設計依賴 Atlas 的交易支援及資料庫帳號對 `fragments`、`metadata` 集合的讀寫權限。**任何直接透過 MongoDB 外掛、資料庫主控台或外部程式寫入 `fragments` 的行為都會繞過這個同步機制與人類確認流程**；正式操作應走 FragmentHubDB 的受保護 API。遷移腳本屬離線作業，執行前必須停止正式寫入。


## 無正式憑證的 MongoDB 整合測試

此開發分支的 GitHub Actions 會在 GitHub-hosted runner 中啟動**獨立的 MongoDB 8 單節點 Replica Set**，執行：

```bash
npm run test:mongodb:integration
```

測試使用固定的本機連線 `127.0.0.1:27017` 與隔離資料庫 `fragmenthubdb_ci`，並強制要求 `CI=true`。不符合條件會直接中止。測試會清除**測試資料庫**，故絕不可使用正式 Atlas URI。測試情境包含 CRUD、原始輸入不可覆寫、ID 刪除後不重用、失效引用拒絕刪除、陳舊版本拒絕覆寫、看板批次原子性、並行更新及**故意失敗後的交易回滾**。

CI 另會演練本專案既有 JSON 的 dry-run → 單次交易匯入 → 再次 dry-run → 全量讀回比對 → 新 ID 分配。這是 MongoDB 真實交易的自動化驗證，但**不等同於已測試使用者正式 Atlas 叢集**，上線前仍須執行 Atlas 專屬網路、權限、連線及遷移預檢。

## 設定 Atlas

1. 建立 Atlas Free Cluster、專用資料庫使用者（最小必要權限），設定 Network Access。
2. 若以一般 Vercel 動態出口 IP 連接，Atlas 官方整合文件指出可能需要 `0.0.0.0/0`；此範圍允許全球 IP 嘗試連線，應以最小權限帳號、高強度密碼保護；可使用固定出口／私有網路時優先限縮。
3. 取得 Driver 連線字串，僅存於本機 `.env.local` 或 Vercel 伺服器端環境變數；不得貼到聊天、提交 Git 或加上 `NEXT_PUBLIC_`。
4. 設定如下（密碼需作 URL 編碼）：

~~~dotenv
FragmentHubDB_MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/?retryWrites=true&w=majority
FragmentHubDB_MONGODB_DATABASE=fragmenthubdb
~~~

此專案僅接受 `FragmentHubDB_MONGODB_URI`，不使用通用 `MONGODB_URI`。若透過 Atlas／Vercel 整合取得連線字串，請將它設定為本專案專屬的環境變數。

## 無破壞性匯入與切換

1. **先暫停舊 GitHub 寫入**，以防來源在遷移期間變動。
2. 在受信任的本機環境下載／更新 **`EstherAIRP/FragmentHubDB`** 的正確來源分支，確認 `data/fragments/*.json` 包含完整正式資料。匯入工具會檢查 `git remote origin`，若不指向這個儲存庫就拒絕執行，包括預檢模式。若 `data/fragments/` 有未提交變更，也會拒絕匯入並顯示來源 Commit。
3. 先只驗證（命令會載入專案 `.env.local` 的 Atlas 連線設定）：

~~~bash
npm install
npm run validate:data
npm run doctor:mongodb
npm run migrate:mongodb
~~~

`doctor:mongodb` 只讀取、檢查 Atlas 連線與伺服器拓樸是否支援交易，並驗證已存在的 Fragment；不會建立或更改資料。執行時若尚未建立碎片集合，正常顯示 0 筆。

匯入完成後，請再執行 `npm run doctor:mongodb -- --strict`。嚴格模式會要求至少有一筆 Fragment，並檢查 `metadata` 交易同步紀錄及 `highest_allocated` 是否完整且涵蓋所有現存 Fragment ID；這是唯讀的正式切換檢查，不會修復或寫入資料。

4. 檢查 dry-run 顯示的來源、已存在與待匯入筆數；確認後才執行：

~~~bash
npm run migrate:mongodb -- --apply
~~~

匯入會在**單一 MongoDB 交易**中重新讀取並驗證目標快照、只新增缺少的 ID、設定 `metadata.highest_allocated`、在交易內核對結果；任何一步失敗都會中止整批交易，不會留下部分匯入。已存在相同文件會略過，同 ID 不同內容則拒絕。**Atlas 若有來源儲存庫不存在的碎片，會立即中止**，避免混入其他資料。所有來源及 Atlas 文件都會接受跨碎片語意驗證；完成後逐筆讀回核對，原 JSON 不會刪除。

5. 驗證 Atlas 筆數與 Web 搜尋、詳情、關聯。
6. **確認同步完成後**，才在 Vercel 設定：

~~~dotenv
FragmentHubDB_DATA_STORE=mongodb
~~~

重新部署；依序測試登入、清單、詳細頁、新增、編輯、409 衝突與看板批次確認。

7. 不再繼續向 GitHub JSON 寫入正式 Fragment。如需回滾，先將 Atlas 新增或更新過的資料同步回 GitHub，避免直接讀取舊快照而遺失資料。

## 後端選擇

| 設定 | 行為 |
| --- | --- |
| `mongodb` | 只存取 Atlas，失敗時不回退 |
| `github` | 維持原 GitHub Remote Store |
| `local` | 本機 JSON 唯讀，Web 儲存停用 |
| 未設定 | 暫保留舊行為：有 GitHub Token 選 GitHub，否則 local |

## 資安與驗收

目前 Repository 若公開，過去提交於 `data/fragments` 的內容可能仍出現在 Git history。**改存 Atlas 不會清除 GitHub 歷史資料**。須另外評估公開紀錄的移除、備份與資料權限，不可僅刪除目前分支的 JSON。

上線前至少檢查：未登入不能讀寫、無 Atlas 憑證不回退、ID 不碰撞、舊版本寫入回 409、`original_input` 不變、批次寫入原子性、連線字串不進瀏覽器、網站不呼叫模型 API。

## 開發環境限制

- `fragment-hub` Vercel 專案連接的是另一個 GitHub 儲存庫，不可用於 FragmentHubDB 的部署或資料庫測試。
- FragmentHubDB 的 Atlas URI 與正式網站專案必須獨立設定，不能借用其他專案環境變數。
- 舊 GitHub 資料後端僅允許 `FragmentHubDB_GITHUB_REPOSITORY=EstherAIRP/FragmentHubDB`；即使誤設為 `EstherAIRP/FragmentHub` 也會拒絕執行，不能跨專案寫入。
- 隔離 MongoDB 8 的整合測試、資料搬遷演練與完整建置已透過 CI 驗證；**Atlas 專用環境的連線、網路、權限與正式資料遷移仍未驗收**，PR 必須維持草稿。

### MongoDB 資料庫命名護欄

資料庫名稱必須為 `fragmenthubdb`，或以 `fragmenthubdb-`、`fragmenthubdb_` 開頭的環境專用名稱，例如 `fragmenthubdb_test`。`FragmentHubDB_MONGODB_DATABASE` 指向其他專案的資料庫名稱時會直接拒絕操作。
