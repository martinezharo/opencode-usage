import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LIMITS, parseArgs, parseLimits, resolveDataPaths } from "../lib/cli.mjs";

test("parseArgs reads defaults", () => {
  assert.deepEqual(parseArgs([]), {
    port: null,
    host: null,
    open: null,
    db: null,
    auth: null,
    limits: null,
    help: false,
    version: false,
  });
});

test("parseArgs reads flags and inline values", () => {
  const options = parseArgs([
    "--port",
    "8080",
    "--host=0.0.0.0",
    "--open",
    "--limits",
    "5,10,20",
    "--db",
    "/tmp/x.db",
    "-h",
  ]);
  assert.equal(options.port, 8080);
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.open, true);
  assert.equal(options.limits, "5,10,20");
  assert.equal(options.db, "/tmp/x.db");
  assert.equal(options.help, true);
});

test("parseArgs rejects unknown flags and bad ports", () => {
  assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseArgs(["--port", "abc"]), /invalid port/);
  assert.throws(() => parseArgs(["--port=99999"]), /invalid port/);
});

test("parseLimits accepts triples and none", () => {
  assert.deepEqual(parseLimits("12,30,60"), { ...DEFAULT_LIMITS });
  assert.deepEqual(parseLimits(" 5 , 10 , 20 "), { rolling: 5, weekly: 10, monthly: 20 });
  assert.deepEqual(parseLimits("none"), { disabled: true });
  assert.equal(parseLimits(null), null);
  assert.equal(parseLimits(""), null);
  assert.throws(() => parseLimits("1,2"), /invalid limits/);
  assert.throws(() => parseLimits("a,b,c"), /invalid limits/);
});

test("resolveDataPaths honours explicit paths", () => {
  const paths = resolveDataPaths({ db: "/tmp/a.db", auth: "/tmp/b.json" });
  assert.equal(paths.dbPath, "/tmp/a.db");
  assert.equal(paths.authPath, "/tmp/b.json");
});
