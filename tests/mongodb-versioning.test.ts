import assert from "node:assert/strict";
import test from "node:test";

import { nextUpdatedAt } from "../lib/fragments/versioning";

test("updated_at increases if saved twice in the same millisecond", () => {
  assert.equal(
    nextUpdatedAt(["2026-10-15T04:00:00.000Z"], Date.parse("2026-10-15T04:00:00.000Z")),
    "2026-10-15T04:00:00.001Z",
  );
});

test("updated_at remains later than every touched item, not every stored item", () => {
  assert.equal(
    nextUpdatedAt(
      ["2026-10-15T04:00:00.123Z", "2026-10-15T04:00:00.567Z"],
      Date.parse("2026-10-15T04:00:00.200Z"),
    ),
    "2026-10-15T04:00:00.568Z",
  );
});

test("updated_at rejects invalid timestamps instead of producing an invalid date", () => {
  assert.throws(() => nextUpdatedAt(["invalid"], 0), /Invalid previous updated_at/);
  assert.throws(() => nextUpdatedAt([], Number.NaN), /Invalid current time/);
});
