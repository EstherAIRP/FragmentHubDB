/**
 * Publicly shareable Atlas doctor diagnostics. Never echo driver messages:
 * MongoDB errors may contain hostnames, credentials, or connection options.
 */
export type MongoDoctorDiagnosis = {
  code: string;
  guidance: string;
  /** Safe structural Node.js error code; never a driver message or a hostname. */
  technicalCode?: string;
};

type ErrorPart = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  codeName?: unknown;
  syscall?: unknown;
  cause?: unknown;
  reason?: unknown;
  error?: unknown;
  servers?: unknown;
};

/** MongoServerSelectionError stores per-server transport failures under
 * reason.servers, not necessarily under cause. Never log those raw objects. */
function collectErrorParts(error: unknown): ErrorPart[] {
  const parts: ErrorPart[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length && parts.length < 40) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const part = current as ErrorPart;
    parts.push(part);
    queue.push(part.cause, part.reason, part.error);
    if (part.servers instanceof Map) {
      for (const server of Array.from(part.servers.values()).slice(0, 12)) {
        queue.push(server);
      }
    }
  }
  return parts;
}

export function diagnoseMongoDoctorError(error: unknown): MongoDoctorDiagnosis {
  const parts = collectErrorParts(error);
  const hasCode = (...values: (string | number)[]) =>
    parts.some((part) => values.includes(part.code as string | number) ||
      values.includes(part.codeName as string | number));
  const hasName = (pattern: RegExp) =>
    parts.some((part) => typeof part.name === "string" && pattern.test(part.name));
  // Messages are used *only* to choose a safe diagnosis, never returned.
  const hasText = (pattern: RegExp) =>
    parts.some((part) => typeof part.message === "string" && pattern.test(part.message));

  if (hasText(/Refusing MongoDB write test/)) {
    return {
      code: "WRITE_TEST_GUARD",
      guidance: "寫入測試僅允許明確指定 FragmentHubDB_DATA_STORE=mongodb 及 FragmentHubDB_MONGODB_DATABASE=fragmenthubdb_test。",
    };
  }
  if (hasText(/MongoDB doctor invalid flags|MongoDB doctor invalid DNS IP/)) {
    return {
      code: "DOCTOR_ARGS",
      guidance: "只允許 --strict 或 --write-test，另可加 --dns=8.8.8.8；不得同時使用 --strict 與 --write-test。",
    };
  }
  if (hasText(/Write probe cleanup failed/)) {
    return {
      code: "WRITE_TEST_CLEANUP",
      guidance: "測試暫存集合清理失敗。請檢查 fragmenthubdb_test 中 prefix 為 fragmenthubdb_write_probe_ 的集合，不要批次刪除其他資料。",
    };
  }
  if (hasText(/Write probe:/)) {
    return {
      code: "WRITE_TEST_FAILED",
      guidance: "診斷集合的交易提交、回滾或讀回驗證未成功；正式 Fragment 資料不應受到影響。",
    };
  }
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
      parts.some((part) =>
        typeof part.syscall === "string" && /^(querySrv|queryTxt)$/.test(part.syscall)
      ) ||
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
  const safeTechnicalCode = parts
    .map((part) => part.code)
    .find((value) =>
      typeof value === "string" &&
      /^(?:E[A-Z0-9_]{2,60}|CERT_[A-Z0-9_]{2,60}|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/.test(value)
    ) as string | undefined;
  if (
    hasCode("ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") ||
    hasText(/certificate (?:verify failed|has expired|verification failed)|self.signed certificate|unable to verify the first certificate|hostname.*does not match.*certificate/i)
  ) {
    return {
      code: "TLS_CERTIFICATE",
      guidance: "TLS 憑證驗證失敗。請檢查電腦時間、HTTPS／TLS 攔截代理與憑證信任鏈；不可關閉 TLS 憑證驗證。",
      technicalCode: safeTechnicalCode,
    };
  }
  if (
    (safeTechnicalCode?.startsWith("ERR_SSL_") ||
      safeTechnicalCode?.startsWith("ERR_TLS_")) ||
    hasText(/SSL routines|tlsv1 alert|TLS handshake failure|SSL handshake failed|ssl3_read_bytes/i)
  ) {
    return {
      code: "TLS_CONNECT",
      guidance: "連線發生明確 TLS 握手／通訊錯誤。請先重試唯讀診斷，再檢查 Atlas IP 白名單、VPN、防火牆、系統時間與 TLS 攔截代理。",
      technicalCode: safeTechnicalCode,
    };
  }
  if (hasCode("ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET") ||
      hasName(/MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError/) ||
      hasText(/Server selection timed out|connect ETIMEDOUT|disconnected before secure TLS connection/i)) {
    return {
      code: "NETWORK_ACCESS",
      guidance: "無法穩定連上 Atlas。請確認 Cluster 已啟動、IP 白名單允許目前對外 IP，並檢查防火牆、VPN 與 27017 TCP 連線。",
      technicalCode: safeTechnicalCode,
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
