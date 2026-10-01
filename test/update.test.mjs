import { test } from "node:test";
import assert from "node:assert/strict";

import { CURRENT_VERSION, checkUpdate, compareVersions, resetUpdateCache } from "../lib/update.mjs";

function bumped(version) {
  const [major, minor] = String(version).split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

function stubFetch(version, { calls = null, ok = true } = {}) {
  return async () => {
    if (calls) calls.count += 1;
    return { ok, json: async () => ({ version }) };
  };
}

test("compareVersions orders versions numerically", () => {
  assert.equal(compareVersions("1.0.2", "1.0.1"), 1);
  assert.equal(compareVersions("1.0.1", "1.0.2"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.0.1", "1.0.1"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0.1-beta", "1.0.1"), 0);
});

test("checkUpdate reports a newer registry version", async () => {
  resetUpdateCache();
  const result = await checkUpdate({ fetchImpl: stubFetch(bumped(CURRENT_VERSION)) });
  assert.equal(result.current, CURRENT_VERSION);
  assert.equal(result.available, true);
});

test("checkUpdate stays quiet on same or older versions", async () => {
  resetUpdateCache();
  const same = await checkUpdate({ fetchImpl: stubFetch(CURRENT_VERSION) });
  assert.equal(same.available, false);
  assert.equal(same.latest, CURRENT_VERSION);

  resetUpdateCache();
  const older = await checkUpdate({ fetchImpl: stubFetch("0.0.0") });
  assert.equal(older.available, false);
});

test("checkUpdate fails silent on http and network errors", async () => {
  resetUpdateCache();
  const http = await checkUpdate({ fetchImpl: stubFetch("9.9.9", { ok: false }) });
  assert.deepEqual(http, { current: CURRENT_VERSION, latest: null, available: false });

  resetUpdateCache();
  const network = await checkUpdate({
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(network, { current: CURRENT_VERSION, latest: null, available: false });

  resetUpdateCache();
  const missing = await checkUpdate({ fetchImpl: stubFetch(undefined) });
  assert.equal(missing.available, false);
  assert.equal(missing.latest, null);
});

test("checkUpdate caches the registry answer for a day", async () => {
  resetUpdateCache();
  const calls = { count: 0 };
  const now = Date.parse("2026-10-01T12:00:00Z");
  const first = await checkUpdate({ now, fetchImpl: stubFetch(bumped(CURRENT_VERSION), { calls }) });
  assert.equal(calls.count, 1);
  const second = await checkUpdate({
    now: now + 23 * 3600 * 1000,
    fetchImpl: stubFetch("0.0.0", { calls }),
  });
  assert.equal(calls.count, 1);
  assert.deepEqual(second, first);
  await checkUpdate({ now: now + 25 * 3600 * 1000, fetchImpl: stubFetch("0.0.0", { calls }) });
  assert.equal(calls.count, 2);
});

test("checkUpdate can be disabled without network access", async () => {
  resetUpdateCache();
  process.env.OPENCODE_USAGE_NO_UPDATE_CHECK = "1";
  try {
    const result = await checkUpdate({
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    });
    assert.deepEqual(result, { current: CURRENT_VERSION, latest: null, available: false });
  } finally {
    delete process.env.OPENCODE_USAGE_NO_UPDATE_CHECK;
  }
});
