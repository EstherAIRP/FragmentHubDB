# Phase 2 — MongoDB Atlas 外掛直連能力驗收與 CAS 配號協議

> 狀態：真實外掛**唯讀連線成功**；真實資料庫**尚未授權寫入**。Node Driver 的 CI 模擬測試不代表外掛 E2E 成功。

## 已驗證的真實能力（2026-10-17）

- 已連接 MongoDB Atlas 外掛，成功連線至專案 **FragmentHubDB-Test** 的 **Cluster0**。
- 可唯讀列出資料庫，並查詢指定 DB 的集合；目前 **fragmenthubdb_test 尚未建立集合**。
- Atlas Access List 的唯讀結果：現存兩筆網路規則；沒有 \`0.0.0.0/0\`。未更動網路規則。
- 外掛列出的工具包含 \`find\`、\`insert_many\`、\`update_many\`、\`count\`、\`collection_indexes\`。
- **未提供** \`findOneAndUpdate\`、\`updateOne\`、\`startSession\`、\`withTransaction\` 等工具。
- \`update_many\` 支援 \`filter\`、\`$inc\`、\`upsert:false\`，並回傳 \`matchedCount\`、\`modifiedCount\`；使用含唯一 \`_id\` 條件可安全定位單筆。
- 此能力盤點是**工具介面檢查**；尚未在真實 Atlas 使用寫入工具，不能宣稱寫入驗收完成或具備交易能力。

## 直接寫入 ID 配發的替代方案：find + update_many CAS

雖然外掛沒有 \`findOneAndUpdate\`，可以使用工具現有的比較交換（CAS）操作：

1. \`find\` 讀取 \`metadata\` 的 \`{_id:"fragments"}\`，取得 \`highest_allocated=H\`；若不存在、不合法或已達 \`999999\`，**停止**。
2. \`update_many\` 設定 \`filter:{_id:"fragments",highest_allocated:H}\`，\`update:{$inc:{highest_allocated:1}}\`，\`upsert:false\`。
3. **僅在 \`matchedCount===1\` 時**，配得唯一編號 \`F-(H+1)\`。若 \`matchedCount===0\`，重新讀取並限次重試。寫入衝突時也需讀回再判斷，不能猜測配得編號。
4. 在同一已確認會話中以固定 \`_id=id\` 執行 \`insert_many\`，陣列**只有一筆**完整 v0.1 Fragment（\`project=null\`、\`related=[]\`）；讀回後才能報告成功。
5. 若保留號碼成功而插入失敗，允許空號，但**絕不重用**。網路結果未知時先用固定 \`_id\` 讀回，不能重新分配第二個 ID。
6. \`metadata.version\` 不由 GPT 任意修改；與 Web Transaction 並行的共用文件爭用需要 CI 真實競態證明。

這是為了利用已存在的工具方法而設計的協議，**不是**一條已在 ChatGPT Atlas 實際寫入測試過的命令序列。外掛可執行一般 \`update_many\` 表示它也可能被用於未授權的其他寫入，僅靠 ChatGPT 專案文字規則無法強制安全。不得宣稱此方案可達到欄位級 DB 強制限制或跨文件交易一致性。

## 初始化限制

目前 \`fragmenthubdb_test\` 沒有集合與 \`metadata\`；因此 **GPT 配號必須拒絕並停止**，不得憑空猜測 \`F-000001\`、不得以未經核准的 \`upsert\` 初始化或把其誤判為資料遺失。

正式直寫前，應在資料庫綁定／權限與 Schema Validator 驗收後，另行取得使用者授權建立合法的 \`metadata({_id:"fragments",version:1,highest_allocated:0})\`，並且先確認目標確為 \`fragmenthubdb_test\`、集合為空、沒有既存高水位與歷史資料。若未來發現既有文件，必須計算其最大 ID 並人工核准初始化。也可以由既有 Web 交易式新增操作完成初始化。

## CI 測試與阻擋

- \`tests/mongodb-integration.test.ts\` 對隔離本機 MongoDB Replica Set 追加相同方法的 \`findOne\` + \`updateMany\` CAS 模擬測試；會驗證 Web 後續新增不碰撞、跳號不回收、競爭配號不重複、高水位不可溢位、缺少 metadata 要拒絕。
- 任何模擬通過都不能視為真實外掛的 \`insert_many\` 或 \`update_many\` 已測試。
- **真實 Atlas 寫入仍維持 BLOCKED**：資料庫尚未初始化，GPT 專用最小權限帳號、結構驗證器套用與外掛寫入範圍控制也尚未完成驗收。
- 禁止直接使用現成外掛的 \`drop\`、\`delete_many\` 或 Atlas 管理工具進行任何測試。

## 下一步

1. 隔離 CI 驗證 CAS 配號流程、衝突與高水位不可重用。
2. 評估外掛的資料庫身分是否可限制到測試 DB、特定集合，以及在一般 CRUD 權限下的殘餘風險。
3. 在**另外得到人工同意**後才討論如何把 Phase 1 Validator 套用到空的 \`fragmenthubdb_test\`，再做第一筆人工確認的測試 Fragment 直寫。
