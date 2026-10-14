# List / History 讀取優化實作計劃

> 狀態：待實作的架構計劃  
> 日期：2026-10-10  
> 範圍：首頁、列表、詳情讀取；衍生索引；Web 與 ChatGPT 確認後的寫入路徑

## 1. 目標與不變條件

- 首頁及一般 Fragment 列表只讀一份精簡索引，不再為每筆 Fragment 請求完整 JSON。
- 詳情頁按 ID 讀取單筆 `data/fragments/F-xxxxxx.json`；關聯名稱與反向關聯使用索引推導。
- `data/fragments/*.json` 仍是唯一正式資料。索引可從正式 JSON 完整重建，不接受使用者直接編輯。
- `list`、`history` 是顯示分組，不是 Fragment 的新狀態、資料夾或自動封存動作。
- 所有正式寫入仍須經人工確認、`lib/fragments/semantic-validator.ts` 驗證，更新仍須保留樂觀並行控制。
- Web 不新增 AI 分析或模型 API；OAuth、數字 GitHub ID 授權與伺服器端儲存憑證的邊界維持原設計。

## 2. List / History 規則

以伺服器當下時間計算 14 個完整的 24 小時，分組函式接受 `now` 參數以便測試。

| Fragment 條件 | 預設顯示位置 |
| --- | --- |
| `status = done` 且 `updated_at <= now - 14 days` | History |
| `status = done` 且更新未滿 14 天 | List |
| 其他非 `archived` 狀態 | List |
| `status = archived` | 不進預設 List / History；由明確的 Archived 篩選查看 |

分組在每次讀取索引時即時計算，不把 `list` / `history` 寫進 Fragment 或索引。因此時間跨過 14 天時不需要排程任務，也不修改正式資料。已完成 Fragment 若被編輯，`updated_at` 會更新，將重新出現在 List；14 天後再進 History。這是本計劃採用的產品語意。

## 3. 索引資料契約

沿用伺服器端的 `generated/index.json` 作為衍生索引，為它新增明確版本與 runtime schema。每筆紀錄只包含列表、篩選及關聯所需欄位：

```text
id, title, scope, type, status, priority, urgency,
domains, tags, project, related, backlinks, updated_at
```

`title` 是辨識列表項目所需的最小內容。索引不存 `original_input`、`notes`、`interview` 或完整詳細內容；這些只從單筆 JSON 讀取。索引不得放在 `public/`，也不得透過未驗證的 API 提供。

現有卡片會顯示 `summary` 與 `next_action`；改用精簡索引後，列表卡片改為僅顯示索引欄位，詳情頁保留完整內容。若後續需要摘要預覽，可明確增加一個有長度限制的顯示欄位，並同步評估隱私與索引大小。

現有關鍵字搜尋涵蓋 `summary`、`next_action`、`notes`、`original_input`。為避免功能退化：一般列表的快速搜尋使用索引欄位；使用者選擇「搜尋完整內容」時才讀取完整 Fragment 並執行原有搜尋邏輯。介面需清楚區分兩種搜尋範圍。

## 4. 讀取路徑

```text
首頁 / List / History / 關聯選項
  → 已驗證的伺服器路由
  → 從 GitHub 讀 generated/index.json（一次請求）
  → 在伺服器計算分組、統計、篩選

詳情 / 編輯
  → 已驗證的伺服器路由
  → 直接讀單筆 data/fragments/F-xxxxxx.json
  → 如需關聯名稱、backlinks，再讀精簡索引
```

本機開發讀本機 Fragment 與索引；索引不存在或格式錯誤時，顯示明確錯誤並提供重建指令。Production 不應靜默退回已打包在部署中的舊資料。讀取暫不加跨請求快取，以維持經共用 writer 寫入後的即時可見性；完成基準量測後再決定是否需要快取。

## 5. 寫入一致性

目前 Web 的 GitHub Contents API 寫入只更新單筆 JSON；若分兩次提交 Fragment 與索引，任何一步失敗都可能讓列表和詳情不一致。因此正式遠端寫入須改為**同一個 Git commit 同時更新單筆 JSON 和 `generated/index.json`**。

建議將遠端寫入集中為一個 server-only writer：

1. 讀取同一個 branch HEAD 下的正式 Fragment 與索引；索引只作投影，不作語意驗證的唯一依據。
2. Create 配發 `F-xxxxxx`；Update 檢查使用者送來的 `expected_updated_at` 及目前檔案版本。
3. 將候選 Fragment 交給既有 semantic validator，並檢查 project children 等跨筆規則。
4. 從確認後的 Fragment 集合產生新版索引；建立包含「單筆 JSON + 索引」的 Git tree 與 commit。
5. 非強制更新 branch ref；若 HEAD 在期間改變，重新載入並重試。目標 Fragment 已變更時回傳 409，Create 遇到 ID 競爭時重新配發。不可覆蓋較新的資料。
6. 成功回應只在 branch ref 更新完成後送出；首頁隨後讀取最新索引。

ChatGPT 流程必須在分類與最終結果均由人確認後，呼叫同一個 writer 的受控入口（例如專用 CLI 或受保護的伺服器端操作）。在該入口完成以前，ChatGPT 不應直接提交單筆 JSON 並宣稱列表會同步。CLI 也須保留 `original_input`、受控 Domain、訪談題數上限及既有確認流程。

## 6. 既有資料、修復與部署

- 擴充 `scripts/build-index.ts`：從全部正式 JSON 重建新版索引；先執行既有 JSON Schema、Zod 與 semantic validation。
- 導入時先用現有 `data/fragments/*.json` 產生初版索引，檢查筆數、ID、欄位與反向關聯，再切換頁面讀取路徑。
- 提供 `validate:index`：比較索引與正式 JSON 重建結果。若有人直接在 GitHub 修改 Fragment 而未同步索引，執行此檢查時必須失敗並指出差異。單純讀索引無法立即發現這類繞過 writer 的修改，所以正式寫入入口必須集中管理。
- 提供明確的修復指令，從正式 JSON 重建並提交索引；修復不得修改 Fragment 內容。
- `vercel-ignore-build.sh` 可繼續略過純資料／索引提交，因 production 讀取 GitHub 最新內容。若 deployment 缺少 GitHub token，或索引遺失／格式錯誤，應顯示錯誤，不使用舊的 build 產物冒充最新資料；內容不一致由 `validate:index` 檢出並修復。

## 7. 實作順序

1. **資料契約**：定義索引 schema、投影函式、List / History 分組函式及一致性檢查。
2. **讀取端**：新增索引讀取介面，讓首頁、列表、新增表單的關聯選項改讀索引；詳情與編輯改為單筆讀取加索引關聯。保留完整內容搜尋入口。
3. **寫入端**：抽出共用 writer，完成單一 Git commit、ID 競爭重試與 Update 409；Web API 接入。
4. **ChatGPT 入口**：提供使用相同 writer 的受控操作，明確要求兩次人工確認，並測試不得在確認前寫入。
5. **遷移與文件**：重建索引、更新資料層與部署文件、量測請求次數及頁面耗時。

## 8. 驗收條件

- 首頁、一般 List、History 各只需讀取一份遠端索引；不因 Fragment 數量增加而產生逐筆內容請求。
- 點進詳情才讀該筆完整 JSON；既有關聯、backlinks、project children 仍正確。
- `done` 項目在第 14 天邊界正確換組；`archived` 不會因分組邏輯被修改或刪除。
- Create、Edit、Archive 經確認後，同一個 Git commit 內包含 Fragment 與索引；新資料立即出現在首頁。
- 並行建立不重複 ID；過期編輯回傳 409；任何寫入失敗都不留下「索引已更新、Fragment 未更新」或相反的正式狀態。
- `original_input`、Domain、關聯、Schema 與 semantic validation 規則持續有效。
- 完整內容搜尋仍能找到只出現在 `notes` 或 `original_input` 的字詞。
- 索引可重建且可驗證；直接修改正式 JSON 造成的索引差異可被檢出。
- 執行 `npm run test`、`npm run typecheck`、`npm run build`，並用至少數十筆測試資料比較改造前後的 GitHub 請求數及頁面耗時。

## 9. 暫不納入

- 將正式內容拆成 Markdown、建立第二份正式資料來源。
- 新增資料庫、外部快取服務或 GitHub Actions 排程。
- 自動改變 Fragment 的 `status`、`priority`、分類或封存狀態。
