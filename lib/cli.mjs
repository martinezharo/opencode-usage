import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_LIMITS = { rolling: 12, weekly: 30, monthly: 60 };

export function parseArgs(argv) {
  const options = {
    port: null,
    host: null,
    open: null,
    db: null,
    auth: null,
    limits: null,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const take = () => {
      if (inline !== undefined) return inline;
      i += 1;
      return argv[i];
    };

    switch (flag) {
      case "-p":
      case "--port": {
        const value = Number(take());
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new Error(`invalid port: ${inline ?? argv[i]}`);
        }
        options.port = value;
        break;
      }
      case "--host":
        options.host = take();
        break;
      case "--open":
        options.open = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--db":
        options.db = take();
        break;
      case "--auth":
        options.auth = take();
        break;
      case "--limits":
        options.limits = take();
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

export function parseLimits(text) {
  if (text == null || text === "") return null;
  const value = String(text).trim().toLowerCase();
  if (value === "none") return { disabled: true };
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`invalid limits: ${text} (expected "12,30,60" or "none")`);
  }
  return { rolling: parts[0], weekly: parts[1], monthly: parts[2] };
}

export function resolveDataPaths({ db = null, auth = null } = {}) {
  const dirs = [
    process.env.XDG_DATA_HOME && join(process.env.XDG_DATA_HOME, "opencode"),
    join(homedir(), ".local", "share", "opencode"),
  ].filter(Boolean);

  const find = (name) => dirs.map((dir) => join(dir, name)).find(existsSync) ?? null;
  return {
    dbPath: db ?? process.env.OPENCODE_DB ?? find("opencode.db"),
    authPath: auth ?? process.env.OPENCODE_AUTH ?? find("auth.json"),
  };
}

export function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command[0], command[1], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening a browser is best effort.
  }
}

export const HELP = `OpenCode usage dashboard

Usage: opencode-usage-dash [options]

Options:
  -p, --port <port>     port to listen on (default 4173, 0 picks a free one)
      --host <host>     host to bind (default 127.0.0.1)
      --open            open the browser once the server is ready
      --no-open         do not open the browser
      --db <path>       path to opencode.db (default: the usual data directory)
      --auth <path>     path to auth.json (default: the usual data directory)
      --limits <l>      plan caps as "5h,weekly,monthly" in dollars,
                        or "none" to hide caps and show spend only
                        (default 12,30,60: the OpenCode Go plan)
  -h, --help            show this help
  -v, --version         show the version

Environment: PORT, HOST, OPENCODE_DB, OPENCODE_AUTH, OPENCODE_USAGE_LIMITS,
OPENCODE_GO_API_KEY, OPENCODE_GO_USAGE_URL, OPENCODE_CONSOLE_URL,
OPENCODE_GO_PROVIDER, CACHE_MS
`;
