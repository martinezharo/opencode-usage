import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import { DEFAULT_LIMITS, parseLimits, resolveDataPaths } from "./cli.mjs";

export const WINDOWS = [
  { key: "rolling", label: "5-hour window" },
  { key: "weekly", label: "weekly window" },
  { key: "monthly", label: "monthly window" },
];

const USAGE_URL =
  process.env.OPENCODE_GO_USAGE_URL ?? "https://opencode.ai/zen/go/v1/usage";
const CONSOLE_URL =
  process.env.OPENCODE_CONSOLE_URL ?? "https://console.opencode.ai";
const PROVIDER = process.env.OPENCODE_GO_PROVIDER ?? "opencode-go";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MICROCENTS_PER_DOLLAR = 1e8;

const runtime = { dbPath: null, authPath: null, limits: null };

export function configure({ dbPath, authPath, limits } = {}) {
  if (dbPath != null) runtime.dbPath = dbPath;
  if (authPath != null) runtime.authPath = authPath;
  if (limits !== undefined) runtime.limits = limits;
}

export function getLimits() {
  if (runtime.limits?.disabled) return null;
  if (runtime.limits) return runtime.limits;
  const fromEnv = parseLimits(process.env.OPENCODE_USAGE_LIMITS);
  if (fromEnv?.disabled) return null;
  return fromEnv ?? { ...DEFAULT_LIMITS };
}

export function dataPaths() {
  const resolved = resolveDataPaths();
  return {
    dbPath: runtime.dbPath ?? process.env.OPENCODE_DB ?? resolved.dbPath,
    authPath: runtime.authPath ?? process.env.OPENCODE_AUTH ?? resolved.authPath,
  };
}

export const PALETTE = [
  { light: "#b5432e", dark: "#d0694f" },
  { light: "#2f6f8f", dark: "#5b9bc0" },
  { light: "#b5851d", dark: "#d9a63e" },
  { light: "#4c7a4e", dark: "#7caf7e" },
  { light: "#6d5aa8", dark: "#9c8bd6" },
  { light: "#a65d8c", dark: "#c98fb4" },
  { light: "#2f7f79", dark: "#5fb3ac" },
];

export const NEUTRAL = { light: "#8a8378", dark: "#8f938c" };

export function minusOneMonth(ms) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime();
}

export function utcWeekStart(now) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return start - daysSinceMonday * DAY;
}

export function utcMonthStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function utcNextMonthStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function apiRanges(windows) {
  const ranges = {};
  for (const key of ["rolling", "weekly", "monthly"]) {
    const w = windows?.[key];
    if (!w || typeof w.percent !== "number" || !w.resetsAt) return null;
    const reset = Date.parse(w.resetsAt);
    if (!Number.isFinite(reset)) return null;
    const start =
      key === "rolling"
        ? reset - 5 * HOUR
        : key === "weekly"
          ? reset - 7 * DAY
          : minusOneMonth(reset);
    ranges[key] = { start, reset, percent: w.percent, status: w.status ?? "ok" };
  }
  return ranges;
}

export function localRanges(now) {
  return {
    rolling: { start: now - 5 * HOUR, reset: null, percent: null, status: "local" },
    weekly: {
      start: utcWeekStart(now),
      reset: utcWeekStart(now) + 7 * DAY,
      percent: null,
      status: "local",
    },
    monthly: {
      start: utcMonthStart(now),
      reset: utcNextMonthStart(now),
      percent: null,
      status: "local",
    },
  };
}

export function readApiKey() {
  if (process.env.OPENCODE_GO_API_KEY) return process.env.OPENCODE_GO_API_KEY;
  try {
    const auth = JSON.parse(readFileSync(dataPaths().authPath, "utf8"));
    return auth?.[PROVIDER]?.key ?? null;
  } catch {
    return null;
  }
}

export async function fetchPlanUsage({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const key = readApiKey();
  if (!key) return { ok: false, reason: "no-key" };
  try {
    const res = await fetchImpl(USAGE_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const body = await res.json();
    return { ok: true, usage: body?.usage ?? null };
  } catch (err) {
    return { ok: false, reason: "network", error: String(err?.message ?? err) };
  }
}

export async function fetchConsoleModels({
  since = null,
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  const key = readApiKey();
  if (!key) return { ok: false, reason: "no-key" };
  const url = new URL("/api/usage/models", CONSOLE_URL);
  url.searchParams.set("pageSize", "100");
  if (since) url.searchParams.set("since", new Date(since).toISOString());
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const body = await res.json();
    const models = (body?.items ?? [])
      .filter((item) => item.provider === PROVIDER)
      .map((item) => ({
        name: item.model,
        runs: Number(item.totalRequests ?? 0),
        cost: Number(item.totalCostMicroCents ?? 0) / MICROCENTS_PER_DOLLAR,
        tokens: {
          input: Number(item.totalInputTokens ?? 0),
          output: Number(item.totalOutputTokens ?? 0),
          cacheRead: Number(item.totalCacheReadTokens ?? 0),
          cacheWrite:
            Number(item.totalCacheWrite5mTokens ?? 0) +
            Number(item.totalCacheWrite1hTokens ?? 0),
        },
      }));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, reason: "network", error: String(err?.message ?? err) };
  }
}

export function openDatabase(path) {
  return new DatabaseSync(path, { readOnly: true });
}

export function queryModels(db, start, end) {
  return db
    .prepare(
      `SELECT json_extract(data,'$.modelID') AS model,
              SUM(json_extract(data,'$.cost')) AS cost,
              COUNT(*) AS runs,
              SUM(json_extract(data,'$.tokens.input')) AS input,
              SUM(json_extract(data,'$.tokens.output')) AS output,
              SUM(json_extract(data,'$.tokens.reasoning')) AS reasoning,
              SUM(json_extract(data,'$.tokens.cache.read')) AS cacheRead,
              SUM(json_extract(data,'$.tokens.cache.write')) AS cacheWrite
       FROM message
       WHERE json_extract(data,'$.role') = 'assistant'
         AND json_extract(data,'$.providerID') = ?
         AND time_created >= ?
         AND time_created < ?
       GROUP BY model
       ORDER BY cost DESC`,
    )
    .all(PROVIDER, start, end);
}

export function queryAllTime(db) {
  return db
    .prepare(
      `SELECT json_extract(data,'$.modelID') AS model,
              SUM(json_extract(data,'$.cost')) AS cost,
              COUNT(*) AS runs
       FROM message
       WHERE json_extract(data,'$.role') = 'assistant'
         AND json_extract(data,'$.providerID') = ?
       GROUP BY model
       ORDER BY cost DESC`,
    )
    .all(PROVIDER);
}

export function segmentsFrom(items) {
  const total = items.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  if (total <= 0) return { total: 0, models: [] };
  return {
    total,
    models: items
      .filter((item) => (item.cost ?? 0) > 0)
      .map((item) => ({
        name: item.name,
        spend: item.cost,
        share: item.cost / total,
        runs: item.runs,
        tokens: item.tokens,
      })),
  };
}

export function localModels(rows) {
  return rows.map((row) => ({
    name: row.model,
    cost: row.cost ?? 0,
    runs: row.runs,
    tokens: {
      input: row.input ?? 0,
      output: row.output ?? 0,
      reasoning: row.reasoning ?? 0,
      cacheRead: row.cacheRead ?? 0,
      cacheWrite: row.cacheWrite ?? 0,
    },
  }));
}

export function assignColors(models) {
  const colors = new Map();
  let i = 0;
  for (const model of models) {
    if ((model.cost ?? 0) > 0) {
      colors.set(model.name, PALETTE[i % PALETTE.length]);
      i += 1;
    }
  }
  return colors;
}

export async function snapshot({
  now = Date.now(),
  fetchImpl = fetch,
  dbPath = null,
  timeoutMs = 8000,
} = {}) {
  const plan = await fetchPlanUsage({ fetchImpl, timeoutMs });
  const ranges = plan.ok ? apiRanges(plan.usage) : null;
  const effectiveRanges = ranges ?? localRanges(now);
  const limits = getLimits();
  const resolvedDbPath = dbPath ?? dataPaths().dbPath;

  const [consoleAll, ...consoleWindows] = await Promise.all([
    fetchConsoleModels({ fetchImpl, timeoutMs }),
    ...WINDOWS.map(({ key }) =>
      fetchConsoleModels({ fetchImpl, timeoutMs, since: effectiveRanges[key].start }),
    ),
  ]);

  let db = null;
  try {
    db = openDatabase(resolvedDbPath);
  } catch {
    db = null;
  }

  let allTime;
  try {
    const consoleModels = consoleAll.ok && consoleAll.models.length > 0 ? consoleAll.models : null;
    allTime = consoleModels ?? (db ? localModels(queryAllTime(db)) : []);
    const colors = assignColors(allTime);
    const modelSource = consoleModels ? "console" : "local";

    const windows = {};
    for (const [index, { key, label }] of WINDOWS.entries()) {
      const range = effectiveRanges[key];
      const limit = limits?.[key] ?? null;
      const consoleWindow = consoleWindows[index];
      const useConsole = consoleWindow.ok && consoleWindow.models.length > 0;

      const rows = useConsole || !db ? [] : queryModels(db, range.start, now + 1);
      const { total, models } = useConsole
        ? segmentsFrom(consoleWindow.models)
        : segmentsFrom(localModels(rows));

      const percent =
        limit == null
          ? null
          : ranges != null
            ? ranges[key].percent
            : (total / limit) * 100;
      const planSpent = percent == null ? null : (percent / 100) * limit;
      const segments = models.map((model) => ({
        ...model,
        color: colors.get(model.name) ?? NEUTRAL,
      }));
      if (planSpent > 0 && total <= 0) {
        segments.push({
          name: "other clients",
          share: 1,
          spend: planSpent,
          runs: 0,
          tokens: null,
          color: NEUTRAL,
        });
      }

      windows[key] = {
        key,
        label,
        limit,
        percent,
        planSpent,
        activitySpent: total,
        startsAt: new Date(range.start).toISOString(),
        resetsAt: range.reset ? new Date(range.reset).toISOString() : null,
        status: ranges?.[key]?.status ?? (plan.ok ? "unknown" : plan.reason),
        source: useConsole ? "console" : "local",
        segments,
      };
    }

    return {
      generatedAt: new Date(now).toISOString(),
      host: hostname(),
      provider: PROVIDER,
      plan: plan.ok && ranges ? "api" : "local",
      planError: plan.ok ? null : planErrorText(plan),
      modelSource,
      consoleError:
        modelSource === "console" || consoleAll.reason === "no-key"
          ? null
          : consoleErrorText(consoleAll),
      dbPath: resolvedDbPath,
      dbAvailable: db != null,
      limits,
      windows,
      models: allTime.map((model) => ({
        name: model.name,
        allTimeSpend: model.cost,
        allTimeRuns: model.runs,
        color: colors.get(model.name) ?? NEUTRAL,
      })),
    };
  } finally {
    db?.close();
  }
}

function planErrorText(plan) {
  return plan.reason === "http" ? `http ${plan.status}` : plan.reason;
}

function consoleErrorText(consoleResult) {
  return consoleResult.reason === "http"
    ? `http ${consoleResult.status}`
    : consoleResult.reason;
}
