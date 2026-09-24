# opencode-usage-dash

[opencode-usage-dash](https://opencode-usage.4oli.com/) is a local-first dashboard for
[OpenCode](https://opencode.ai) usage. It shows the rolling five-hour, weekly and monthly
plan windows, and splits every dollar by model.

- **Install:** `npx opencode-usage-dash` (Node 23.4+)
- **Container:** `ghcr.io/martinezharo/opencode-usage`
- **Source:** https://github.com/martinezharo/opencode-usage (MIT)
- **npm:** https://www.npmjs.com/package/opencode-usage-dash
- **Version:** 1.0.0

## Features

- Real percentages and reset times from the OpenCode Go usage API.
- Per-model costs from the OpenCode console, so the dollars match the website.
- Hover a bar for spend, requests and tokens per model.
- Falls back to your local database. No account, no telemetry.

## Install

npx:

```sh
npx opencode-usage-dash
```

Docker:

```sh
docker run --rm \
  -p 127.0.0.1:4173:4173 \
  -v "$HOME/.local/share/opencode:/data:ro" \
  -e OPENCODE_DB=/data/opencode.db \
  -e OPENCODE_AUTH=/data/auth.json \
  ghcr.io/martinezharo/opencode-usage:latest
```

From source:

```sh
git clone https://github.com/martinezharo/opencode-usage
cd opencode-usage
node bin/cli.mjs
```

## Configuration

The default caps are the OpenCode Go plan (`--limits 12,30,60`). Pass your own with
`--limits 20,50,100`, or `--limits none` to hide percentages and see spend by model per
window. Other flags: `--port`, `--host`, `--open` / `--no-open`, `--db`, `--auth`.
Environment overrides: `PORT`, `HOST`, `OPENCODE_DB`, `OPENCODE_AUTH`,
`OPENCODE_USAGE_LIMITS`, `OPENCODE_GO_API_KEY`.

## Privacy

Everything runs locally. The only network requests are to the OpenCode APIs, using your
own key. There is no telemetry, and the server binds to `127.0.0.1` by default.

## Links

- [GitHub](https://github.com/martinezharo/opencode-usage)
- [Releases](https://github.com/martinezharo/opencode-usage/releases)
- [llms.txt](/llms.txt) · [llms-full.txt](/llms-full.txt)
