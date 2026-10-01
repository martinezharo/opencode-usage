import packageJson from "../package.json" with { type: "json" };

export const CURRENT_VERSION = packageJson.version;

const LATEST_URL =
  process.env.OPENCODE_USAGE_REGISTRY_URL ?? "https://registry.npmjs.org/opencode-usage-dash/latest";

const CHECK_TTL_MS = 24 * 3600 * 1000;

let cache = { at: 0, latest: null };

export function compareVersions(a, b) {
  const parts = (value) =>
    String(value)
      .split("+")[0]
      .split("-")[0]
      .split(".")
      .map((part) => {
        const n = Number(part);
        return Number.isInteger(n) && n >= 0 ? n : 0;
      });
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function resetUpdateCache() {
  cache = { at: 0, latest: null };
}

export async function checkUpdate({ now = Date.now(), fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (process.env.OPENCODE_USAGE_NO_UPDATE_CHECK === "1") {
    return { current: CURRENT_VERSION, latest: null, available: false };
  }
  if (cache.latest && now - cache.at < CHECK_TTL_MS) {
    return {
      current: CURRENT_VERSION,
      latest: cache.latest,
      available: compareVersions(cache.latest, CURRENT_VERSION) > 0,
    };
  }
  try {
    const res = await fetchImpl(LATEST_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { current: CURRENT_VERSION, latest: cache.latest, available: false };
    const body = await res.json();
    const latest = typeof body?.version === "string" ? body.version : null;
    if (latest) cache = { at: now, latest };
    return {
      current: CURRENT_VERSION,
      latest,
      available: latest ? compareVersions(latest, CURRENT_VERSION) > 0 : false,
    };
  } catch {
    return { current: CURRENT_VERSION, latest: cache.latest, available: false };
  }
}
