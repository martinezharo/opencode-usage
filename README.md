# opencode-usage

A small dashboard for OpenCode Go plan usage. Three windows — rolling 5 hours ($12), weekly ($30) and monthly ($60) — each drawn as a single bar split into colored segments per model, so you can see which model is burning the budget. Hover or focus a bar for per-model spend, token counts and run counts.

## How it works

- Plan percentages and reset times come from the OpenCode Go usage API (`GET https://opencode.ai/zen/go/v1/usage`) with the key stored by `opencode` in `~/.local/share/opencode/auth.json`.
- Per-model costs, request counts and tokens come from the OpenCode console API (`GET https://console.opencode.ai/api/usage/models?since=…`), queried once per window. These are the same numbers the console's "Usage by model" table shows, so the model split adds up to real console costs.
- If the console is unreachable, the dashboard falls back to the local OpenCode database (`opencode.db`, provider `opencode-go`) for model costs, and to local windows (rolling 5 hours, UTC week, UTC calendar month) if the plan API is down too.

Plan percentages use OpenCode's own accounting, which is not the same scale as console model costs; the bars track the plan, and the hover detail reports console activity.

## Run

Requires Node 23.4+ (uses the built-in `node:sqlite`).

```sh
pnpm start   # http://127.0.0.1:4173
pnpm dev     # watch mode
pnpm test
```

Environment overrides: `PORT`, `HOST`, `CACHE_MS`, `OPENCODE_DB`, `OPENCODE_AUTH`, `OPENCODE_GO_API_KEY`, `OPENCODE_GO_USAGE_URL`, `OPENCODE_GO_PROVIDER`.
