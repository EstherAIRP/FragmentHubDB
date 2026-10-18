# FragmentHubDB ChatGPT 操作契約

> 對應階段：Phase 3  
> 核心原則：ChatGPT 是唯一 AI 分析入口；FragmentHubDB Web 不呼叫模型 API。

## 1. 分工

```text
ChatGPT
→ 分析 / 分類 / 討論 / 提問 / 確認 / 組裝 JSON

MongoDB Atlas（`FragmentHubDB_DATA_STORE=mongodb`）
→ Canonical Fragment JSON，存入 fragments 集合

GitHub
→ 程式碼、分類設定與切換前的舊版 JSON 備份

FragmentHubDB Web
→ 瀏覽 / 搜尋 / 篩選 / 手動管理
```

FragmentHubDB Repository 不提供 `/api/analyze`、`/api/interview`、`/api/finalize` 等 AI Runtime API，也不需要 `OPENAI_API_KEY`。

## 2. ChatGPT 建立流程

```text
使用者提出碎片
    ↓
ChatGPT 依 config/classification.json 與 config/domains.json 分析
    ↓
回報建議 Metadata
    ↓
使用者討論與修改
    ↓
使用者確認分類
    ↓
詢問是否進入提問紀錄模式
    ↓
提問 / 跳過
    ↓
產生最終 Fragment 預覽
    ↓
使用者再次確認
    ↓
透過 ChatGPT 專用 API 建立待確認提案（非正式 Fragment）
    ↓
登入 FragmentHubDB 網站檢視完整草稿
    ↓
使用者在網站明確核准
    ↓
MongoDB 交易式寫入正式 Fragment
```

## 3. 分析輸出

ChatGPT 建議：

- `scope`
- `type`
- `status`
- `priority`
- `urgency`
- `domains`
- `tags`
- `project`
- `related`
- `title`
- `summary`
- `next_action`
- `notes`

### Domain

`domains` 只能使用 `config/domains.json` 已存在的 ID。

若沒有適合的 Domain，ChatGPT 應提出「建議新增 Domain」，不得自行把新 Domain 寫入正式 Fragment。

### Relation

`project` 與 `related` 必須引用實際存在的 Fragment ID。

`project` 只能指向 `type = project` 的 Fragment。

## 4. 人工確認

ChatGPT 的第一次分析只是提案。

使用者確認前，不得：

- 寫入正式 Fragment
- 修改既有 Fragment
- 自動建立 relation
- 自動提高 Priority
- 自動封存
- 自動轉成 Project

如果使用者修改分類內容，應再次確認後才進入下一階段。

## 5. 提問紀錄模式

分類確認後，ChatGPT 詢問是否需要進入提問紀錄模式。

提問原則：

- 根據 `type` 與目前缺少的資訊動態提問。
- 一次問一個問題。
- 不重複使用者已經提供的資訊。
- 不為了填滿欄位而提問。
- 資訊已足夠時主動結束。
- v0.1 建議最多 6 題。

問答保存於：

```json
"interview": [
  {
    "question": "第一版最核心的完成條件是什麼？",
    "answer": "可以完整新增、搜尋與查看 Fragment。"
  }
]
```

## 6. 最終紀錄

最終整理可以改善：

- `title`
- `summary`
- `next_action`
- `notes`

但不得在沒有再次告知使用者的情況下修改已確認的分類 Metadata。

`original_input` 必須保留使用者最初輸入，不得以摘要取代。

## 7. Web 手動新增

Web 的手動新增不經過 ChatGPT。

使用者直接填寫 Metadata 與內容，Web 只做 Schema 檢查與 JSON 預覽。

正式儲存來源由 `FragmentHubDB_DATA_STORE` 選擇：啟用 MongoDB 後，Web 經伺服器端交易寫入 Atlas；未切換前仍依舊版 GitHub 設定運作。

## 8. 架構限制

後續開發不得：

- 在 Web 新增 OpenAI／其他模型 API
- 在瀏覽器端執行 AI 分類
- 新增第二套 AI Agent
- 要求 Web 使用 `OPENAI_API_KEY`

如未來需要 Web AI 功能，必須先修改 README 的正式架構決策，而不是直接加入實作。

## 9. ChatGPT 專用 API（第一版）

已在開發分支新增獨立 Bearer API，可查詢 `metadata`／`fragments`，也可提交待確認的新 Fragment 草稿。**ChatGPT 無權直接執行最後核准**；使用者必須登入本專案網站，透過確認頁面建立正式 Fragment。詳見 `docs/CHATGPT_API.md` 和 `docs/chatgpt-openapi.yaml`。

這項功能目前僅支援新增提案；既有 Fragment 的 AI 輔助編輯與封存尚未實作。完整 API 功能不等於已部署或已連接 ChatGPT。
