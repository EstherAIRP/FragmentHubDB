# FragmentHubDB Atlas Free 加密備份工具 — 使用與驗收（尚未啟用）

> 僅在 `feature/mongodb-atlas-store` 實作。沒有自動排程、沒有真的連線備份、沒有還原正式資料。本工具只支援 `fragmenthubdb_test`。

## 安全設計

- **一致性**：Node.js MongoDB Driver 使用唯讀 transaction，`readConcern: snapshot` 與多數提交，依序讀取 `fragments`、`metadata`、`chatgpt_proposals`。不需要停寫或 `mongodump --oplog`。資料庫有其他未列入支援的集合時拒絕備份，避免漏備份而宣稱成功。
- **加密**：一致快照直接於 Node 記憶體編碼為 EJSON，透過 stdin 交由 `age` 公鑰加密，僅落地 `.age` 密文與不含原文的 `.age.json` SHA-256 manifest，從不產生未加密備份檔。
- **安全界限**：記憶體明文最多 32 MiB；資料庫與連線環境僅允許測試專案及獨立備份唯讀帳號。超過上限、未知集合、交易失敗、加密失敗或無法驗證時皆不得回報成功。
- **索引**：備份包含應用層三個集合的資料與 EJSON BSON Date，**不包含任意集合索引的實體快照**。未來實際還原時必須依程式重建並驗證 `chatgpt_proposals.expires_at` TTL 索引與必要的其他索引。
- **災難還原**：`verify:backup` 僅本機解密並驗證，**尚未提供會寫入 Atlas 的還原指令**。資料庫還原需另開任務、明確授權、使用隔離的空白測試資料庫並完成還原演練。
- 此備份腳本使用與 Web **不同** 的 `FragmentHubDB_BACKUP_MONGODB_URI`，不讀取 Web 連線字串做備份；須先建立唯讀帳號，並使用可正常存取 Atlas 的本機 IP。
- 免費 Atlas 快照交易可能受資料量、交易時間及 snapshot history window 限制，不適合直接無限擴充；備份失敗需處理，不能把失敗檔當成成功備份。

## 本機安裝與前置設定（待使用者確認後操作）

1. 下載並自行驗證官方 `age` 與 `age-keygen` Windows 版本，確保 `age` 在 PATH；在離線安全位置用 `age-keygen` 產生身分私鑰，公鑰收件人為 `age1...`。**私鑰不提交 GitHub、不貼入對話、不放 Vercel。**
2. 在 Atlas 測試專案新增只限 `fragmenthubdb_test`、`Cluster0` 的 `read` 備份專用帳號。不要改動或借用現有 Web 專用的 `readWrite` 帳號。
3. 選擇不位於本專案公開目錄、也非自動同步公開雲端的絕對備份路徑，事先建立並限制 NTFS 權限。在本機 `.env.local` 內新增以下**鍵名**（值請自行填寫，勿上傳）：

```dotenv
FragmentHubDB_BACKUP_MONGODB_DATABASE=fragmenthubdb_test
FragmentHubDB_BACKUP_MONGODB_URI=<獨立唯讀帳號的完整 MongoDB URI>
FragmentHubDB_BACKUP_AGE_RECIPIENT=<age1 開頭的公鑰收件人>
FragmentHubDB_BACKUP_DIRECTORY=<本機絕對路徑>
```

4. 檢查 IP 白名單只允許本機必要來源，不得因備份啟用 `0.0.0.0/0`。
5. 明確人工確認後，才從本機執行 `npm run backup:mongodb -- --create`；此動作會讀取 Atlas，但不寫入資料庫。成功才會在指定目錄生成加密檔與 SHA-256 manifest。失敗返回非零，輸出不含原文／秘密。
6. 使用私鑰在**本機**做唯讀還原前驗證：

```powershell
npm run verify:backup -- --file=C:\backup\fragmenthubdb-example.age --identity=C:\private\age-identity.txt
```

檢查輸出 `BACKUP_VERIFIED`，確認所有集合記錄、Schema、關聯、Metadata 高水位及原始輸入均無破壞；這不等於已經完成資料庫還原演練。

## Windows 工作排程器（模板；尚未註冊）

在有 Node.js、`npm`、`age`、本機 `.env.local` 的 Windows 主機上，可先測試：

```powershell
powershell -NoProfile -File .\scripts\backup-mongodb-windows.ps1 -StatusDirectory "C:\backup-status"
```

預設只做檢查；通過人工授權後可加上 `-Run`。工作排程器可將此 PowerShell 指令設為每日執行，搭配「不論是否登入」、「失敗時重新啟動」與「未執行時盡快執行」選項。需確保私鑰不放入排程命令。腳本只記錄 UTC 時間及 `success/failed` 到 `backup-status.json`，任務失敗回傳非零，**尚未建立推播或郵件通知**，必須指定通知方式並另外實作。

**尚未實作／通過的驗收**：真實 Atlas 快照讀取、加密檔解密驗證、Windows 排程失敗提醒、異機第二份備份、隔離 DB 實際還原、定期保留輪替。這些項目在完成前不可視為受備份保護。
