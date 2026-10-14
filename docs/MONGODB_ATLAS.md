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
- 看板批次狀態更新以 MongoDB Transaction 一次提交或一次取消。
- MongoDB 快照**不等於 Git 歷史**；逐筆版本紀錄須另外設計 audit/history 集合。

## 設定 Atlas

1. 建立 Atlas Free Cluster、專用資料庫使用者（最小必要權限），設定 Network Access。
2. 若以一般 Vercel 動態出口 IP 連接，Atlas 官方整合文件指出可能需要 `0.0.0.0/0`；此範圍允許全球 IP 嘗試連線，應以最小權限帳號、高強度密碼保護；可使用固定出口／私有網路時優先限縮。
3. 取得 Driver 連線字串，僅存於本機 `.env.local` 或 Vercel 伺服器端環境變數；不得貼到聊天、提交 Git 或加上 `NEXT_PUBLIC_`。
4. 設定如下（密碼需作 URL 編碼）：

~~~dotenv
FragmentHubDB_MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/?retryWrites=true&w=majority
FragmentHubDB_MONGODB_DATABASE=fragmenthubdb
~~~

也支援 Vercel Atlas 整合產生的 `MONGODB_URI`。

## 無破壞性匯入與切換

1. **先暫停舊 GitHub 寫入**，以防來源在遷移期間變動。
2. 在受信任的本機環境下載／更新正確的來源分支，確認 `data/fragments/*.json` 包含完整正式資料。
3. 先只驗證：

~~~bash
npm install
npm run validate:data
npm run migrate:mongodb
~~~

4. 檢查 dry-run 顯示的來源、已存在與待匯入筆數；確認後才執行：

~~~bash
npm run migrate:mongodb -- --apply
~~~

匯入只新增缺少的 ID，已存在相同文件略過，同 ID 不同內容則拒絕；完成後逐筆讀回核對，原 JSON 不會刪除。

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
