# Fragment Hub 開發提案文件

> 文件版本：v0.2  
> 文件狀態：正式開發基準  
> 日期：2026-10-02  
> 架構基準：單一 Private Repository／JSON Source of Truth／單一資料池／Metadata 分類

---

## 1. 專案背景

生活、工作、學習與創作過程中會持續產生大量尚未整理完成的碎片，例如：

- 尚未成熟的靈感與想法
- 工作待辦事項
- 想研究或學習的主題
- 新功能或工具需求
- 待追蹤事項
- 決策與討論結果
- 專案延伸構想
- 一般紀錄與備忘

這些內容在產生當下往往還沒有完整結構，也未必能立刻判斷應歸入哪個正式專案、待辦清單或知識分類。

Fragment Hub 的目的，是建立一個位於「原始想法」與「正式任務／專案／知識」之間的中間層：使用者先把內容丟進系統，再由 GPT 根據既定規則提出結構化分析，經使用者確認後才正式保存。

---

## 2. 專案定位

Fragment Hub 不是傳統 Todo List，也不是單純筆記系統。

其核心定位為：

> **以 GPT 作為分析與討論介面，以 GitHub 作為版本化資料儲存，以 Vercel 網站作為另一個操作入口的個人碎片管理系統。**

核心原則：

1. 先捕捉，再整理。
2. GPT 負責分析、預測與提出建議。
3. 使用者負責最終決策。
4. 未經確認，不正式寫入或修改資料。
5. 系統採被動式運作，不主動催促、整理或重分類既有紀錄。
6. 所有 Fragment 共享同一套資料結構，不以資料夾切割工作與私人內容。
7. JSON 為主要機器資料格式與唯一 Source of Truth。

---

## 3. 架構決策

### 3.1 單一 Repository

第一版只使用一個 Private Repository：

```text
FragmentHub
```

同一個 Repository 保存：

- Next.js / Vercel 應用程式
- ChatGPT 操作規格與分類規則文件
- Fragment Schema
- Fragment JSON 資料
- 搜尋索引產生邏輯
- 文件與開發規格

第一階段不拆分 Engine、Personal、Work 等多個 Repository。

### 3.2 單一資料池

所有 Fragment 統一放在：

```text
data/fragments/
```

不建立：

```text
data/personal/
data/work/
```

工作、私人或其他情境一律由資料欄位分類，而不是靠檔案路徑分類。

### 3.3 JSON Source of Truth

每筆 Fragment 使用獨立 JSON 檔案保存：

```text
data/fragments/F-000001.json
data/fragments/F-000002.json
data/fragments/F-000003.json
```

JSON 為唯一正式資料來源；Markdown 不作為核心儲存格式。

### 3.4 統一 ID

所有資料使用單一 ID 空間：

```text
F-000001
F-000002
F-000003
```

不使用 `P-`、`W-` 等前綴區分私人與工作。

原因是「工作／私人」屬於 Metadata，而不是永久識別碼的一部分。

---

## 4. 核心使用流程

```text
使用者提出碎片／需求
        ↓
GPT 依既定規則分析
        ↓
產生預分類結果
        ↓
回報分類細項與判斷摘要
        ↓
使用者與 GPT 討論、修改
        ↓
使用者確認分類結果
        ↓
詢問是否進入「提問紀錄模式」
        ↓
 ┌──────────────┴──────────────┐
 │                             │
進入提問模式                  跳過
 │                             │
GPT 動態提問                  │
 │                             │
補充內容                      │
 └──────────────┬──────────────┘
                ↓
          產生最終紀錄
                ↓
          使用者再次確認
                ↓
          產生 Fragment ID
                ↓
          寫入 GitHub JSON
```

Web 手動新增不執行 AI；ChatGPT 與 Web 共用同一份 Fragment Schema 與 GitHub Source of Truth。

---

## 5. GPT 權限與決策原則

GPT 可以：

- 預測 `scope`
- 預測 `type`
- 建議 `status`
- 建議 `priority`
- 建議 `urgency`
- 建議 `domains`
- 建議 `tags`
- 建議 `project`
- 建議 `related`
- 建議 `next_action`
- 摘要原始內容
- 根據內容動態提出補充問題

GPT 不得在未取得使用者確認時：

- 正式建立 Fragment
- 修改既有 Fragment
- 改變分類
- 自動合併資料
- 自動封存資料
- 自動提高或降低優先度
- 自動建立正式 Task
- 自動將 Idea 升級成 Project

基本原則：

> **GPT 預測，使用者決策。**

---

## 6. 核心分類模型

Fragment 不靠路徑分類，而使用 Metadata。

### 6.1 Scope

表示這筆資料所屬的主要生活／工作範圍。

初版採單值欄位：

```json
"scope": "work"
```

或：

```json
"scope": "personal"
```

初版值：

```text
work
personal
```

未來可視需求擴充，但不需改變資料夾結構或 ID。

### 6.2 Type

表示 Fragment 本質上是什麼。

| Type | 中文名稱 | 說明 |
|---|---|---|
| `idea` | 靈感 | 尚未成熟、值得保留的想法 |
| `task` | 待辦 | 已具備明確可執行行動的事項 |
| `learning` | 學習 | 想研究、學習或理解的主題 |
| `requirement` | 需求 | 功能、流程、工具或系統需求 |
| `project` | 專案 | 已形成較完整範圍的持續性工作 |
| `question` | 問題 | 尚待釐清、回答或研究的問題 |
| `decision` | 決策 | 已做出的選擇與相關背景 |
| `tracking` | 追蹤 | 等待外部條件、回覆或後續發展 |
| `resource` | 資源 | 值得保存的工具、網站、文件或素材 |
| `note` | 紀錄 | 無需歸入其他類型的一般內容 |

每筆 Fragment 原則上只設定一個主要 `type`。

### 6.3 Status

初版共用狀態：

```text
incubating
inbox
active
waiting
done
archived
```

Status 描述內容目前所處階段，可依 Type 做不同語意解讀，但底層使用同一組值。

### 6.4 Priority

描述事情本身的重要程度：

```text
high
medium
low
none
```

### 6.5 Urgency

描述時間上的急迫程度：

```text
high
medium
low
none
```

`priority` 與 `urgency` 必須分離，避免「重要」與「很快要處理」被混成單一概念。

### 6.6 Domains

表示相對穩定的主要領域，可複選。

```json
"domains": [
  "AI",
  "RPA",
  "Development"
]
```

Domain 為高階分類，應有受控清單與新增規則。

### 6.7 Tags

提供自由、細粒度描述。

```json
"tags": [
  "ocr",
  "automation",
  "screen-control"
]
```

Tags 主要由 GPT 建議，使用者可修改、刪除或新增。

---

## 7. Fragment JSON Schema 初稿

單筆 Fragment 範例：

```json
{
  "schema_version": "0.1",
  "id": "F-000137",
  "created_at": "2026-10-02T07:00:00+08:00",
  "updated_at": "2026-10-02T07:00:00+08:00",

  "scope": "work",
  "type": "requirement",
  "status": "incubating",
  "priority": "high",
  "urgency": "medium",

  "domains": [
    "RPA",
    "AI"
  ],

  "tags": [
    "ocr",
    "automation",
    "workflow"
  ],

  "project": null,
  "related": [],

  "title": "AET RPA OCR 流程改善",
  "summary": "研究目前 OCR 與畫面判斷流程可縮短時間的方式。",
  "next_action": "先盤點目前流程中耗時最高的 OCR 與畫面判斷步驟。",

  "original_input": "我想研究現在 AET RPA 的 OCR 流程還能不能再縮短時間。",
  "notes": "",

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

### 7.1 欄位分組

#### Identity

```text
schema_version
id
created_at
updated_at
```

#### Classification

```text
scope
type
status
priority
urgency
domains
tags
```

#### Relations

```text
project
related
```

#### Content

```text
title
summary
next_action
original_input
notes
interview
```

#### System

```text
source
ai
```

---

## 8. 原始輸入保留原則

每筆 Fragment 必須保存 `original_input`。

```json
"original_input": "使用者最初輸入的完整內容"
```

原則：

> **AI 可以增加結構、摘要與解讀，但不得覆蓋使用者的原始輸入。**

後續修改 Fragment 時，原始輸入預設保持不變；若需保存新的補充內容，應新增至 `notes`、`interview` 或其他明確欄位，而不是重寫 `original_input`。

---

## 9. 提問紀錄模式

分類結果經使用者確認後，GPT 才詢問：

> 是否需要進入提問紀錄模式？

提問模式不是固定表單，而是根據：

- `type`
- 已知內容
- 缺少的資訊
- 使用者先前回答

動態決定問題。

### Requirement 範例

可能詢問：

- 目前要解決什麼問題？
- 誰會使用？
- 輸入是什麼？
- 預期輸出是什麼？
- 有哪些限制？
- 哪些條件代表完成？

### Learning 範例

可能詢問：

- 想學到什麼程度？
- 主要希望應用在哪裡？
- 目前已經知道多少？
- 是否有期限？

### Idea 範例

可能詢問：

- 這個想法主要想解決什麼問題？
- 最吸引你的核心點是什麼？
- 它可能發展成工具、文章、專案或其他形式嗎？
- 目前最大的未知點是什麼？

### Interview 儲存格式

```json
"interview": [
  {
    "question": "這個工具主要是自己使用，還是未來可能公開？",
    "answer": "第一階段自己使用，成熟後再評估。"
  }
]
```

提問完成後，必須再次顯示最終預覽，經使用者確認後才正式寫入 GitHub。

---

## 10. ID 規則

所有 Fragment 共用單一 ID 空間：

```text
F-000001
F-000002
F-000003
```

原則：

1. ID 為永久識別碼。
2. ID 不包含 `scope`、`type`、日期或專案資訊。
3. ID 不因分類改變而改變。
4. ID 不依賴 GitHub Issue number。
5. Fragment 檔名直接使用 ID。

例如：

```text
data/fragments/F-000137.json
```

後續可直接與 GPT 使用：

```text
幫我看 F-000137。

F-000137 我有新的想法。

把 F-000137 跟 F-000204 關聯起來。
```

ID 產生機制需避免平行寫入造成重複，實作階段另行定義分配與衝突處理策略。

---

## 11. Repository 規劃

第一版只建立一個 Private Repository：

```text
FragmentHub
```

建議結構：

```text
FragmentHub/
├─ app/                    # Next.js App Router
├─ components/             # UI 元件
├─ lib/                    # 核心邏輯
│  ├─ ai/                  # GPT 分析／提問
│  ├─ fragments/           # Fragment CRUD／查詢
│  ├─ github/              # GitHub API
│  └─ search/              # 搜尋與索引邏輯
├─ config/
│  ├─ classification.json  # Type / Status / Domain 等規則
│  └─ prompts/             # GPT Prompt
├─ data/
│  └─ fragments/           # 單一 Fragment 資料池
├─ generated/              # 伺服器端產生資料，不對外公開
│  └─ index.json
├─ scripts/                # Build / Validate / Index scripts
├─ docs/                   # 開發文件
├─ package.json
└─ README.md
```

重要限制：

- 不得建立 `data/personal/`
- 不得建立 `data/work/`
- 不得以資料夾區分 `scope`
- `scope` 只能是 Fragment JSON 的 Metadata 欄位

---

## 12. JSON 與搜尋策略

### 12.1 Source of Truth

單筆 JSON Fragment 是唯一正式資料來源：

```text
data/fragments/*.json
```

### 12.2 搜尋效能不依賴檔案格式

JSON 相較 YAML 的主要優勢在於：

- JavaScript / TypeScript 原生支援
- API 與 GPT Structured Output 容易整合
- Schema 驗證簡單
- 型別較明確
- 前後端資料格式一致

但真正影響搜尋效能的是「是否每次搜尋都讀取全部 Fragment」。

因此系統應建立輕量搜尋索引。

### 12.3 Server-side Index

預計產生：

```text
generated/index.json
```

索引只保存搜尋與列表所需欄位，例如：

```json
[
  {
    "id": "F-000001",
    "title": "研究 Jev",
    "scope": "personal",
    "type": "learning",
    "status": "incubating",
    "priority": "medium",
    "urgency": "low",
    "domains": ["AI-RPG"],
    "tags": ["jev", "memory"],
    "updated_at": "2026-10-02T07:00:00+08:00"
  }
]
```

### 12.4 Index 產生方式

v0.1 不使用 GitHub Actions。

第一版由一般 build script 處理：

```text
npm run build
      ↓
讀取 data/fragments/*.json
      ↓
Schema Validate
      ↓
產生 generated/index.json
      ↓
Next.js Build
```

GitHub 有新 commit 後，Vercel 重新部署並重新建立索引。

未來資料量或同步需求增加時，再考慮 GitHub Actions 或獨立索引服務。

---

## 13. 隱私與安全原則

Repository 設為 Private 不代表部署網站本身天然為私人網站，因此必須另外處理 Web 存取權限。

### 13.1 Fragment 資料不得公開部署

以下內容不得放入 `public/`：

```text
data/fragments/
generated/index.json
```

Fragment 與 index 僅能由 Server-side 程式讀取。

### 13.2 Web App 必須有身分驗證

正式網站需限制只有授權使用者可以：

- 查看 Fragment
- 搜尋
- 新增
- 編輯
- 寫入 GitHub

正式登入採 GitHub OAuth + PKCE；登入後以 numeric GitHub user ID allowlist 判斷存取權。OAuth user token 不作為 canonical data write token。

### 13.3 Secret 僅存在 Server Side

以下資訊不得出現在瀏覽器端程式碼：

- GitHub Token / GitHub App Secret
- Session Secret
- 其他服務金鑰

---

## 14. 系統架構

```text
                    ChatGPT
                       │
        分析 / 分類 / 討論 / 提問 / 確認
                       │
                       ▼
                    GitHub
             Fragment JSON Source of Truth
                       ▲
                       │
                  GitHub API
                       │
                       ▼
               FragmentHub Web
        瀏覽 / 搜尋 / 篩選 / 編輯 / 管理
```

### 元件責任

#### ChatGPT

- 唯一 AI 分析入口
- 接收碎片
- 分析與預分類
- 與使用者討論修改
- 可選提問紀錄
- 依 ID 延續討論
- 經確認後建立或更新 Fragment

#### FragmentHub Web

- GitHub OAuth Login
- Dashboard
- Fragment List / Detail
- Search / Filter
- 手動新增／編輯草稿
- Archive
- Relation 顯示
- JSON Preview

Web 不呼叫 OpenAI API，也不執行 GPT 分析。

#### Next.js Server

- 驗證登入狀態
- 讀取 Fragment JSON
- 執行 Schema 驗證
- 透過 Phase 5 GitHub Runtime API 寫入
- 控制 Secret

#### GitHub

- Fragment JSON Source of Truth
- Git 版本歷史
- 資料回復與 Diff
- Private Repository 權限控制

#### Vercel

- 部署 Next.js
- 執行 Server-side Web
- 管理部署環境 Secret

---

## 15. 網站功能規劃

### 15.1 看板首頁

顯示：

- 待處理 / 進行中 / 卡住 三欄看板（可切換 全部 / 工作 / 個人）
- 醞釀中清單
- 近 7 天完成件數

### 15.2 Fragment List

顯示 ID、Title、Scope、Type、Status、Priority、Domains、Tags、Updated At。

支援 Search 與 Filter。

### 15.3 Fragment Detail

支援查看：

- 完整內容
- Original input
- Notes
- Interview
- Metadata
- Parent Project
- Related
- Backlinks
- Project children

### 15.4 Manual Create / Edit

Web 不做 AI 分析。

使用者直接填寫分類與內容，系統只做 Schema 檢查與 JSON Preview。

Phase 5 已接上正式 GitHub Save；Web 仍保留 Preview → Final Confirm 邊界。

### 15.5 Search / Filter

至少支援：

- ID / Title / Summary 關鍵字
- Scope
- Type
- Status
- Priority
- Urgency
- Domain
- Tag

第一版不導入向量搜尋。

---

## 16. 被動式 GPT 原則

Fragment Hub 的 GPT 定位為「被動式思考助理」。

預設不主動：

- 提醒長期未處理 Fragment
- 封存 Fragment
- 合併 Fragment
- 重新分類 Fragment
- 建立 Task
- 修改 Priority
- 修改 Urgency
- 推動 Project

使用者必須主動帶著內容或 ID 發起討論，例如：

```text
看看 F-000103 現在適不適合轉成 Project。
```

GPT 可以提出分析與建議，但仍需取得使用者確認後才能修改正式資料。

---

## 17. GitHub Actions 決策

### v0.1 不導入 GitHub Actions

目前核心需求都是互動式操作：

- GPT 分析
- 人工確認
- 網站新增／修改
- GitHub 儲存
- Vercel 部署

因此第一版不需要 GitHub Actions。

### v0.1 可由一般程式完成

- JSON Schema 驗證
- Index 產生
- 搜尋資料整理
- Build 前資料檢查

這些可放在：

```text
scripts/
```

並由 Next.js / Vercel Build 執行。

### 未來才考慮 Actions 的情境

- 大量 Fragment 批次驗證
- 定期資料品質檢查
- Schema Migration
- 批次重新建立索引
- 批次 AI 分析
- 關聯圖生成
- Repository 維護工作

原則：

> **只有當出現明確的非同步批次維護需求時，才加入 GitHub Actions。**

---

## 18. v0.1 開發範圍

### 必須完成

- 單一 Private Repository
- Fragment JSON Schema
- 統一 `F-xxxxxx` ID
- `scope` Metadata 分類
- Type / Status / Priority / Urgency / Domain / Tag 規則
- GPT 預分類流程
- 使用者確認流程
- 動態提問模式
- 最終預覽與確認
- GitHub JSON 建立
- GitHub JSON 更新
- Web Login / Access Control
- Web Manual Capture
- Fragment List
- Fragment Detail
- 基本搜尋
- 基本篩選
- 基本編輯
- Server-side Index
- Build-time Schema Validation

### 暫不納入

- GitHub Actions
- 多 Repository 架構
- Markdown 作為核心資料格式
- Personal / Work 路徑分離
- 向量資料庫
- 向量搜尋
- 自動提醒
- 主動整理舊資料
- 自動合併 Fragment
- AI 批次重新分類
- 複雜 Relation Graph
- 多人協作
- 公開分享

---

## 19. 開發階段

### Phase 1：資料規格 ✅ 已完成

先確定資料模型，不先做完整 UI。

已完成：

- JSON Schema
- Scope 規則
- Type 規則
- Status 規則
- Domain 規則
- Tag 規則
- Priority / Urgency 規則
- ID 規則
- Relation 規則
- Interview 格式
- Canonical Data Invariants
- JSON Schema / Zod Runtime Schema 對齊

正式資料規格見 `docs/DATA_SPEC.md`。

### Phase 2：Repository 與資料層 ✅ 已完成

已完成：

- 建立資料層模組結構
- Fragment JSON CRUD
- JSON Schema 驗證
- Zod Runtime 驗證
- 跨 Fragment 語意驗證
- ID 產生器與平行寫入重試
- Build-time Index Generator
- Related backlink 計算
- GitHub Contents API 讀寫
- SHA / updated_at 樂觀鎖定
- CLI 全資料驗證
- Data Layer 純邏輯測試

正式資料層說明見 `docs/DATA_LAYER.md`。

### Phase 3：ChatGPT 操作契約 ✅ 已完成

已完成：

- Classification Prompt
- Structured Output Schema
- Controlled Domain 輸出
- Metadata 建議
- Project / Related 建議與有效性檢查
- 分析結果回報
- Human Confirm 狀態
- 重新編輯後取消 Confirm
- Dynamic Interview Prompt
- Interview 上限與停止條件
- Final Record 文字整理
- Confirmed Metadata 鎖定
- Final Record Draft 產生
- Refusal / Incomplete Response 處理
- AI Layer 純邏輯測試

正式操作契約見 `docs/CHATGPT_WORKFLOW.md`。

### Phase 4：Web MVP ✅ 已完成

已完成：

- 單一私人使用者 Authentication
- Dashboard
- Fragment List
- Fragment Detail
- Search / Filter
- 手動新增草稿
- 手動編輯草稿
- Archive 草稿操作
- Project / Related / Backlink 顯示
- JSON Draft Preview
- Responsive UI
- Web Runtime 移除 AI API

Phase 5 已完成 GitHub Runtime Save、即時讀取與衝突處理。

正式 Web MVP 說明見 `docs/WEB_MVP.md`.

### Phase 5：GitHub / Vercel 整合

Runtime Integration 已完成：

- GitHub OAuth Authentication v2（PKCE + state + numeric ID allowlist）

- Server-side GitHub Create / Update
- 寫入後即時 GitHub 讀取
- ID 配發與 Content SHA 寫入
- expected_updated_at / SHA 樂觀鎖定
- 409 衝突處理
- Server-side immutable field protection
- Authentication-protected save API
- Logout
- Vercel data-only commit ignoreCommand
- Production Secret 規格
- 部署文件

Production Activation 尚待外部設定：

- 在 Vercel 建立 FragmentHub Project
- 連接 EstherAIRP/FragmentHub
- 建立 GitHub OAuth App
- 設定 FRAGMENTHUB_GITHUB_CLIENT_ID
- 設定 FRAGMENTHUB_GITHUB_CLIENT_SECRET
- 設定 FRAGMENTHUB_PUBLIC_URL
- 設定 FRAGMENTHUB_SESSION_SECRET
- 設定 FRAGMENTHUB_ALLOWED_GITHUB_IDS
- 設定 FRAGMENTHUB_GITHUB_TOKEN
- 執行首次 production build 與 runtime 驗收

Authentication 規格見 `docs/AUTHENTICATION.md`。

部署說明見 `docs/DEPLOYMENT.md`。

---

## 20. v0.1 完成條件

v0.1 可視為完成，至少需要達成：

1. 使用者可從 ChatGPT 或 Web 提交一段未整理內容。
2. GPT 能依分類規則提出結構化預分析。
3. 使用者可修改並確認分析結果。
4. 系統會詢問是否進入提問紀錄模式。
5. 提問模式可依 Type 動態補充資訊。
6. 最終寫入前會再次顯示完整預覽。
7. 使用者確認後才產生正式 Fragment ID。
8. Fragment 能以合法 JSON 寫入 `data/fragments/`。
9. Fragment 可被列表、搜尋與篩選。
10. 既有 Fragment 可經人工確認後更新。
11. 私人 Fragment 資料不直接暴露於公開前端資源。
12. 不依賴 GitHub Actions 即可完成 v0.1 核心流程。
