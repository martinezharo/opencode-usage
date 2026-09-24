#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { HELP, openBrowser, parseArgs, parseLimits, resolveDataPaths } from "../lib/cli.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`opencode-usage-dash: ${error.message}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}

if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (options.version) {
  console.log(pkg.version);
  process.exit(0);
}

try {
  parseLimits(options.limits);
} catch (error) {
  console.error(`opencode-usage-dash: ${error.message}`);
  process.exit(2);
}

const { dbPath, authPath } = resolveDataPaths({ db: options.db, auth: options.auth });
if (options.db) process.env.OPENCODE_DB = options.db;
if (options.auth) process.env.OPENCODE_AUTH = options.auth;
if (options.port != null) process.env.PORT = String(options.port);
if (options.host != null) process.env.HOST = options.host;
if (options.limits != null) process.env.OPENCODE_USAGE_LIMITS = options.limits;

const { server } = await import("../server.mjs");

const autoOpen =
  options.open ?? (process.stdout.isTTY === true && process.env.OPENCODE_USAGE_NO_OPEN !== "1");

server.on("listening", () => {
  const address = server.address();
  const host = address?.address === "::" || address?.address === "0.0.0.0" ? "127.0.0.1" : address?.address;
  const url = `http://${host}:${address?.port ?? process.env.PORT ?? 4173}`;

  if (!existsSync(dbPath)) {
    console.warn(
      `warning: no opencode database found at ${dbPath}. ` +
        "Run opencode once, or point --db at the right file.",
    );
  }
  if (!existsSync(authPath)) {
    console.warn(`warning: no opencode auth file found at ${authPath}; plan windows stay local.`);
  }
  if (autoOpen) openBrowser(url);
});
