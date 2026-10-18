import { diagnoseMongoDoctorError } from "@/lib/mongodb/doctor-diagnostics";

/** Never send raw driver errors, nested server descriptions or URIs to logs. */
export type StorageOperation =
  | "fragment_list" | "fragment_detail" | "fragment_create"
  | "fragment_update" | "fragment_batch" | "proposal_review";

export function logSafeStorageError(operation: StorageOperation, error: unknown): void {
  const diagnosis = diagnoseMongoDoctorError(error);
  console.error("FragmentHubDB storage failure", {
    operation,
    code: diagnosis.code,
    ...(diagnosis.technicalCode ? { technicalCode: diagnosis.technicalCode } : {}),
  });
}
