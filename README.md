# opencode-usage-dash

[![npm](https://img.shields.io/npm/v/opencode-usage-dash)](https://www.npmjs.com/package/opencode-usage-dash)
[![license](https://img.shields.io/npm/l/opencode-usage-dash)](LICENSE)
[![website](https://img.shields.io/badge/website-opencode--usage.4oli.com-b5432e)](https://opencode-usage.4oli.com/)

Minimal dashboard for your OpenCode usage: the rolling 5-hour, weekly and monthly plan windows, and where the spend goes — one segmented bar per window, split by model, with the detail on hover.

![dashboard](https://raw.githubusercontent.com/martinezharo/opencode-usage/main/docs/dashboard.png)

## Features

- The three OpenCode Go plan windows with real percentages and reset countdowns, straight from the OpenCode Go usage API.
- Per-model costs taken from the OpenCode console's "Usage by model" table, so the dollars match `opencode.ai/console`.
- Hover, focus or tap a bar for per-model spend, share, request count and tokens (input, output, cache read).
- Falls back to the local OpenCode database when the console or the plan API is unreachable; runs without any plan caps too (`--limits none`).
- Zero runtime dependencies. One Node process, bound to `127.0.0.1` by default, no telemetry, no data leaves your machine.

## Quick start

### npx

```sh
npx opencode-usage-dash
```

Opens `http://127.0.0.1:4173` with your local OpenCode data.

### Docker

```sh
docker run --rm \
  -p 127.0.0.1:4173:4173 \
  -v "$HOME/.local/share/opencode:/data:ro" \
  -e OPENCODE_DB=/data/opencode.db \
  -e OPENCODE_AUTH=/data/auth.json \
  ghcr.io/martinezharo/opencode-usage:latest
```

Or `docker compose up` with the included [`docker-compose.yml`](docker-compose.yml). The container reads your OpenCode data read-only; it binds `127.0.0.1` by default, and the image deliberately has no `USER` so that both rootful and rootless Docker can read `auth.json` (mode `600`).

### From source

```sh
git clone https://github.com/martinezharo/opencode-usage
cd opencode-usage
node bin/cli.mjs
```

Requires Node 23.4+ (uses the built-in `node:sqlite`).

## Configuration

| Flag | Environment | Default | Description |
| --- | --- | --- | --- |
| `--port` | `PORT` | `4173` | Port to listen on. |
| `--host` | `HOST` | `127.0.0.1` | Interface to bind. |
| `--open` / `--no-open` | `OPENCODE_USAGE_NO_OPEN=1` | auto (TTY) | Open the browser once ready. |
| `--db` | `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | OpenCode database. |
| `--auth` | `OPENCODE_AUTH` | `~/.local/share/opencode/auth.json` | Where the API key lives. |
| `--limits` | `OPENCODE_USAGE_LIMITS` | `12,30,60` | Plan caps as `5h,weekly,monthly` dollars, or `none`. |

The default caps are the OpenCode Go plan. For other setups pass your own, for example `--limits 20,50,100`, or `--limits none` to hide percentages and just see spend by model per window. Other env vars: `OPENCODE_GO_API_KEY`, `OPENCODE_GO_USAGE_URL`, `OPENCODE_CONSOLE_URL`, `OPENCODE_GO_PROVIDER`, `CACHE_MS`.

## How it works

- **Plan windows** come from the OpenCode Go usage API (`GET https://opencode.ai/zen/go/v1/usage`) using the key stored by `opencode` in `auth.json`.
- **Model costs, requests and tokens** come from the OpenCode console API (`GET https://console.opencode.ai/api/usage/models?since=…`, micro-cents converted to dollars), queried once per window. These are the same numbers as the console's usage table.
- **Fallbacks**: console → local `opencode.db` (provider `opencode-go`); plan API → local windows (rolling 5 h, UTC week, UTC calendar month). A missing database downgrades to plan-only mode instead of failing.

Plan percentages use OpenCode's own accounting, which is a different scale from the console's model costs, so the bars track the plan while the hover detail reports console activity. Both sources are labelled in the page footer.

## Development

```sh
node --test
```

The tests cover window math, the console and plan API clients (with stubs), fallbacks and the CLI argument parser.

## License

MIT
