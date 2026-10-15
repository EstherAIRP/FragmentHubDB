/**
 * Publicly shareable Atlas doctor diagnostics. Never echo driver messages:
 * MongoDB errors may contain hostnames, credentials, or connection options.
 */
export type MongoDoctorDiagnosis = {
  code: string;
  guidance: string;
};

type ErrorPart = { name?: unknown; message?: unknown; code?: unknown; codeName?: unknown; cause?: unknown };

export function diagnoseMongoDoctorError(error: unknown): MongoDoctorDiagnosis {
  const parts: ErrorPart[] = [];
  const seen = new Set<unknown>();
  let cursor: unknown = error;
  for (let i = 0; i < 6 && cursor !== null && typeof cursor === "object" && !seen.has(cursor); i++) {
    seen.add(cursor);
    parts.push(cursor as ErrorPart);
    cursor = (cursor as ErrorPart).cause;
  }
  const hasCode = (...values: (string | number)[]) =>
    parts.some((part) => values.includes(part.code as string | number) ||
      values.includes(part.codeName as string | number));
  const hasName = (pattern: RegExp) =>
    parts.some((part) => typeof part.name === "string" && pattern.test(part.name));
  // Messages are used *only* to choose a safe diagnosis, never returned.
  const hasText = (pattern: RegExp) =>
    parts.some((part) => typeof part.message === "string" && pattern.test(part.message));

  if (hasText(/FragmentHubDB_MONGODB_URI is missing/)) {
    return {
      code: "URI_MISSING",
      guidance: "請在專案根目錄的 .env.local 設定 FragmentHubDB_MONGODB_URI，確認執行目錄正確。",
    };
  }
  if (hasText(/Refusing MongoDB access: database name/)) {
    return {
      code: "DB_NAME_INVALID",
      guidance: "FragmentHubDB_MONGODB_DATABASE 必須使用 fragmenthubdb 或 fragmenthubdb_test 等專案專用名稱。",
    };
  }
  if (hasText(/Refusing MongoDB import: git origin|cannot verify git origin|Command failed: git remote get-url origin/)) {
    return {
      code: "GIT_ORIGIN",
      guidance: "請確認在 EstherAIRP/FragmentHubDB 專案根目錄執行，且 git remote origin 指向此儲存庫。",
    };
  }
  if (hasCode(18, "AuthenticationFailed") || hasText(/Authentication failed|bad auth|unable to authenticate/i)) {
    return {
      code: "AUTH_FAILED",
      guidance: "請檢查 Atlas Database Access 中的資料庫使用者密碼，並將 URI 密碼內的特殊字元進行 URL 編碼；這不是 Atlas 網站登入密碼。",
    };
  }
  if (hasCode(13, "Unauthorized") || hasText(/not authorized on|requires authentication/i)) {
    return {
      code: "DB_PERMISSION",
      guidance: "請檢查 Atlas Database Access：資料庫使用者須有 fragmenthubdb_test 的 readWrite 權限（至少需能讀取），並確認連線使用正確帳號。",
    };
  }
  if (hasCode("ENOTFOUND", "ENODATA", "ESERVFAIL", "ENODOMAIN", "ENONAME") ||
      hasText(/querySrv|queryTxt|DNS.*(not found|failed)|getaddrinfo ENOTFOUND/i)) {
    return {
      code: "DNS_LOOKUP",
      guidance: "無法解析 Atlas 主機或 SRV DNS 記錄。請確認連線字串的叢集主機完整，並檢查目前網路、DNS 或 VPN 設定。",
    };
  }
  if (hasName(/MongoParseError|MongoInvalidArgumentError|MongoAPIError/) ||
      hasText(/Invalid scheme|Invalid connection string|URI malformed|Password contains unescaped characters/i)) {
    return {
      code: "URI_FORMAT",
      guidance: "連線字串格式無效。請從 Atlas Connect → Drivers 複製原始 mongodb+srv:// 字串，替換密碼並正確 URL 編碼，不要包含引號或佔位文字。",
    };
  }
  if (hasText(/TLS|SSL|certificate|handshake/i)) {
    return {
      code: "TLS_CONNECT",
      guidance: "TLS 安全連線失敗。請檢查系統時間、公司網路代理、防毒 HTTPS 檢查，以及 Node.js 版本。",
    };
  }
  if (hasCode("ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET") ||
      hasName(/MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError/) ||
      hasText(/Server selection timed out|connect ETIMEDOUT/i)) {
    return {
      code: "NETWORK_ACCESS",
      guidance: "無法連上 Atlas。請確認 Cluster 已啟動、Network Access 允許目前電腦的對外 IP，並檢查防火牆、VPN 與 27017 連線限制。",
    };
  }
  if (hasText(/transactions are unavailable/)) {
    return {
      code: "TRANSACTION_TOPOLOGY",
      guidance: "目標資料庫拓樸不支援交易；請連接 Atlas Replica Set／支援交易的叢集。",
    };
  }
  if (hasText(/transaction metadata is not ready|invalid Fragment references or metadata/)) {
    return {
      code: "DATA_VALIDATION",
      guidance: "已連線，但既有 Fragment 或交易同步資料驗證失敗。請先停止搬遷與寫入，檢查上方的唯讀驗證結果。",
    };
  }
  return {
    code: "ATLAS_CHECK_FAILED",
    guidance: "無法辨識具體原因。請先確認 .env.local、Atlas IP 白名單、資料庫使用者及 Cluster 狀態；不要公開完整連線字串。",
  };
}
