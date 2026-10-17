/**
 * Phase 0: advisory contract for the proposed ChatGPT -> MongoDB tool path.
 * NOT a security boundary for third-party MongoDB tools or database users.
 * No database imports, connections, or write operations live in this module.
 */
export const DIRECT_WRITE_RELEASE_ENABLED = false;

export const GPT_EDITABLE_FIELDS = [
  "title", "summary", "next_action", "notes", "tags",
  "priority", "urgency", "status",
] as const;

export type GptEditableField = (typeof GPT_EDITABLE_FIELDS)[number];
export type DirectWriteAction =
  | "read" | "create" | "update"
  | "delete" | "relation" | "batch" | "atlas-admin";

export type DirectWriteRequest = {
  action: DirectWriteAction;
  userConfirmed: boolean;
  capabilitiesVerified: boolean;
  fields?: readonly string[];
  project?: string | null;
  related?: readonly string[];
};

export type DirectWriteDecision = {
  allowed: boolean;
  reason: string;
};

/**
 * The default release gate remains CLOSED throughout Phase 0.
 * A future implementation must additionally enforce permissions at the
 * MongoDB account/tool boundary; this advisory function cannot do that.
 */
export function assessDirectWriteRequest(
  request: DirectWriteRequest,
  enabled: boolean = DIRECT_WRITE_RELEASE_ENABLED,
): DirectWriteDecision {
  if (request.action === "read") {
    return { allowed: true, reason: "READ_ONLY" };
  }
  if (!enabled) return { allowed: false, reason: "DIRECT_WRITE_DISABLED" };
  if (!request.capabilitiesVerified) {
    return { allowed: false, reason: "CAPABILITIES_NOT_VERIFIED" };
  }
  if (!request.userConfirmed) {
    return { allowed: false, reason: "HUMAN_CONFIRMATION_REQUIRED" };
  }
  if (!["create", "update"].includes(request.action)) {
    return { allowed: false, reason: "ACTION_NOT_ALLOWED" };
  }
  if (request.action === "create" &&
    (request.project != null || (request.related?.length ?? 0) > 0)) {
    return { allowed: false, reason: "RELATIONS_NOT_SUPPORTED" };
  }
  if (request.action === "update" &&
    (!request.fields?.length ||
      request.fields.some((field) => !GPT_EDITABLE_FIELDS.includes(field as GptEditableField)))) {
    return { allowed: false, reason: "FIELD_NOT_ALLOWED" };
  }
  return { allowed: true, reason: "ADVISORY_ELIGIBLE_ONLY" };
}
