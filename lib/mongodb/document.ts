import { fragmentSchema, type Fragment } from "@/lib/fragment-schema";
import { validateFragmentJsonSchema } from "@/lib/fragments/json-schema-validator";
import {
  FragmentDataValidationError,
} from "@/lib/fragments/semantic-validator";

export type MongoFragmentDocument = Fragment & { _id: string };

/**
 * Never parse a stored Atlas document with Zod alone: Zod object schemas
 * strip extra properties. First enforce the canonical JSON Schema, including
 * additionalProperties: false, and verify _id matches the stable Fragment ID.
 */
export function parseMongoDocument(document: MongoFragmentDocument): Fragment {
  const { _id, ...data } = document;
  if (typeof _id !== "string" || data.id !== _id) {
    throw new FragmentDataValidationError([{
      code: "mongo_id_mismatch",
      path: "_id",
      message: "Atlas document ID must match its Fragment ID.",
    }]);
  }

  const issues = validateFragmentJsonSchema(data);
  if (issues.length > 0) {
    throw new FragmentDataValidationError(
      issues.map((issue) => ({
        code: "json_schema_" + issue.keyword,
        path: issue.path,
        message: issue.message,
      })),
    );
  }

  return fragmentSchema.parse(data);
}
