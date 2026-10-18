# Phase 1：測試 Atlas 空庫初始化與 Schema Validator 部署準備

**狀態：已實作測試目標的初始化工具，但尚未對真實 Atlas 執行寫入。**

儲存庫：`EstherAIRP/FragmentHubDB`；分支：`feature/mongodb-atlas-store`。不得修改 `main`、Vercel Production、其他專案，或放寬 Atlas IP 白名單。

## 目標

為第一次 ChatGPT 直連寫入建立安全的測試環境：

- `fragments`：空集合，嚴格 MongoDB Validator，拒絕非法 BSON／欄位與不一致的 `_id`。
- `metadata`：嚴格 Validator，建立唯一初始資料 `{_id:"fragments",version:1,highest_allocated:0}`。
- 不自動建立 Fragment、不觸及現有 `chatgpt_proposals` 或其他資料。
- 保持 `DIRECT_WRITE_RELEASE_ENABLED=false`，不提前授予 ChatGPT 直寫能力。

## 執行模式

1. 離線預覽，**不連接 MongoDB**：

```powershell
npm run prepare:direct-mongo
npm run prepare:direct-mongo -- --dry-run
```

2. 唯讀確認 Atlas 測試資料庫的集合狀態（先自行檢查本機 `.env.local` 已設定 `FragmentHubDB_DATA_STORE=mongodb`、`FragmentHubDB_MONGODB_DATABASE=fragmenthubdb_test`）：

```powershell
npm run prepare:direct-mongo -- --inspect --expected-host=YOUR_CLUSTER_HOST.mongodb.net
```

只有遇到 Node DNS 解析問題時才附加 `--dns=8.8.8.8`；這只影響腳本程序，不修改系統 DNS。

3. **真實 Atlas 測試資料庫初始化：需另行取得使用者明確核准；本次不執行。**

```powershell
npm run prepare:direct-mongo -- --apply --confirm-target=fragmenthubdb_test --acknowledge-empty --expected-host=YOUR_CLUSTER_HOST.mongodb.net
```

所有旗標必須完整，hostname 必須與連線字串完全吻合。腳本不顯示 URI 或密碼，不會自動修正網路白名單。

## 防護措施

- 僅接受 `fragmenthubdb_test`（Atlas SRV hostname 符合 `*.mongodb.net`）或 `fragmenthubdb_bootstrap_ci`（僅 `CI=true` 且本機 `127.0.0.1:27017`）。
- Git remote 必須通過 FragmentHubDB origin 身分檢查；且資料來源設定必須是 MongoDB。
- 只接受 replica set primary；不接受單機不支援交易的模式。
- **任何既有集合（即使是空集合）都阻止初始化。** 不 drop、不 collMod、不覆蓋、不自動修復。
- 初始化失敗即停止，留下當下狀態供人工檢查；重新執行只會拒絕既存集合，避免遺失資料。
- 適用於第一次建立完全空白的測試資料庫，**不是**現有資料庫的 Schema migration 或資料補救工具。
- 由使用者在 Atlas Console 核對目標專案是 `FragmentHubDB-Test`、叢集為 `Cluster0`；hostname 檢查本身不能證明 Atlas 專案歸屬。
- 需要最小權限寫入身分與備份狀態評估後，才可進行真實部署；任何失敗均不得直接重試寫入。

## 自動驗收

- 單元測試：非測試 DB、錯誤 hostname、未確認、CI 連到 Atlas、CI 非 loopback 一律拒絕。
- 隔離 MongoDB 8 Replica Set：檢查完全空庫、建立兩個集合與 Validator、初始化 `highest_allocated=0`，非法文件遭 code 121 拒絕。
- Web 相容性：已有的交易式新增與編輯可在初始化後正常執行，且 `original_input` 不變。
- 冪等／安全性：第二次執行拒絕，既有資料不變。
- 原有 `npm test`、`typecheck`、`build`、MongoDB 遷移等 CI 均應保持通過。

驗收結果必須區分：**CI 模擬可通過，不代表已在 Atlas 或 ChatGPT 外掛實際完成寫入。** 下一步真實 Atlas 初始化必須另行核准。
