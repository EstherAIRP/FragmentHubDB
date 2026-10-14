import assert from "node:assert/strict";
import test from "node:test";

import { fragmentBackend, isFragmentWriteConfigured } from "../lib/fragments/backend";

test("Atlas must be explicitly selected; a token alone preserves legacy GitHub", () => {
  const previous = {
    backend: process.env.FragmentHubDB_DATA_STORE,
    github: process.env.FragmentHubDB_GITHUB_TOKEN,
    mongo: process.env.FragmentHubDB_MONGODB_URI,
    vercelMongo: process.env.MONGODB_URI,
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
    process.env.FragmentHubDB_MONGODB_URI = "mongodb://example.test";
    assert.equal(isFragmentWriteConfigured(), true);

    process.env.FragmentHubDB_DATA_STORE = "incorrect";
    assert.throws(() => fragmentBackend(), /Invalid FragmentHubDB_DATA_STORE/);
  } finally {
    for (const [name, value] of [
      ["FragmentHubDB_DATA_STORE", previous.backend],
      ["FragmentHubDB_GITHUB_TOKEN", previous.github],
      ["FragmentHubDB_MONGODB_URI", previous.mongo],
      ["MONGODB_URI", previous.vercelMongo],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
