import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const LIMITS = { rolling: 12, weekly: 30, monthly: 60 };

export const WINDOWS = [
  { key: "rolling", label: "5-hour window" },
  { key: "weekly", label: "weekly window" },
  { key: "monthly", label: "monthly window" },
];

const DB_PATH =
  process.env.OPENCODE_DB ?? join(homedir(), ".local/share/opencode/opencode.db");
const AUTH_PATH =
  process.env.OPENCODE_AUTH ?? join(homedir(), ".local/share/opencode/auth.json");
const USAGE_URL =
  process.env.OPENCODE_GO_USAGE_URL ?? "https://opencode.ai/zen/go/v1/usage";
const PROVIDER = process.env.OPENCODE_GO_PROVIDER ?? "opencode-go";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

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
    const auth = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
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

export function openDatabase(path = DB_PATH) {
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

export function normalize(rows, spent) {
  const localTotal = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  if (localTotal <= 0) return { localTotal, models: [] };
  return {
    localTotal,
    models: rows.map((r) => ({
      name: r.model,
      localSpend: r.cost,
      share: r.cost / localTotal,
      spend: (r.cost / localTotal) * spent,
      runs: r.runs,
      tokens: {
        input: r.input ?? 0,
        output: r.output ?? 0,
        reasoning: r.reasoning ?? 0,
        cacheRead: r.cacheRead ?? 0,
        cacheWrite: r.cacheWrite ?? 0,
      },
    })),
  };
}

export function assignColors(models) {
  const colors = new Map();
  let i = 0;
  for (const m of models) {
    if ((m.cost ?? 0) > 0) {
      colors.set(m.model, PALETTE[i % PALETTE.length]);
      i += 1;
    }
  }
  return colors;
}

export async function snapshot({
  now = Date.now(),
  fetchImpl = fetch,
  dbPath = DB_PATH,
  timeoutMs = 8000,
} = {}) {
  const plan = await fetchPlanUsage({ fetchImpl, timeoutMs });
  const ranges = plan.ok ? apiRanges(plan.usage) : null;
  const effectiveRanges = ranges ?? localRanges(now);

  const db = openDatabase(dbPath);
  let allTime;
  try {
    allTime = queryAllTime(db);
    const colors = assignColors(allTime);

    const windows = {};
    for (const { key, label } of WINDOWS) {
      const range = effectiveRanges[key];
      const rows = queryModels(db, range.start, now + 1);
      const limit = LIMITS[key];
      const percent =
        ranges != null ? ranges[key].percent : (rows.reduce((s, r) => s + r.cost, 0) / limit) * 100;
      const spent = (percent / 100) * limit;
      const { localTotal, models } = normalize(
        rows.filter((r) => (r.cost ?? 0) > 0),
        spent,
      );
      const segments = models.map((m) => ({
        ...m,
        color: colors.get(m.name) ?? NEUTRAL,
      }));
      if (spent > 0 && localTotal <= 0) {
        segments.push({
          name: "other clients",
          share: 1,
          spend: spent,
          localSpend: 0,
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
        spent,
        localSpent: localTotal,
        startsAt: new Date(range.start).toISOString(),
        resetsAt: range.reset ? new Date(range.reset).toISOString() : null,
        status: ranges?.[key]?.status ?? (plan.ok ? "unknown" : plan.reason),
        segments,
      };
    }

    return {
      generatedAt: new Date(now).toISOString(),
      host: hostname(),
      provider: PROVIDER,
      plan: plan.ok && ranges ? "api" : "local",
      planError: plan.ok ? null : planErrorText(plan),
      limits: LIMITS,
      windows,
      models: allTime.map((m) => ({
        name: m.model,
        allTimeSpend: m.cost,
        allTimeRuns: m.runs,
        color: colors.get(m.model) ?? NEUTRAL,
      })),
    };
  } finally {
    db.close();
  }
}

function planErrorText(plan) {
  return plan.reason === "http" ? `http ${plan.status}` : plan.reason;
}
