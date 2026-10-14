import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import fragmentJsonSchema from "@/config/fragment.schema.json";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

addFormats(ajv);

const validate = ajv.compile(fragmentJsonSchema);

export type JsonSchemaIssue = {
  path: string;
  keyword: string;
  message: string;
};

export function validateFragmentJsonSchema(value: unknown): JsonSchemaIssue[] {
  if (validate(value)) {
    return [];
  }

  return (validate.errors ?? []).map((error: ErrorObject) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "JSON Schema validation failed.",
  }));
}
