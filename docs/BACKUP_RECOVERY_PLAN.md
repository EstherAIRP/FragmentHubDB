# FragmentHubDB — 免費 Atlas 備份與還原方案（規劃草案）

> 僅為設計，尚未排程、執行備份、建立憑證或修改 Atlas。目標資料庫為 `fragmenthubdb_test`。
> 不得將備份或連線憑證儲存在公開 GitHub。沒有授權不得匯入或覆寫現有資料。

## 目標與前提

- Atlas Free 沒有付費叢集的自動快照備份功能；採用 Windows 本機、允許 IP 的定期**邏輯匯出**。成本可維持零額外月費，但必須自備運作中的電腦、加密儲存與失敗告警。
- 建議每日備份一次、保留最近 7 份每日備份與 4 份每週備份。若本機關機或 IP 改變，須在回線後補做且通知失敗。
- 建議 RPO ≤ 24 小時、RTO ≤ 4 小時作為**待驗收的目標**，非已達成保證；資料頻繁變更時需縮短間隔。
- 備份整個資料庫：`fragments`（保留 `original_input`）、`metadata`（含 `highest_allocated`）、`chatgpt_proposals` 與索引、必要的 schema/版本。不得只匯出 fragments 而遺失 ID 高水位。

## 備份程序（未執行）

1. Atlas 建立**獨立唯讀備份帳號**，只限測試資料庫與 Cluster；不要重複使用 Web 的讀寫密鑰或 `atlasAdmin`。
2. 在已加入 Atlas IP 白名單的 Windows 本機，用 MongoDB Database Tools 的 `mongodump --archive --gzip` 執行整庫匯出。避免把密碼直接放在 CLI 引數、shell 紀錄或任務排程引數中；先確認認證資料庫與工具版本。
3. 匯出後立即用 `age` 等可靠工具公鑰加密。未加密的暫存檔應放受限目錄，驗證後清理。備份密鑰與密文不得存於同一個對外分享位置。
4. 紀錄每次備份時間、工具版本、SHA-256、匯出與加密狀態、檔案大小，以及不包含秘密或 Fragment 原文的失敗碼。
5. 本機及**不同設備**各保存一份加密備份；新備份確認成功後才套用保留規則。
6. 用 Windows 工作排程器每日執行，監測排程未執行、連線失敗、磁碟已滿與備份異常過小，並通知使用者。

## 每月還原演練（未執行）

1. 使用隔離測試資料庫與新憑證，在**不同的還原環境**執行 `mongorestore`，禁止直接覆蓋現有 `fragmenthubdb_test` 或 `--drop` 任何線上資料庫。
2. 驗證集合數量、資料筆數、Fragment Schema/語意檢查、`original_input`、所有參照、`metadata.highest_allocated` 與索引（尤其 TTL）。
3. 對照匯出記錄的雜湊與時間；必要時人工抽查資料一致性，記錄實際 RPO/RTO。
4. 本機解密明文結束後清理；**不得自動把測試還原結果切換成 Vercel 正式來源**。

## 待確認事項

加密密鑰管理、備份存放地點、通知方式、保留期限及首次還原演練都需要使用者逐項核准。若 Atlas 網路封鎖，不能為了備份方便長期開放未經核准的 IP 清單。

本設計不修改 `FragmentHubDB_DATA_STORE`、IP 白名單、正式資料、CI 或 Vercel Production。
