import type { Document } from "mongodb";

import canonicalSchema from "@/config/fragment.schema.json";
import domainConfig from "@/config/domains.json";

/**
 * Atlas schema validation is a structural safeguard, not the application
 * semantic validator. MongoDB implements a subset of JSON Schema draft 4,
 * not the project's JSON Schema 2020-12 or date-time format assertions.
 * Never silently skip new, unsupported schema keywords.
 */
const TRANSLATED = new Set([
  "type", "const", "enum", "pattern", "minLength", "maxLength",
  "minItems", "maxItems", "uniqueItems", "items", "anyOf",
  "properties", "required", "additionalProperties",
]);
const IGNORED = new Set(["$schema", "$id", "title", "description", "format"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convertSchema(value: unknown, path: string): Document {
  if (!isObject(value)) throw new Error("Unsupported canonical schema: " + path);
  const output: Document = {};
  for (const [key, rule] of Object.entries(value)) {
    if (IGNORED.has(key)) {
      if (key === "format" && rule !== "date-time") {
        throw new Error("Unsupported canonical format: " + path);
      }
      continue;
    }
    if (!TRANSLATED.has(key)) {
      throw new Error("Unsupported canonical schema keyword: " + path + "." + key);
    }
    switch (key) {
      case "type": {
        if (typeof rule !== "string") throw new Error("Unexpected type: " + path);
        if (rule === "integer") output.bsonType = ["int", "long"];
        else if (["object", "array", "string", "null", "bool", "boolean", "number"].includes(rule)) {
          output.bsonType = rule === "boolean" ? "bool" : rule;
        } else throw new Error("Unsupported canonical type: " + path);
        break;
      }
      case "const": output.enum = [rule]; break;
      case "enum":
      case "required": {
        if (!Array.isArray(rule)) throw new Error("Expected array: " + path + "." + key);
        output[key] = rule;
        break;
      }
      case "properties": {
        if (!isObject(rule)) throw new Error("Expected properties: " + path);
        output.properties = Object.fromEntries(
          Object.entries(rule).map(([name, schema]) =>
            [name, convertSchema(schema, path + "." + name)]),
        );
        break;
      }
      case "items": output.items = convertSchema(rule, path + ".items"); break;
      case "anyOf": {
        if (!Array.isArray(rule) || rule.length === 0) {
          throw new Error("Expected anyOf array: " + path);
        }
        output.anyOf = rule.map((entry, i) => convertSchema(entry, path + ".anyOf." + i));
        break;
      }
      default: output[key] = rule;
    }
  }
  return output;
}

export const VALIDATION_MODE = "Phase1_PREVIEW_ONLY" as const;

export function fragmentCollectionValidator(): Document {
  const schema = convertSchema(canonicalSchema, "fragment");
  schema.required = ["_id", ...(schema.required as string[])];
  schema.properties._id = { bsonType: "string", pattern: "^F-[0-9]{6}$" };
  // The project's domain registry is a controlled list, not free-form slugs.
  schema.properties.domains.items.enum = Object.keys(domainConfig.domains).sort();
  return {
    $and: [
      { $jsonSchema: schema },
      { $expr: { $eq: ["$_id", "$id"] } },
    ],
  };
}

export function metadataCollectionValidator(): Document {
  // highest_allocated is intentionally optional: existing Web transaction
  // upserts the epoch version before setting the high-water mark.
  return {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "version"],
      additionalProperties: false,
      properties: {
        _id: { enum: ["fragments"], bsonType: "string" },
        version: { bsonType: ["int", "long"], minimum: 1 },
        highest_allocated: { bsonType: ["int", "long"], minimum: 0, maximum: 999999 },
      },
    },
  };
}

export function directWriteCollectionOptions(): {
  fragments: { validator: Document; validationLevel: "strict"; validationAction: "error" };
  metadata: { validator: Document; validationLevel: "strict"; validationAction: "error" };
} {
  return {
    fragments: {
      validator: fragmentCollectionValidator(), validationLevel: "strict", validationAction: "error",
    },
    metadata: {
      validator: metadataCollectionValidator(), validationLevel: "strict", validationAction: "error",
    },
  };
}

/** Only disposable CI MongoDB may be mutated by Phase 1 validator tests. */
export function assertDisposableMongoValidatorTarget(
  database: string,
  uri: string,
  ci: string | undefined,
): void {
  if (ci !== "true" || database !== "fragmenthubdb_ci" ||
      !/^mongodb:\/\/127\.0\.0\.1:27017(?:\/|\?)/.test(uri)) {
    throw new Error("DIRECT_WRITE_VALIDATOR_DISPOSABLE_CI_ONLY");
  }
}
