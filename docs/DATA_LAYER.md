# FragmentHub Data Layer

> Phase：2 — Repository 與資料層  
> 狀態：實作基準

## 1. 目標

Phase 2 將 Phase 1 的資料規格落成可執行的資料層，包含：

- Canonical Fragment CRUD
- ID 配發
- JSON Schema 驗證
- Zod Runtime 驗證
- 跨 Fragment 語意驗證
- Server-side Index
- GitHub Contents API 讀寫
- 更新衝突偵測

所有寫入仍必須由上層流程確認後才可呼叫；Data Layer 本身不負責替使用者決定是否應寫入。

## 2. 模組

```text
lib/
├─ fragment-schema.ts
├─ fragments/
│  ├─ id.ts
│  ├─ index.ts
│  ├─ json-schema-validator.ts
│  ├─ local-store.ts
│  └─ semantic-validator.ts
└─ github/
   ├─ client.ts
   └─ fragment-store.ts
```

### `id.ts`

負責：

- `F-000001` 格式化
- ID 解析
- 由既有 ID 集合計算下一個候選 ID

ID 採 monotonic candidate 策略：以目前最大合法 ID + 1 作為下一個候選值。

實際寫入時仍以「建立檔案是否成功」作為唯一配發成功依據，以處理平行寫入競爭。

### `json-schema-validator.ts`

使用 `config/fragment.schema.json` 做 JSON Schema 驗證。

用途是確保正式 JSON 規格本身真的被執行，而不只依賴 TypeScript / Zod。

### `semantic-validator.ts`

負責 Schema 無法完整描述的跨檔案規則，例如：

- Domain 是否存在於受控清單
- Project 是否存在
- Project target 是否真的為 `type=project`
- Related target 是否存在
- 更新時 ID 是否被改變
- 更新時 `created_at` 是否被改變

### `index.ts`

將完整 Fragment 轉換成搜尋索引。

Index 額外計算 `backlinks`，因此 JSON 不需要為 related relation 強制做雙向寫入。

### `local-store.ts`

開發環境與 Build 使用的本機檔案層：

- list
- get
- create
- replace
- delete

Create 使用 exclusive write，若 ID 在平行過程中已被建立會重新配發。

Replace 可使用 `expectedUpdatedAt` 做樂觀鎖定。

Delete 若存在 inbound project / related reference 會拒絕刪除。

### `github/client.ts`

封裝 GitHub REST API：

- Server-side Token
- API headers
- UTF-8 / Base64 編解碼
- 統一錯誤型別

### `github/fragment-store.ts`

GitHub Remote Store：

- list
- get
- create
- replace
- delete

Create 若遇到 GitHub 409 / 422，會重新讀取資料並重新配發 ID。

Replace / Delete 使用 GitHub Content SHA 作為 optimistic concurrency control；SHA 不一致時拒絕覆蓋。

## 3. 驗證層級

正式資料經過三層檢查：

```text
JSON Parse
   ↓
JSON Schema
   ↓
Zod Runtime Schema
   ↓
Semantic Validation
```

其中 Semantic Validation 才能檢查跨 Fragment reference。

## 4. CLI

### 驗證全部資料

```bash
npm run validate:data
```

檢查：

- JSON 格式
- 檔名格式
- 檔名與 ID 一致
- 重複 ID
- JSON Schema
- Zod Schema
- Domain
- Project reference
- Related reference
- Canonical invariants

### 建立搜尋索引

```bash
npm run build:index
```

會先執行資料驗證，再建立：

```text
generated/index.json
```

### Build

```bash
npm run build
```

透過 `prebuild` 自動執行：

```text
validate:data
↓
build:index
↓
next build
```

因此不需要 GitHub Actions 才能保證部署前資料有效。

## 5. GitHub 設定

Remote Store 使用以下 Server-side 環境變數：

```text
FRAGMENTHUB_GITHUB_TOKEN
FRAGMENTHUB_GITHUB_REPOSITORY
FRAGMENTHUB_GITHUB_BRANCH
```

預設 Repository：

```text
EstherAIRP/FragmentHub
```

預設 Branch：

```text
main
```

Token 需要 Repository Contents 讀寫權限，且不得暴露至 Client Component。

## 6. 刪除策略

Data Layer 有 delete primitive，以符合完整 CRUD 與維護需求，但產品層預設不提供自動刪除。

優先操作仍是：

```text
status = archived
```

真正 delete 必須由上層取得明確使用者意圖，且不存在任何 inbound reference。

## 7. Phase 2 與 Phase 5 的界線

Phase 2 實作「可使用的 GitHub API Data Adapter」。

Phase 5 才處理部署層整合：

- Vercel Secret 實際設定
- GitHub App / Token 最終選型
- 寫入後部署同步
- Authentication
- Production error handling
- Deployment / rollback 行為

因此 Phase 2 的 GitHub Store 是資料能力，不代表目前網站已允許正式寫入。
