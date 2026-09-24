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
  normalize,
  snapshot,
  utcMonthStart,
  utcNextMonthStart,
  utcWeekStart,
} from "../lib/usage.mjs";

process.env.OPENCODE_GO_API_KEY = "test-key";
process.env.OPENCODE_AUTH = "/nonexistent/auth.json";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const API_WINDOWS = {
  rolling: { status: "ok", percent: 4, resetsAt: "2026-09-24T17:09:41.948Z" },
  weekly: { status: "ok", percent: 29, resetsAt: "2026-09-28T00:00:00.000Z" },
  monthly: { status: "ok", percent: 14, resetsAt: "2026-10-22T13:53:05.000Z" },
};

function apiFetch(windows = API_WINDOWS) {
  return async () => ({ ok: true, json: async () => ({ usage: windows }) });
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
  assert.equal(
    utcMonthStart(Date.parse("2026-09-24T17:00:00Z")),
    Date.parse("2026-09-01T00:00:00Z"),
  );
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
  assert.equal(apiRanges({ rolling: { percent: 4, resetsAt: API_WINDOWS.rolling.resetsAt } }), null);
  assert.equal(apiRanges({ ...API_WINDOWS, weekly: { status: "ok", resetsAt: "x" } }), null);
});

test("normalize scales local shares to the plan spend", () => {
  const rows = [
    { model: "a", cost: 3, runs: 5, input: 10, output: 1, cacheRead: 2 },
    { model: "b", cost: 1, runs: 2, input: 20, output: 2, cacheRead: 4 },
  ];
  const { localTotal, models } = normalize(rows, 8);
  assert.equal(localTotal, 4);
  assert.equal(models[0].share, 0.75);
  assert.equal(models[0].spend, 6);
  assert.equal(models[1].share, 0.25);
  assert.equal(models[1].spend, 2);
  assert.equal(models[0].tokens.input, 10);
});

test("assignColors follows all-time spend and skips free models", () => {
  const colors = assignColors([
    { model: "a", cost: 2 },
    { model: "free", cost: 0 },
    { model: "b", cost: 1 },
  ]);
  assert.deepEqual(colors.get("a"), PALETTE[0]);
  assert.deepEqual(colors.get("b"), PALETTE[1]);
  assert.equal(colors.has("free"), false);
});

test("snapshot combines plan percentages with the local model split", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([
    message("deepseek-v4.1-flash", 0.6, now - 1 * HOUR),
    message("muse-spark-1.3-contributor", 0.2, now - 2 * HOUR),
    message("deepseek-v4.1-flash", 1.0, Date.parse("2026-09-22T10:00:00Z")),
    message("muse-spark-1.3-contributor", 5.0, Date.parse("2026-09-20T10:00:00Z")),
    message("deepseek-v4.1-flash", 9.0, now - 1 * HOUR, "opencode"),
  ]);

  const result = await snapshot({ now, fetchImpl: apiFetch(), dbPath });
  assert.equal(result.plan, "api");
  assert.equal(result.limits.weekly, 30);

  const rolling = result.windows.rolling;
  assert.equal(rolling.percent, 4);
  assert.equal(round(rolling.spent), 0.48);
  assert.equal(round(rolling.localSpent), 0.8);
  assert.equal(rolling.resetsAt, "2026-09-24T17:09:41.948Z");
  assert.deepEqual(
    rolling.segments.map((segment) => [segment.name, round(segment.spend), round(segment.share)]),
    [
      ["deepseek-v4.1-flash", 0.36, 0.75],
      ["muse-spark-1.3-contributor", 0.12, 0.25],
    ],
  );

  const weekly = result.windows.weekly;
  assert.equal(round(weekly.localSpent), 1.8);
  assert.equal(round(weekly.spent), 8.7);
  assert.equal(round(weekly.segments[0].share), 0.889);

  const monthly = result.windows.monthly;
  assert.equal(round(monthly.localSpent), 0.8);
});

test("snapshot falls back to local windows when the plan API fails", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([
    message("deepseek-v4.1-flash", 6, now - 1 * HOUR),
    message("muse-spark-1.3-contributor", 4, Date.parse("2026-09-22T10:00:00Z")),
    message("deepseek-v4.1-flash", 20, Date.parse("2026-09-20T10:00:00Z")),
  ]);

  const result = await snapshot({
    now,
    fetchImpl: async () => {
      throw new Error("offline");
    },
    dbPath,
  });
  assert.equal(result.plan, "local");
  assert.equal(result.windows.weekly.startsAt, "2026-09-21T00:00:00.000Z");
  assert.equal(round(result.windows.weekly.spent), 10);
  assert.equal(round(result.windows.weekly.percent), 33.333);
  assert.equal(round(result.windows.monthly.spent), 30);
  assert.equal(round(result.windows.rolling.spent), 6);
});

test("snapshot marks usage with no local history as other clients", async () => {
  const now = Date.parse("2026-09-24T17:00:00Z");
  const dbPath = makeDb([message("deepseek-v4.1-flash", 1, Date.parse("2026-09-10T10:00:00Z"))]);

  const result = await snapshot({ now, fetchImpl: apiFetch(), dbPath });
  const rolling = result.windows.rolling;
  assert.equal(rolling.localSpent, 0);
  assert.deepEqual(
    rolling.segments.map((segment) => segment.name),
    ["other clients"],
  );
  assert.equal(round(rolling.segments[0].spend), 0.48);
});

function round(value) {
  return Math.round(value * 1000) / 1000;
}
