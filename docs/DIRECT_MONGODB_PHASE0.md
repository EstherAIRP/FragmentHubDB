# Phase 0 驗收紀錄 — ChatGPT 直連 Atlas × Web 雙寫入

> 狀態：程式契約基線建立中；**真實外掛驗收未完成**。
> 範圍：`EstherAIRP/FragmentHubDB` 的 `feature/mongodb-atlas-store`，只讀原始程式與測試資料。
> 禁止本階段修改 Vercel Production、Atlas 帳號／白名單、正式 Fragment 或合併 Draft PR。

## 專案現況與相依

- Web 的 `withMongoFragmentWrite()` 在交易內先更新 `metadata.version`。
- Web 新增使用 `metadata.highest_allocated` 與既有 ID 保護不重用 ID。
- Web 修改使用 `updated_at` 樂觀鎖；直接 MongoDB CRUD **不會**自動共用 Web 交易語意。
- JSON 契約：`config/fragment.schema.json`；分類：`config/classification.json`；受控領域：`config/domains.json`。
- 舊版相依：`prebuild -> build:index -> data/fragments`，`validate:data` 仍在 CI；不能未驗證就移除。
- `app/api/chatgpt/**`、`chatgpt_proposals` 與備份涵蓋範圍仍存在；此階段不移除。
- MongoDB Atlas 外掛已可於 ChatGPT 外掛目錄找到，但此專案尚未連接；無從宣稱其支援必要原子操作／交易。

## 真實外掛能力待驗證（必須人工授權）

| 能力 | Phase 0 狀態 |
| --- | --- |
| 只讀查詢指定 DB / collection | 待連接外掛驗證 |
| `findOneAndUpdate`、原子 `$inc`、返回更新後值 | 未證實 |
| `updateOne` 複合 filter 與 `matchedCount` | 未證實 |
| MongoDB session 與多文件 transaction | 未證實 |
| 逾時、重試與操作回傳語意 | 未證實 |
| GPT 專用最小權限與 Atlas 限定網路來源 | 未證實 |

**禁止用本機 Driver 測試結果代替真實 ChatGPT 外掛測試。**

## Release Gate

- `DIRECT_WRITE_RELEASE_ENABLED=false`：Phase 0 程式層的 advisory gate，沒有寫入操作，也不會授權任何 MongoDB 外掛。
- 不可只靠這個布林值視為安全：正式直寫必須另以 Atlas 帳號／工具本身的權限阻止越權操作。
- 若 Atlas 網路連線必須依賴 `0.0.0.0/0`，或原子配號、CAS 能力不足，直寫維持停用。
- 正式寫入前須完成隔離 MongoDB CI、實際外掛讀寫能力實測以及使用者再次授權。

## P0 CI 驗收項目

- P0-01：Schema、分類枚舉、Domain 與 ChatGPT 規則模板欄位白名單一致。
- P0-02：未啟用時，即使有確認與能力訊號，所有變更意圖均拒絕；啟用後仍須再查確認、能力與範圍。
- P0-03：新檔案不含連線秘密或跨儲存庫寫入；不新增模型 API 依賴。
- P0-04：`npm test`、`npm run typecheck`、`npm run build` 全過，確保 Web 原路徑不受影響。

## 阻擋與後續

真實外掛能力與權限尚未驗證，因此 **Phase 0 外部 Gate = BLOCKED**。下一步是由使用者自行授權安裝 MongoDB Atlas 外掛，先採只讀測試；不更改 IP 白名單。
