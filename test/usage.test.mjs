import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  PALETTE,
  apiRanges,
  assignColors,
  minusOneMonth,
  segmentsFrom,
  snapshot,
  utcMonthStart,
  utcNextMonthStart,
  utcWeekStart,
} from "../lib/usage.mjs";

process.env.OPENCODE_GO_API_KEY = "test-key";
process.env.OPENCODE_AUTH = "/nonexistent/auth.json";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MICROCENTS = 1e8;

const API_WINDOWS = {
  rolling: { status: "ok", percent: 4, resetsAt: "2026-09-24T17:09:41.948Z" },
  weekly: { status: "ok", percent: 29, resetsAt: "2026-09-28T00:00:00.000Z" },
  monthly: { status: "ok", percent: 14, resetsAt: "2026-10-22T13:53:05.000Z" },
};

function consoleItem(model, dollars, { runs = 1, input = 0, output = 0, cacheRead = 0 } = {}) {
  return {
    model,
    provider: "opencode-go",
    totalRequests: String(runs),
    totalInputTokens: String(input),
    totalOutputTokens: String(output),
    totalCacheReadTokens: String(cacheRead),
    totalCacheWrite5mTokens: "0",
    totalCacheWrite1hTokens: "0",
    totalCostMicroCents: String(Math.round(dollars * MICROCENTS)),
  };
}

function stubFetch({ plan = API_WINDOWS, consoleItems, consoleFails = false } = {}) {
  return async (url) => {
    const href = String(url);
    if (href.includes("/api/usage/models")) {
      if (consoleFails) throw new Error("console offline");
      const since = new URL(href).searchParams.get("since");
      const items = consoleItems(since);
      return { ok: true, json: async () => ({ items }) };
    }
    if (href.includes("/zen/go/v1/usage")) {
      return { ok: true, json: async () => ({ usage: plan }) };
    }
    throw new Error(`unexpected url ${href}`);
  };
}

function makeDb(rows) {
  const path = join(mkdtempSync(join(tmpdir(), "opencode-usage-")), "test.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)",
  );
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  rows.forEach((row, index) => {
    insert.run(`msg_${index}`, "ses_1", row.time, row.time, JSON.stringify(row.data));
  });
  db.close();
  return path;
}

function message(model, cost, time, provider = "opencode-go") {
  return {
    time,
    data: {
      role: "assistant",
      providerID: provider,
      modelID: model,
      cost,
      tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 5000, write: 0 } },
    },
  };
}

const CONSOLE_ITEMS = (since) => {
  if (since === null) {
    return [
      consoleItem("deepseek-v4.1-flash", 2.05, { runs: 1200 }),
      consoleItem("mimo-v2.6-pro", 1.34, { runs: 115 }),
      consoleItem("muse-spark-1.3-contributor", 1.28, { runs: 714 }),
    ];
  }
  if (since.startsWith("2026-09-24T12:09")) {
    return [
      consoleItem("deepseek-v4.1-flash", 0.36, { runs: 300 }),
      consoleItem("muse-spark-1.3-contributor", 0.12, { runs: 10 }),
    ];
  }
  return [
    consoleItem("deepseek-v4.1-flash", 2.05, { runs: 1200 }),
    consoleItem("mimo-v2.6-pro", 1.34, { runs: 115 }),
    consoleItem("muse-spark-1.3-contributor", 1.28, { runs: 714 }),
  ];
};

test("minusOneMonth keeps the day when the target month allows it", () => {
  assert.equal(
    minusOneMonth(Date.parse("2026-10-22T13:53:05Z")),
    Date.parse("2026-09-22T13:53:05Z"),
  );
  assert.equal(
    minusOneMonth(Date.parse("2026-01-15T00:00:00Z")),
    Date.parse("2025-12-15T00:00:00Z"),
  );
});

test("week and month starts are UTC boundaries", () => {
  assert.equal(
    utcWeekStart(Date.parse("2026-09-24T17:00:00Z")),
    Date.parse("2026-09-21T00:00:00Z"),
  );
  assert.equal(
    utcWeekStart(Date.parse("2026-09-21T00:00:00Z")),
    Date.parse("2026-09-21T00:00:00Z"),
  );
  assert.equal(utcMonthStart(Date.parse("2026-09-24T17:00:00Z")), Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(
    utcNextMonthStart(Date.parse("2026-09-24T17:00:00Z")),
    Date.parse("2026-10-01T00:00:00Z"),
  );
});

test("apiRanges derives window starts from reset times", () => {
  const ranges = apiRanges(API_WINDOWS);
  assert.equal(ranges.rolling.start, Date.parse("2026-09-24T12:09:41.948Z"));
  assert.equal(ranges.weekly.start, Date.parse("2026-09-21T00:00:00.000Z"));
  assert.equal(ranges.monthly.start, Date.parse("2026-09-22T13:53:05.000Z"));
  assert.equal(ranges.rolling.percent, 4);
});

test("apiRanges rejects incomplete payloads", () => {
  assert.equal(
    apiRanges({ rolling: { percent: 4, resetsAt: API_WINDOWS.rolling.resetsAt } }),
    null,
  );
  assert.equal(apiRanges({ ...API_WINDOWS, weekly: { status: "ok", resetsAt: "x" } }), null);
});

test("segmentsFrom converts costs into shares and drops free models", () => {
  const { total, models } = segmentsFrom([
    { name: "a", cost: 3, runs: 5, tokens: { input: 10 } },
    { name: "b", cost: 1, runs: 2, tokens: { input: 20 } },
    { name: "free", cost: 0, runs: 9, tokens: { input: 99 } },
  ]);
  assert.equal(total, 4);
  assert.equal(models.length, 2);
  assert.equal(models[0].share, 0.75);
  assert.equal(models[0].spend, 3);
  assert.equal(models[1].share, 0.25);
});

test("assignColors follows all-time spend and skips free models", () => {
  const colors = assignColors([
    { name: "a", cost: 2 },
    { name: "free", cost: 0 },
    { name: "b", cost: 1 },
  ]);
  assert.deepEqual(colors.get("a"), PALETTE[0]);
  assert.deepEqual(colors.get("b"), PALETTE[1]);
  assert.equal(colors.has("free"), false);
});

test("snapshot splits each window with the console's real model costs", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([message("deepseek-v4.1-flash", 0.6, now - 1 * HOUR)]);

  const result = await snapshot({
    now,
    fetchImpl: stubFetch({ consoleItems: CONSOLE_ITEMS }),
    dbPath,
  });

  assert.equal(result.plan, "api");
  assert.equal(result.modelSource, "console");
  assert.equal(result.consoleError, null);

  const rolling = result.windows.rolling;
  assert.equal(rolling.percent, 4);
  assert.equal(rolling.planSpent, 0.48);
  assert.equal(rolling.activitySpent, 0.48);
  assert.equal(rolling.source, "console");
  assert.equal(rolling.resetsAt, "2026-09-24T17:09:41.948Z");
  assert.deepEqual(
    rolling.segments.map((segment) => [segment.name, round(segment.spend), round(segment.share)]),
    [
      ["deepseek-v4.1-flash", 0.36, 0.75],
      ["muse-spark-1.3-contributor", 0.12, 0.25],
    ],
  );

  const weekly = result.windows.weekly;
  assert.equal(weekly.percent, 29);
  assert.equal(weekly.planSpent, 8.7);
  assert.equal(weekly.activitySpent, 4.67);
  assert.deepEqual(
    weekly.segments.map((segment) => segment.name),
    ["deepseek-v4.1-flash", "mimo-v2.6-pro", "muse-spark-1.3-contributor"],
  );
  assert.equal(weekly.segments[0].runs, 1200);

  assert.deepEqual(
    result.models.map((model) => model.name),
    ["deepseek-v4.1-flash", "mimo-v2.6-pro", "muse-spark-1.3-contributor"],
  );
});

test("snapshot falls back to local session costs when the console is unreachable", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([
    message("deepseek-v4.1-flash", 6, now - 1 * HOUR),
    message("muse-spark-1.3-contributor", 4, Date.parse("2026-09-22T10:00:00Z")),
  ]);

  const result = await snapshot({
    now,
    fetchImpl: stubFetch({ consoleFails: true }),
    dbPath,
  });

  assert.equal(result.modelSource, "local");
  assert.equal(result.consoleError, "network");
  assert.equal(result.windows.weekly.source, "local");
  assert.equal(result.windows.weekly.activitySpent, 10);
  assert.equal(result.windows.weekly.planSpent, 8.7);
  assert.equal(round(result.windows.rolling.activitySpent), 6);
});

test("snapshot falls back to local windows when the plan API fails", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([message("deepseek-v4.1-flash", 6, now - 1 * HOUR)]);
  const sinceParams = [];

  const result = await snapshot({
    now,
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes("/api/usage/models")) {
        const since = new URL(href).searchParams.get("since");
        sinceParams.push(since);
        return { ok: true, json: async () => ({ items: CONSOLE_ITEMS(since) }) };
      }
      throw new Error("offline");
    },
    dbPath,
  });

  assert.equal(result.plan, "local");
  assert.equal(result.windows.weekly.startsAt, "2026-09-21T00:00:00.000Z");
  assert.deepEqual(sinceParams.slice(1).sort(), [
    "2026-09-01T00:00:00.000Z",
    "2026-09-21T00:00:00.000Z",
    "2026-09-24T12:00:00.000Z",
  ]);
  assert.equal(result.windows.weekly.source, "console");
  assert.equal(round(result.windows.weekly.activitySpent), 4.67);
  assert.equal(round(result.windows.weekly.percent), 15.567);
});

test("snapshot marks usage with no model detail as other clients", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([]);

  const result = await snapshot({
    now,
    fetchImpl: stubFetch({ consoleItems: () => [] }),
    dbPath,
  });

  const rolling = result.windows.rolling;
  assert.equal(rolling.activitySpent, 0);
  assert.equal(rolling.planSpent, 0.48);
  assert.deepEqual(
    rolling.segments.map((segment) => segment.name),
    ["other clients"],
  );
});

function round(value) {
  return Math.round(value * 1000) / 1000;
}
