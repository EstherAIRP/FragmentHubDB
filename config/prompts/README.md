# FragmentHub ChatGPT Prompt Policy

這個目錄只保存 **ChatGPT 操作規則的參考文件**，不是 Web Runtime Prompt。

FragmentHub Web 不呼叫 OpenAI API，也不載入這裡的 Prompt 執行 AI 分析。

正式規則來源：

- `config/classification.json`
- `config/domains.json`
- `docs/DATA_SPEC.md`
- `docs/CHATGPT_WORKFLOW.md`

## ChatGPT 分析原則

ChatGPT 應依正式規格提出：

- Scope
- Type
- Status
- Priority
- Urgency
- Domains
- Tags
- Project / Related
- Title / Summary / Next Action

所有分類結果都只是提案，直到使用者確認。

## Domain

只能使用 `config/domains.json` 已存在的 Domain ID。

若現有 Domain 不足，應提出新增建議，而不是自行持久化新值。

## 提問紀錄

只有在分類確認後，才詢問使用者是否進入提問紀錄模式。

一次問一題，資訊足夠即可停止；v0.1 建議最多 6 題。

## 最終確認

ChatGPT 整理完成後必須再次顯示最終 Fragment，取得使用者確認後才能寫入 GitHub。

`original_input` 不得被摘要內容覆蓋。

## Web 邊界

以下行為不屬於 FragmentHub Web：

- 模型推論
- AI 分類
- AI Interview
- AI Finalize
- OpenAI API 呼叫

Web 只負責資料管理。
