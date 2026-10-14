import assert from "node:assert/strict";
import test from "node:test";

import { fragmentBackend, isFragmentWriteConfigured } from "../lib/fragments/backend";
import { assertFragmentHubDbOrigin } from "../lib/fragments/migration-origin";

test("Atlas must be explicitly selected; a token alone preserves legacy GitHub", () => {
  const previous = {
    backend: process.env.FragmentHubDB_DATA_STORE,
    github: process.env.FragmentHubDB_GITHUB_TOKEN,
    mongo: process.env.FragmentHubDB_MONGODB_URI,
    genericMongo: process.env.MONGODB_URI,
  };
  try {
    delete process.env.FragmentHubDB_DATA_STORE;
    delete process.env.FragmentHubDB_GITHUB_TOKEN;
    delete process.env.FragmentHubDB_MONGODB_URI;
    delete process.env.MONGODB_URI;
    assert.equal(fragmentBackend(), "local");
    assert.equal(isFragmentWriteConfigured(), false);

    process.env.FragmentHubDB_GITHUB_TOKEN = "test-token";
    assert.equal(fragmentBackend(), "github");
    assert.equal(isFragmentWriteConfigured(), true);

    process.env.FragmentHubDB_DATA_STORE = "mongodb";
    assert.equal(fragmentBackend(), "mongodb");
    assert.equal(isFragmentWriteConfigured(), false);
    process.env.MONGODB_URI = "mongodb://unrelated.example.test";
    assert.equal(isFragmentWriteConfigured(), false);
    process.env.FragmentHubDB_MONGODB_URI = "mongodb://example.test";
    assert.equal(isFragmentWriteConfigured(), true);

    process.env.FragmentHubDB_DATA_STORE = "incorrect";
    assert.throws(() => fragmentBackend(), /Invalid FragmentHubDB_DATA_STORE/);
  } finally {
    for (const [name, value] of [
      ["FragmentHubDB_DATA_STORE", previous.backend],
      ["FragmentHubDB_GITHUB_TOKEN", previous.github],
      ["FragmentHubDB_MONGODB_URI", previous.mongo],
      ["MONGODB_URI", previous.genericMongo],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("MongoDB migration accepts only FragmentHubDB GitHub origins", () => {
  for (const allowed of [
    "https://github.com/EstherAIRP/FragmentHubDB",
    "https://github.com/EstherAIRP/FragmentHubDB.git",
    "git@github.com:EstherAIRP/FragmentHubDB.git",
    "ssh://git@github.com/EstherAIRP/FragmentHubDB.git",
  ]) {
    assert.doesNotThrow(() => assertFragmentHubDbOrigin(allowed));
  }

  for (const rejected of [
    "https://github.com/EstherAIRP/FragmentHub",
    "https://github.com/EstherAIRP/FragmentHub.git",
    "https://github.com/SomeoneElse/FragmentHubDB.git",
    "https://github.com/EstherAIRP/FragmentHubDB.evil",
    "file:///tmp/FragmentHubDB",
  ]) {
    assert.throws(() => assertFragmentHubDbOrigin(rejected), /Refusing MongoDB import/);
  }
});
