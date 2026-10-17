# Phase 1 — Atlas BSON 驗證器（開發中）

> **預設不變更資料庫**。適用 `EstherAIRP/FragmentHubDB` 的 `feature/mongodb-atlas-store` 分支；`main`、Vercel Production、真實 Atlas 均不調整。

## 實作範圍

- `lib/mongodb/collection-validator.ts` 將 Canonical JSON Schema v0.1 的**支援子集**轉成 MongoDB `$jsonSchema`；遇到新且不支援的關鍵字就明確失敗，避免未來規範變更被忽略。
- `fragments` 包含 `_id` 的型別與格式驗證、必要欄位、枚舉、集合長度與欄位型別；根節點用 `$expr` 保證 `_id === id`。
- `domains` 必須是 `config/domains.json` 中已定義的 ID；巢狀 `source` 與 `ai` 必須符合既有契約。
- `metadata` 限制 `_id=fragments`、版本、分配高水位。高水位暫可缺少，以維持 Web 交易的原有先 upsert version 再更新高水位的行為。
- 不支援的 `format:date-time` 不會被錯誤地當作 Atlas 強制檢查；日期欄位目前仍是字串，由 Web Zod／語意層檢查。其他不可變欄位、關聯及使用者確認也不是 `$jsonSchema` 能全面保證的性質。
- 現有 `chatgpt_proposals` 未修改，舊提案與備份流程保留。

## 離線預檢

```bash
npm run prepare:direct-mongo
npm run prepare:direct-mongo -- --dry-run
```

以上只輸出安全的 schema 摘要與雜湊，**不連接 Atlas、不寫入任何資料**。帶 `--apply` 一律拒絕。實際對 Atlas 啟用驗證器，需等使用者授權、既存文件相容性盤點、網路可用、備份限制驗收後另行開發／執行。

## CI 驗收與阻擋條件

- P1-01：合法 v0.1 文件被允許寫入一次性測試 MongoDB，Web 可以讀回。
- P1-02：缺少必要欄位、額外欄位、錯誤 enum／類型、不合法 Domain／_id 不一致均被 MongoDB 拒絕。
- P1-03：既有 Web 新增與更新的交易流程在新增 validator 後仍可運作。
- P1-04：明確拒絕所有非 `fragmenthubdb_ci`／非 loopback／非 CI 的資料庫變更。
- P1-05：實際 Atlas 低權限自訂角色與網路來源驗證**尚未完成**；隔離 CI 不應冒充已核准真實權限。

**上線 Gate：未檢查既存文件、沒有實際外掛、Atlas 白名單／權限未驗證前，仍維持 ChatGPT 直寫禁用。**

## MongoDB 相關文件

MongoDB `$jsonSchema` 支援 Draft 4 的子集，不支援 `format`；使用 `additionalProperties:false` 時必須明列 `_id`。詳見 [官方文件](https://www.mongodb.com/docs/manual/reference/operator/query/jsonschema/) 與 [Schema 驗證提示](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/json-schema-tips/)。
