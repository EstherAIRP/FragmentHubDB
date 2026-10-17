import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { fragmentBackend, isFragmentWriteConfigured } from "../lib/fragments/backend";

const root = process.cwd();

/**
 * Regression for a real cutover bug: the MongoDB API could write, while the
 * board and editor remained disabled unless a GitHub data token existed.
 */
test("every private write-capable page follows the selected storage backend", () => {
  for (const page of [
    "app/(private)/page.tsx",
    "app/(private)/fragments/new/page.tsx",
    "app/(private)/fragments/[id]/edit/page.tsx",
  ]) {
    const source = readFileSync(path.join(root, page), "utf8");
    assert.match(source, /import \{ isFragmentWriteConfigured \} from ["']@\/lib\/fragments\/backend["']/);
    assert.match(source, /remoteConfigured=\{isFragmentWriteConfigured\(\)\}/);
    assert.doesNotMatch(source, /isGitHubRemoteConfigured/);
  }
});

test("MongoDB writes are enabled without a GitHub token, while missing Atlas credentials fail closed", () => {
  const previous = {
    backend: process.env.FragmentHubDB_DATA_STORE,
    github: process.env.FragmentHubDB_GITHUB_TOKEN,
    mongo: process.env.FragmentHubDB_MONGODB_URI,
  };

  try {
    process.env.FragmentHubDB_DATA_STORE = "mongodb";
    delete process.env.FragmentHubDB_GITHUB_TOKEN;
    delete process.env.FragmentHubDB_MONGODB_URI;

    assert.equal(fragmentBackend(), "mongodb");
    assert.equal(isFragmentWriteConfigured(), false);

    process.env.FragmentHubDB_MONGODB_URI = "mongodb://127.0.0.1:27017";
    assert.equal(isFragmentWriteConfigured(), true);

    delete process.env.FragmentHubDB_DATA_STORE;
    assert.equal(fragmentBackend(), "local");
    assert.equal(isFragmentWriteConfigured(), false);
  } finally {
    for (const [key, value] of [
      ["FragmentHubDB_DATA_STORE", previous.backend],
      ["FragmentHubDB_GITHUB_TOKEN", previous.github],
      ["FragmentHubDB_MONGODB_URI", previous.mongo],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("storage failure text does not misleadingly demand GitHub for MongoDB", () => {
  for (const file of [
    "components/board-workspace.tsx",
    "components/fragment-form.tsx",
  ]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /GitHub (?:Remote Store 尚未設定|儲存失敗)/);
  }
});
