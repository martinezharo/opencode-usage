import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot } from "./lib/usage.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const CACHE_MS = Number(process.env.CACHE_MS ?? 30000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

let cache = { at: 0, data: null };
let inflight = null;

async function usage() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = snapshot()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/usage") {
    try {
      send(res, 200, "application/json; charset=utf-8", JSON.stringify(await usage()));
    } catch (err) {
      send(
        res,
        500,
        "application/json; charset=utf-8",
        JSON.stringify({ error: String(err?.message ?? err) }),
      );
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "method not allowed");
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname.includes("..")) {
    send(res, 403, "text/plain; charset=utf-8", "forbidden");
    return;
  }

  const file = join(PUBLIC_DIR, pathname);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", "not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`opencode-usage listening on http://${HOST}:${PORT}`);
});
