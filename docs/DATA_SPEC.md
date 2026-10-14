# FragmentHub 資料規格

> 規格版本：v0.1  
> 對應開發階段：Phase 1 — 資料規格  
> Source of Truth：`data/fragments/*.json`

## 1. 資料設計原則

FragmentHub 採單一資料池。所有 Fragment 都存放於：

```text
data/fragments/
```

工作與私人內容不以路徑、Repository 或 ID 前綴切割，而以 `scope` 欄位分類。

每筆 Fragment 是一份獨立 JSON。正式寫入 `data/fragments/` 的資料必須：

1. 已經過使用者確認。
2. 通過 JSON Schema 與語意規則驗證。
3. 擁有不可變的 Fragment ID。
4. 保留原始輸入 `original_input`。
5. 不依賴資料夾名稱表達分類語意。

---

## 2. Canonical Fragment

```json
{
  "schema_version": "0.1",
  "id": "F-000137",
  "created_at": "2026-10-02T16:00:00+08:00",
  "updated_at": "2026-10-02T16:00:00+08:00",

  "scope": "work",
  "type": "requirement",
  "status": "incubating",
  "priority": "high",
  "urgency": "medium",

  "domains": ["automation-rpa", "ai"],
  "tags": ["ocr", "screen-automation", "workflow"],

  "project": null,
  "related": [],

  "title": "AET RPA OCR 流程改善",
  "summary": "研究目前 OCR 與畫面判斷流程可縮短時間的方式。",
  "next_action": "盤點目前流程中耗時最高的 OCR 與畫面判斷步驟。",
  "original_input": "我想研究現在 AET RPA 的 OCR 流程還能不能再縮短時間。",
  "notes": null,

  "interview": [],

  "source": {
    "channel": "chatgpt"
  },

  "ai": {
    "classification_confirmed": true,
    "interview_used": false
  }
}
```

欄位順序不是 JSON 語意的一部分，但產生新 Fragment 時應盡量維持上述順序，方便 Git diff 與人工閱讀。

---

## 3. Identity

### 3.1 `schema_version`

目前固定為：

```json
"schema_version": "0.1"
```

Schema 產生破壞性變更時才提升版本。

### 3.2 `id`

格式：

```text
F-000001
```

規則：

- 固定 `F-` 前綴。
- 後接 6 位數字。
- 全 Repository 唯一。
- 建立後不可修改。
- 不包含 scope、type、日期或 project 語意。
- 檔名必須與 ID 一致，例如 `F-000137.json`。
- 不允許自我引用。

### 3.3 `created_at` / `updated_at`

使用 ISO 8601，必須包含時區。

例如：

```text
2026-10-02T16:00:00+08:00
```

規則：

- `created_at` 建立後不修改。
- `updated_at` 每次正式內容更新時更新。
- 純格式整理且資料語意未變時，不應更新 `updated_at`。

---

## 4. Scope

`scope` 表示 Fragment 的主要使用情境。

允許值：

| 值 | 說明 |
|---|---|
| `work` | 工作、公司、客戶、職務、工作專案相關 |
| `personal` | 個人生活、私人專案、創作、自主學習等 |

規則：

- 單值，不使用陣列。
- 不以資料夾分 scope。
- 若同時碰到工作與私人情境，選擇「主要用途／主要責任來源」作為 scope。
- scope 可經使用者確認後修改，ID 不變。

---

## 5. Type

每筆 Fragment 只有一個主要 `type`。

| Type | 中文 | 判斷原則 |
|---|---|---|
| `idea` | 靈感 | 構想、可能性、尚未形成明確執行範圍 |
| `task` | 待辦 | 已存在明確、可執行的單一行動 |
| `learning` | 學習 | 核心目的為理解、研究或學會某主題 |
| `requirement` | 需求 | 描述系統、流程、功能「應該做到什麼」 |
| `project` | 專案 | 有持續時間、明確目標，通常包含多個行動或 Fragment |
| `question` | 問題 | 核心內容是尚待回答或釐清的問題 |
| `decision` | 決策 | 保存已做出的選擇、理由與背景 |
| `tracking` | 追蹤 | 主要價值是等待、追蹤外部狀態或後續發展 |
| `resource` | 資源 | 保存可重複使用或查閱的外部資源 |
| `note` | 紀錄 | 不屬於以上類型的一般事實、備忘或紀錄 |

### 5.1 類型衝突

一段內容同時包含多種性質時，選擇「目前最主要意圖」作為主 type。

例如：

- 「研究某技術，之後做 PoC」若目前核心在研究，type 為 `learning`，PoC 放 `next_action`。
- 「做一個完整工具」且已形成多階段目標，可為 `project`。
- 「工具要支援匯出 JSON」屬 `requirement`，即使未來會形成 task。
- 「明天下班前寄信」屬 `task`。

不要用多個 type 解決模糊性；其他語意用 domains、tags、project、related 或 next_action 表達。

---

## 6. Status

Status 是 Fragment 的目前生命週期狀態。

| Status | 中文 | 說明 |
|---|---|---|
| `incubating` | 醞釀中 | 想法仍在成形、資訊仍少，暫不排入執行 |
| `inbox` | 待處理 | 已決定要處理，等待開始 |
| `active` | 進行中 | 正在執行、學習或推進 |
| `waiting` | 卡住 | 等待外部回覆、條件、時間或依賴而無法推進 |
| `done` | 完成 | 主要目的已完成 |
| `archived` | 已封存 | 不再主動處理，但保留紀錄；不顯示在看板上 |

### 6.1 建議狀態

Status 不強制固定轉移順序，但各 type 建議使用：

- idea：`incubating → inbox → active → done`
- learning：`incubating → inbox → active → done`
- requirement：`incubating → inbox → active/waiting → done`
- task：`inbox → active/waiting → done`
- project：`incubating → inbox → active/waiting → done`
- question：`incubating → inbox → done`
- decision：`incubating → inbox → done`
- tracking：`active/waiting → done`
- resource：`inbox → archived`
- note：`inbox → archived`

任何 type 都可在需要時使用 `archived`（優先於刪除）。

---

## 7. Priority 與 Urgency

兩者必須分開判斷。

### 7.1 Priority

表示「這件事本身有多重要」。

| 值 | 定義 |
|---|---|
| `high` | 對重要目標、成果、依賴、風險或價值有明顯影響 |
| `medium` | 有實質價值，但不是核心或關鍵事項 |
| `low` | 影響有限，延後通常不造成顯著損失 |
| `none` | 純資訊、資源或目前不適合判斷重要度 |

### 7.2 Urgency

表示「時間是否逼近」。

| 值 | 定義 |
|---|---|
| `high` | 需要很快處理，延遲可能造成截止、阻塞或損失 |
| `medium` | 近期處理較合適，但不是立即性 |
| `low` | 時間彈性大 |
| `none` | 沒有可辨識的時間壓力 |

GPT 不得因「重要」自動判為「急」，也不得因「快到期」自動判為高 priority。

---

## 8. Domains

`domains` 是相對穩定、受控的高階領域分類。

格式使用小寫 kebab-case 的機器 ID：

```json
"domains": ["ai", "automation-rpa"]
```

正式清單定義於：

```text
config/domains.json
```

初版領域：

| ID | 名稱 |
|---|---|
| `ai` | 人工智慧 |
| `software-development` | 軟體開發 |
| `computer-vision` | 電腦視覺 |
| `automation-rpa` | 自動化與 RPA |
| `knowledge-management` | 知識與資訊管理 |
| `ai-rpg` | AI RPG／角色互動 |
| `creative` | 創作 |
| `learning` | 學習與研究 |
| `life` | 生活 |
| `productivity` | 生產力與工作方法 |

規則：

- 可複選。
- 建議 1–3 個，最多 5 個。
- 優先使用既有 Domain，不因單次碎片建立過細領域。
- 新 Domain 應能持續承載多筆 Fragment，才值得加入受控清單。
- Domain 新增需更新 `config/domains.json`，不由 GPT 自動建立。
- GPT 遇到沒有合適 Domain 時，應提出「建議新增 Domain」而不是自行寫入新值。

---

## 9. Tags

`tags` 是自由、細粒度搜尋標籤。

格式：

```json
"tags": ["文件交付", "rpa介紹", "ocr"]
```

規則：

- 支援中文、英文與其他 Unicode 字母或數字，也可中英文混用；只允許字母／數字與內部連字號 `-`。
- 既有小寫英文 kebab-case 標籤仍有效，Domain ID 規則不變。
- 輸入時會做 Unicode NFC 正規化、去除前後空白、轉小寫，並將內部空白／底線轉為連字號；不合法符號由 Schema 拒絕。
- 建議 2–6 個，最多 12 個。
- 不重複 domains 已表達的高階概念，除非該詞本身也是重要搜尋詞。
- 避免完整句子。
- 避免一次性、無法重用的過細標籤。
- GPT 可自由提出，使用者確認後寫入。
- 同義詞應優先沿用既有拼法，減少 `llm-memory` / `memory-llm` 類型分裂。

---

## 10. Relations

### 10.1 `project`

```json
"project": "F-000021"
```

或：

```json
"project": null
```

規則：

- v0.1 一筆 Fragment 最多只有一個直接 parent project。
- 指向的 Fragment 必須存在且 `type = "project"`。
- 不得指向自己。
- Project 本身可為 `project: null`；v0.1 不建立巢狀 Project 規則。

### 10.2 `related`

```json
"related": ["F-000014", "F-000027"]
```

規則：

- 可指向任何 type。
- 不得包含自己。
- 不得重複。
- 指向的 Fragment 必須存在。
- 儲存層不要求雙向重複寫入。

若 A 的 `related` 包含 B，查詢層應把它視為 A 與 B 有關聯；B 不必因此同步修改 JSON。反向關聯由索引／查詢層計算。

這可避免建立一個關聯時必須同時修改兩個 Fragment。

---

## 11. Content

### 11.1 `title`

- 必填。
- 應能單獨辨識內容。
- 建議 10–60 個中文字或等價長度。
- 上限 120 字元。

### 11.2 `summary`

- 必填。
- 忠實濃縮目前 Fragment。
- 不加入原始內容沒有依據的推測。
- 上限 2000 字元。

### 11.3 `next_action`

- 可為字串或 `null`。
- 只有在存在清楚下一步時填寫。
- 不為了填欄位而製造待辦。

### 11.4 `original_input`

- 必填。
- 保存首次建立 Fragment 時使用者提供的原始內容。
- 建立後不被 AI 摘要或重寫覆蓋。
- 後續討論內容應寫入其他欄位。

### 11.5 `notes`

- 可為字串或 `null`。
- 保存無法適合放入 summary、next_action 或 interview 的補充內容。

---

## 12. Interview

`interview` 保存「提問紀錄模式」中實際發生的問答。

```json
"interview": [
  {
    "question": "第一版最核心的功能是什麼？",
    "answer": "先完成快速紀錄與 GPT 分類。"
  }
]
```

規則：

- 陣列順序就是問答順序。
- 跳過提問模式時為空陣列 `[]`。
- 只保存實際問過且使用者回答的問題。
- GPT 內部分析問題、未送出的問題不保存。
- 問答內容可在最終確認前修改。
- `ai.interview_used` 必須與 `interview.length > 0` 一致。

---

## 13. Source

```json
"source": {
  "channel": "chatgpt"
}
```

v0.1 支援：

- `chatgpt`
- `web`

`chatgpt`：由 ChatGPT 對話流程建立。  
`web`：由 FragmentHub 網頁流程建立。

---

## 14. AI Metadata

```json
"ai": {
  "classification_confirmed": true,
  "interview_used": false
}
```

正式存入 `data/fragments/` 的 Fragment 必須：

```json
"classification_confirmed": true
```

此欄位表達「GPT 提出的結構已經過使用者確認」，不是 GPT 自己判斷的信心值。

---

## 15. Canonical Data Invariants

除 JSON Schema 外，應由應用程式驗證以下語意規則：

1. 檔名必須等於 `<id>.json`。
2. ID 在 Repository 中唯一。
3. `project !== id`。
4. `related` 不得包含自身 ID。
5. `related` 參照必須存在。
6. `project` 參照必須存在且對方 type 為 `project`。
7. domains 必須存在於 `config/domains.json`。
8. `ai.classification_confirmed === true`。
9. `ai.interview_used === (interview.length > 0)`。
10. `created_at <= updated_at`。
11. `original_input` 不可為空。
12. 更新既有 Fragment 不得改變 `id` 或 `created_at`。

---

## 16. Phase 1 決策摘要

Phase 1 確立：

- 單一 Fragment JSON Schema。
- 單一 `F-xxxxxx` ID 空間。
- scope 單值。
- type 單一主類型。
- priority 與 urgency 分離。
- domains 採受控多值分類。
- tags 採自由多值分類。
- 一筆 Fragment 最多一個 parent project。
- related 不在 JSON 層強制雙向。
- interview 使用有序 Q/A 陣列。
- canonical data 只保存經使用者確認的 Fragment。
