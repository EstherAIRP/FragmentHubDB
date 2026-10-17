import assert from "node:assert/strict";
import test from "node:test";

import canonicalSchema from "../config/fragment.schema.json";
import domainConfig from "../config/domains.json";
import {
  assertDisposableMongoValidatorTarget,
  directWriteCollectionOptions,
  fragmentCollectionValidator,
  metadataCollectionValidator,
} from "../lib/mongodb/collection-validator";

test("P1-01 source schema maps to strict Mongo BSON validator without dropping fields", () => {
  const validator = fragmentCollectionValidator();
  const mongoSchema = validator.$and[0].$jsonSchema;
  assert.deepEqual(mongoSchema.required, ["_id", ...canonicalSchema.required]);
  assert.deepEqual(Object.keys(mongoSchema.properties).sort(),
    ["_id", ...Object.keys(canonicalSchema.properties)].sort());
  assert.equal(mongoSchema.additionalProperties, false);
  assert.equal(mongoSchema.properties.schema_version.enum[0], "0.1");
  assert.equal(mongoSchema.properties.tags.maxItems, canonicalSchema.properties.tags.maxItems);
  assert.deepEqual(mongoSchema.properties.domains.items.enum, Object.keys(domainConfig.domains).sort());
  assert.deepEqual(validator.$and[1], { $expr: { $eq: ["$_id", "$id"] } });
  assert.equal(mongoSchema.properties.source.additionalProperties, false);
  assert.equal(mongoSchema.properties.ai.additionalProperties, false);
  assert.equal(mongoSchema.properties.created_at.bsonType, "string");
  assert.equal(mongoSchema.properties.created_at.format, undefined);
});

test("P1-01 metadata constraints preserve the existing Web upsert pattern", () => {
  const options = directWriteCollectionOptions();
  assert.deepEqual(Object.keys(options).sort(), ["fragments", "metadata"]);
  for (const opt of Object.values(options)) {
    assert.equal(opt.validationAction, "error");
    assert.equal(opt.validationLevel, "strict");
  }
  const schema = metadataCollectionValidator().$jsonSchema;
  assert.deepEqual(schema.required, ["_id", "version"]);
  assert.equal(schema.properties.highest_allocated.maximum, 999999);
  assert.equal(schema.properties.version.minimum, 1);
  assert.equal(schema.additionalProperties, false);
});

test("P1-04 disposable CI guard refuses all non-local database targets", () => {
  const safe = "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";
  assert.doesNotThrow(() => assertDisposableMongoValidatorTarget("fragmenthubdb_ci", safe, "true"));
  for (const [db, uri, ci] of [
    ["fragmenthubdb_test", safe, "true"],
    ["fragmenthubdb_ci", safe, "false"],
    ["fragmenthubdb_ci", "mongodb+srv://example.invalid", "true"],
    ["fragmenthubdb_ci", "mongodb://127.0.0.1.evil.example:27017/", "true"],
    ["fragmenthubdb", safe, "true"],
  ]) {
    assert.throws(() => assertDisposableMongoValidatorTarget(db!, uri!, ci!), /DISPOSABLE_CI_ONLY/);
  }
});
