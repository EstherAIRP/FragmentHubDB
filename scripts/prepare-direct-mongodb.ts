/**
 * Phase 1 preparatory command: generates only a non-sensitive dry-run summary.
 * Real Atlas createCollection/collMod is deliberately NOT implemented here;
 * require a separate explicit approval and implementation gate.
 */
import { createHash } from "node:crypto";
import {
  directWriteCollectionOptions,
  VALIDATION_MODE,
} from "../lib/mongodb/collection-validator";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
  console.error("DIRECT_MONGO_PREPARE_BLOCKED: dry-run only; no database changes.");
  process.exitCode = 1;
} else {
  const payload = JSON.stringify(directWriteCollectionOptions());
  console.log(JSON.stringify({
    status: "DRY_RUN_ONLY",
    phase: VALIDATION_MODE,
    collections: ["fragments", "metadata"],
    validator_sha256: createHash("sha256").update(payload).digest("hex"),
    writes_performed: 0,
    atlas_connected: false,
  }));
}
