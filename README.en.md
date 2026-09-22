# stepfun-usage-monitor — Local Token Usage Monitor for the StepFun API

Tracks token usage for the StepFun API (OpenAI-compatible). **Zero npm dependencies, typically < 60 MB resident memory, all data stays local.** It hooks in as a local reverse proxy, so it works with virtually any agent/client out of the box.

**v1.5.9**: **official ZCode plugin format** — the repo is now a ZCode plugin marketplace (`marketplace.json` + standard `plugins/` layout) with an **agent-page docked popup** (ultra-compact strip auto-docked at the bottom of the screen) and a "Full Display" button that raises the standalone browser dashboard. **Multi-provider support** (v1.5.5) — one proxy instance can switch between StepFun, Zhipu GLM, DeepSeek, Kimi, MiniMax, Qwen, Yi and other OpenAI-compatible APIs with a single click (custom gateways supported too), with usage broken down per provider. Full bilingual release notes live in [`docs/releases/`](docs/releases/).

> **[中文说明](README.md)** · This document is the English version.

## Architecture

```
┌─────────────┐   Base URL → local      ┌────────────────────────┐   forward (pass-through)   ┌──────────────────┐
│  ZCode      │ ────────────────────▶ │  Local proxy proxy.mjs  │ ────────────▶ │ Active provider    │
│  Cline      │  127.0.0.1:8787/v1/…  │  · streaming/non-stream │  as-is       │ (stepfun/GLM/…)    │
│  Continue … │ ◀──────────────────── │    usage parsing        │ ◀──────────── │                    │
└─────────────┘                       │  · incremental aggregate│               └──────────────────┘
                                      │    + ring buffer        │
                                      │  · dashboard + stats API│
                                      └───────┬─────────────────┘
                    ┌─────────────────────────┼─────────────────────────┐
                    │ data/usage.jsonl (raw)   │ data/aggregate.json(snap)│
                    └─────────────────────────┴─────────────────────────┘
                                 │ read-only
                    mcp-server.mjs (agent chat queries) ·  stats.mjs (terminal report)
```

- **Compatibility**: any client that supports a custom OpenAI-compatible Base URL (ZCode, Cline, Roo Code, Continue, Cursor, Cherry Studio, ChatBox, LobeChat, Open WebUI, Dify, LangChain/LiteLLM, the openai SDK, curl, …). MCP-capable agents (ZCode et al.) can additionally query usage conversationally through the built-in MCP server.
- **Low overhead**: a single Node process; streaming responses are piped chunk by chunk (usage is scanned in a side channel — nothing is buffered or persisted mid-stream). No database, no Electron, no background polling.
- **Fully local**: usage is appended to `usage.jsonl` (one JSON object per line, crash-safe); the `aggregate.json` snapshot contains statistics only — never keys or request bodies.

## Multi-Provider Support (v1.5.5)

One proxy instance can serve multiple LLM providers — **no extra instances, no client reconfiguration**:

- **7 built-in providers**: StepFun, Zhipu GLM, DeepSeek, Kimi (Moonshot), MiniMax, Qwen (DashScope), Yi (01.AI) — all official OpenAI-compatible endpoints.
- **Custom providers**: drop a `providers.json` in the data directory to add any OpenAI-compatible gateway, or override a built-in provider's `baseUrl` / `apiKey` / `modelPrefixes` by key:

```json
{
  "active": "deepseek",
  "providers": [
    { "key": "my-gateway", "name": "My Gateway", "baseUrl": "https://gw.example.com/v1", "apiKey": "sk-...", "modelPrefixes": ["gw-"] }
  ]
}
```

- **Routing priority** (first match wins):

| Priority | Method | Example |
|---|---|---|
| 1 | Path prefix `/p/<key>/v1/...` (prefix stripped when forwarding) | `/p/deepseek/v1/chat/completions` |
| 2 | Request header `X-Provider: <key>` | for clients that cannot change the path |
| 3 | Model-name prefix matching the provider's `modelPrefixes` | `deepseek-chat` → deepseek |
| 4 | Active default | one-click switch in the dashboard top bar, or `POST /api/provider` |

- **Key injection**: when the client sends no `Authorization` header, a key is injected in the order `providers.json` apiKey > environment variable (see "Environment Variables"); `TARGET_URL` still overrides StepFun's baseUrl.
- **Unknown keys are never silent**: an unknown provider given via path prefix / header / switch request returns 400 plus the list of valid providers.
- **Per-provider stats**: the dashboard gains a provider switcher and a provider usage panel; `/api/stats` gains a `byProvider` breakdown; MCP queries support `group="provider"`.

## Installation (pick one of three ways)

### Option 1: GitHub URL direct load (recommended — no clone, no install)

Published as a zero-dependency npm package; any machine with **Node.js ≥ 18** can pull it straight from a GitHub URL:

```bat
:: start the monitoring proxy + dashboard (default port 8787)
npx -y github:Neriah-Ado/stepfun-usage-monitor

:: run as an MCP server (for conversational agent queries)
npx -y github:Neriah-Ado/stepfun-usage-monitor --mcp

:: custom port / data directory
npx -y github:Neriah-Ado/stepfun-usage-monitor --port 8788 --data-dir D:\sfm-data
```

- The first npx run downloads and caches from GitHub; afterwards startup is instant. The packaged files and the unified `bin/cli.mjs` entry are declared in `package.json`'s `bin` / `files` fields.
- **Data directory decoupled from the npm cache**: npx runs store data under `~/.stepfun-usage-monitor/` (on Windows, `C:\Users\<you>\.stepfun-usage-monitor\`), so clearing the npm cache never loses history. Resolution order: `DATA_DIR` env var > `~/.stepfun-usage-monitor/` (used if present) > in-package `data/` (legacy data stays in place). `providers.json` lives in the same directory.

**ZCode plugin marketplace install (v1.5.9, recommended)**: this repository doubles as a ZCode plugin marketplace (root `marketplace.json`). Add the repository as a plugin-marketplace source in ZCode, then install the `stepfun-usage-monitor` plugin to get:

- the `/sfm` command: query usage and raise a **docked popup** at the bottom of the screen in one step (ultra-compact KPI strip, ~1000×190, auto-docked bottom-center; the proxy starts automatically when not running; repeated calls only focus the existing popup);
- the "⤢ Full Display" button inside the popup: raise the standalone browser dashboard at any time;
- the bundled `.mcp.json` (stdio MCP pointing at the repo's unified entry via `${CLAUDE_PLUGIN_ROOT}`) — no manual MCP config pasting needed.

Plugin layout (per the official ZCode spec):

```
marketplace.json                      marketplace manifest (plugins[] → ./plugins/stepfun-usage-monitor)
plugins/stepfun-usage-monitor/
├─ .zcode-plugin/plugin.json         plugin manifest (name/version/commands/mcpServers…)
├─ commands/sfm.md                   standard command (/sfm)
└─ .mcp.json                         stdio MCP server definition
```

**ZCode setup (MCP chat queries, manual config)**: ZCode → Settings → MCP Servers → Add, JSON mode:

```json
{
  "mcpServers": {
    "stepfun-usage": {
      "command": "npx",
      "args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]
    }
  }
}
```

**Other MCP-capable agents**:

| Agent | Configuration |
|---|---|
| Claude Code | `claude mcp add stepfun-usage -- npx -y github:Neriah-Ado/stepfun-usage-monitor --mcp` |
| Cline / Roo Code (VS Code) | MCP Servers → Configure → paste the JSON above |
| Cursor | paste the JSON above into `~/.cursor/mcp.json` |
| Generic stdio clients | `"command": "npx", "args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]` |

**Usage tracking** (independent of install method): change the client's StepFun Base URL from `https://api.stepfun.com` to `http://127.0.0.1:8787` — see "Per-Agent Configuration" below.

### Option 2: IDE extension for VS Code-family editors (VSIX)

For VS Code and its forks (Cursor, VSCodium, …): browse the dashboard inside the IDE with a **bottom-bar panel / editor window / standalone browser**, and the proxy is pulled up automatically via `npx` from GitHub when not running (`stepfunMonitor.autoStart`, on by default).

1. Download `stepfun-monitor-1.5.9.vsix` from the GitHub Release (a same-named copy lives in `ide-extension/dist/`).
2. Install: `code --install-extension stepfun-monitor-1.5.9.vsix`, or the Extensions view → `…` → **Install from VSIX…**.
3. Commands in the Command Palette (Ctrl+Shift+P):
   - **StepFun Monitor: Show Bottom Bar Panel** — dashboard embedded in the bottom bar (`?layout=panel`)
   - **StepFun Monitor: Open in Window** — standalone editor window (`?layout=window`)
   - **StepFun Monitor: Open Full Dashboard in Browser** — jump to the system browser
   - **StepFun Monitor: Start Local Proxy (npx from GitHub)**
4. The status bar shows today's token consumption; the proxy address and more are configurable under `stepfunMonitor.*`.

> **ZCode Desktop** is a standalone Electron app (not the VS Code kernel) and does not support VSIX extensions. ZCode users should use **Option 1** plus the plugin-marketplace install (v1.5.9, above) and the browser layouts below.

### Option 3: Manual install (kept for compatibility)

```bat
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor
start.cmd          :: or node proxy.mjs
```

1. Make sure Node.js ≥ 18 is installed (no `npm install` needed — zero dependencies).
2. Double-click `start.cmd` (or run `node proxy.mjs`) and you should see:

   ```
   Listen addr : http://127.0.0.1:8787
   Dashboard   : http://127.0.0.1:8787/
   Data file   : ...\data\usage.jsonl
   ```

3. In your agent, change the Base URL to `http://127.0.0.1:8787/v1` (keep your existing StepFun API key).
4. The MCP config also works in manual-install form: `"command": "node", "args": ["<absolute path>\\mcp-server.mjs"]`.

> Existing manual-install users (with `data/usage.jsonl` already in the repo) keep reading and writing the original directory after upgrading — no data migration. When mixing manual installs and npx direct loads, point `DATA_DIR` explicitly at the same directory.

## Three Ways to Browse the Dashboard

The same dashboard renders in three layouts via the `?layout=` parameter, switchable from the top-right corner at any time:

| Mode | Entry | Content | Best for |
|---|---|---|---|
| **Full page** | `http://127.0.0.1:8787/` | Everything: KPIs, chart, rankings, recent requests, 3 performance modes, provider switcher | Desktop browser |
| **Small window** | `/?layout=window` or double-click `open-window.cmd` | KPIs + chart (long tables hidden) | Floating window / split screen |
| **Bottom bar (docked popup)** | `/?layout=panel`, double-click `open-panel.cmd`, the `/sfm` command, or `--panel` | Ultra-compact KPI strip + "⤢ Full Display" button (~220 px tall, lite payload) | Docked / always-on |

- `open-window.cmd` opens the small window as a borderless Chrome/Edge `--app` window; `open-panel.cmd` opens a small bottom-bar window.
- Bottom-bar windows raised via the MCP `open_monitor_panel` tool or `--panel` are **auto-docked bottom-center** based on the primary screen resolution; repeated calls only focus the existing window.
- In embedded modes, the "↗ browser page" button jumps out to a standalone browser page; the bottom bar (docked popup) instead offers the "⤢ Full Display" standalone entry in its title row; the full page offers "window" and "bottom bar" entries.
- **Inside ZCode (v1.5.9 docked popup)**: after installing the stepfun-usage-monitor plugin from the marketplace, tell the agent "show token usage" or type `/sfm` to raise the docked popup at the bottom of the screen (`?layout=panel`, auto-docked); click "⤢ Full Display" inside it to open the standalone browser dashboard. The MCP tool `open_monitor_panel(mode="panel"|"full")` or the CLI `node bin/cli.mjs --panel [full]` raises it directly as well.
- **Inside VS Code-family IDEs**: after installing the Option 2 extension, the bottom-bar panel / window / browser modes work out of the box.

## Interaction Performance and Performance Modes (v1.4.0)

The dashboard offers **Lite / Balanced / Ultra** performance modes (the mode bar sits outside the auto-refresh area, the choice persists in the browser's `localStorage`, and ←/→ keys switch modes). **Lite mode has exactly one goal: minimize performance cost.**

| | Lite | Balanced (default) | Ultra |
|---|---|---|---|
| Poll interval | **120 s** | 30 s | **10 s** |
| Payload | **`?lite=1` slim** | Full | Full |
| Chart | **No SVG**, text summary only | Full bar chart | Full bar chart |
| Ranking / recent rows | 5 / 6 | 8 / 10 | 12 / 20 |
| Animations / transitions / shadows / gradients | **All off** | Light transitions | Number roll-up + entrance + highlight |
| When page hidden | **Polling paused** | Polling paused | Polling paused |

Lite mode's triple de-loading: ① all animations, transitions, shadows and gradients off in CSS (the skeleton degrades to a solid block); ② no SVG chart string is built — only a text summary; ③ the server serializes just 5+5+6 records over at most 14 days with `?lite=1`, cutting `JSON.stringify` and front-end parsing cost sharply.

In addition, the following apply in **all modes**:

- **Zero-wait clicks**: actions like copying the prompt use an optimistic UI — button state and toast appear synchronously, async work is deferred, perceived latency is 0.
- **Zero DOM operations when data is unchanged**: every refresh computes a data signature; the most common polling path ("no new requests") writes nothing to the DOM.
- **In-place incremental updates**: `#app` mounts its skeleton once; afterwards only changed text / bar widths / SVG are updated — no full DOM rebuilds.
- **Frame-yielding rendering**: data updates run after a `requestAnimationFrame` yield so interactions respond first.
- **Wait animations**: first-paint skeleton shimmer; the top progress bar and "syncing…" indicator appear only when a request exceeds **350 ms** (no flicker on fast requests).
- **Zero background cost**: timers are cleared when the page is hidden; a refetch happens only on return when data is stale; a `setTimeout` chain replaces `setInterval` so slow requests never stack up.
- **Accessibility**: when the system enables "reduce motion" (`prefers-reduced-motion`), all animations are off even in Ultra mode.

## Performance (first optimization pass, v1.1.0, measured)

Benchmark environment: Windows / Node v22.12.0 / 200k history records (38.4 MB) / loopback mock upstream; the control group is v1.0.1. Reproduce with `npm run bench`.

| Metric | v1.0.1 | v1.1.0 | Change |
|---|---|---|---|
| Cold start, serviceable (/healthz responds) | 447 ms | **252 ms** | ↓44% |
| Full history ready | 447 ms | **379 ms** | ↓15% |
| Full history ready (snapshot hit) | — | **227 ms** | ↓49% |
| Resident memory after loading 200k records | 204 MB | **56 MB** | ↓73% |
| `/api/stats` average latency | 73.65 ms | **0.45 ms** | ↓99% (163×) |
| `/api/stats` 50 concurrent total | 3665 ms | **15 ms** | ↓99.6% |
| 300-concurrent throughput | 1277 req/s | **1456 req/s** | ↑14% |
| 300-concurrent p95 latency | 224 ms | **199 ms** | ↓11% |
| Memory after concurrency benchmark | 142 MB | **66 MB** | ↓54% |

Optimizations (by target):

**Cold start**
1. Listen first, load history in the background — the old version had to parse the entire log before accepting connections; the new one serves immediately and fills in stats afterwards.
2. Aggregate snapshot `aggregate.json` (with the consumed byte offset): restarts read the snapshot and replay only the tail; a truncated/cleared log falls back to a full rebuild. Since v1.5.5 only v3+ snapshots (which include `byProvider`) are trusted; legacy snapshots trigger a one-time full rebuild on first start.
3. **Worker-thread parallel replay**: the log is split into N segments on line boundaries (default `min(CPU-1, 4)` threads), aggregated in parallel, then merged; parallel and sequential replay results match field by field (`npm run test:parity`), and any worker failure falls back to single-threaded replay.
4. Replay slices by lines and periodically yields the event loop, so in-flight request latency is unaffected during loading; day-key memoization avoids repeated `Date` construction.

**Memory**
1. Incremental aggregation (`Map` buckets) replaces the "full record array" — memory drops from O(records) to O(buckets).
2. Recent requests use a **fixed-length ring buffer** (200 by default), eliminating `Array.shift` and other O(n) operations.
3. Request bodies over `MAX_INJECT_BYTES` (1 MB by default) are streamed straight through — no in-memory injection/parsing.
4. SSE scan buffer capped at 8 KB; log writes use a fixed-length backpressure queue; RSS above the soft limit trims buffers and persists a snapshot.

**Concurrency**
1. `/api/stats` reads the in-memory aggregate directly (O(buckets)); the old version scanned all history on every call (200k records ≈ 74 ms of CPU, with concurrent polls fighting over the event loop).
2. Upstream keepAlive connection pool + `maxSockets` cap keeps sockets and file descriptors under control under load.
3. `JSON.parse` runs only on SSE frames that likely contain `usage` (long streaming chats skip over 99% of parsing).
4. Non-streaming requests skip request-body JSON parsing (the model name is taken from the response body/SSE frame when possible); non-JSON responses are piped zero-copy.

## Per-Agent Configuration

| Agent | Where | Base URL |
|---|---|---|
| **ZCode** | Settings → Model Service / Custom Model (OpenAI-compatible) | `http://127.0.0.1:8787/v1` |
| Cline / Roo Code (VS Code) | Settings → API Provider → OpenAI Compatible → Base URL | same |
| Continue (VS Code/JetBrains) | `apiBase` of the `openai` provider in `config.yaml` | same |
| Cursor | Models → OpenAI API Key → Override Base URL | same |
| Cherry Studio / ChatBox / LobeChat / Open WebUI | Model Service → Custom Provider → API URL | same |
| Dify / FastGPT | Model Provider → OpenAI-API-compatible → API Base | same |
| LangChain / LiteLLM / openai SDK | `OPENAI_BASE_URL` / the `base_url` argument | same |
| curl / scripts | `curl http://127.0.0.1:8787/v1/chat/completions ...` | same |

> General rule: replace `https://api.stepfun.com` with `http://127.0.0.1:8787` in the client; the `/v1/...` paths and the key stay unchanged.
> Clients can set the name shown in the dashboard via the `X-Agent: <name>` header; otherwise it is detected from the User-Agent.
> To use a different provider (GLM / DeepSeek / Kimi, …), switch the active provider with one click in the dashboard top bar, or route per request with the `/p/<key>/v1/...` path prefix or the `X-Provider` header — see "Multi-Provider Support".

## MCP Integration (ZCode / Claude Code, conversational queries)

Add the following to the agent's MCP configuration (e.g. ZCode's `mcp.json`; the npx direct-load form is recommended):

```json
{
  "mcpServers": {
    "stepfun-usage": {
      "command": "npx",
      "args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]
    }
  }
}
```

Manual-install equivalent: `"command": "node", "args": ["<absolute path>\\mcp-server.mjs"]`.

Then simply ask in chat: "Show my StepFun token usage for the last 7 days, grouped by model" — the agent calls the `query_stepfun_usage(days=7, group="model")` tool and returns the statistics. Since v1.5.5, `group` also accepts `"provider"` (grouped by provider). Since v1.5.9 the agent can also call `open_monitor_panel(mode="panel"|"full")` to raise the bottom-docked popup or the standalone browser full page directly (the proxy starts automatically when not running).

## Environment Variables (all optional)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | Proxy listen port |
| `TARGET_URL` | `https://api.stepfun.com` | Overrides the StepFun provider's baseUrl only (legacy usage); configure other providers in `providers.json` |
| `DATA_DIR` | resolved by `lib/paths.mjs` | Local data directory: explicit value wins; npx direct load defaults to `~/.stepfun-usage-monitor/`; manual installs reuse `data/` when `data/usage.jsonl` exists. `providers.json` lives here too |
| `STEPFUN_API_KEY` | none | Injects the StepFun key when the client sends no Authorization header |
| `GLM_API_KEY` / `BIGMODEL_API_KEY` | none | Zhipu GLM key (either works) |
| `DEEPSEEK_API_KEY` | none | DeepSeek key |
| `MOONSHOT_API_KEY` / `KIMI_API_KEY` | none | Kimi Moonshot key (either works) |
| `MINIMAX_API_KEY` | none | MiniMax key |
| `DASHSCOPE_API_KEY` | none | Qwen (DashScope) key |
| `YI_API_KEY` / `LINGYIWANWU_API_KEY` | none | Yi (01.AI) key (either works) |
| `DISABLE_USAGE_INJECT` | unset | Set to `1` to disable automatic `stream_options.include_usage` injection for streaming requests |
| `SNAPSHOT_MS` | `20000` | Aggregate snapshot persistence interval (ms); plus ≥3s throttled writes and an immediate write when loading completes |
| `DISABLE_SNAPSHOT` | unset | Set to `1` to disable snapshots entirely (full replay on every start) |
| `REPLAY_WORKERS` | `min(CPU-1, 4)` | Parallel replay threads; `0` = single-threaded. Data < 4 MB automatically runs single-threaded |
| `RECENT_MAX` | `200` | Recent-request ring buffer size (memory cap) |
| `MAX_SOCKETS` | `256` | Upstream keepAlive pool concurrency cap |
| `MAX_INJECT_BYTES` | `1048576` | Request bodies above this size skip injection/parsing and are streamed straight through |
| `MEMORY_SOFT_LIMIT_MB` | `384` | RSS soft limit; above it the recent-request buffer is trimmed and a snapshot persisted |

> Note: StepFun follows the OpenAI spec, where streaming responses **do not** return usage unless the request carries `stream_options.include_usage=true`. The proxy injects that field automatically for streaming requests (no billing impact); if an upstream rejects it with 400, the proxy retries with the original body.
> Key injection priority: `apiKey` in `providers.json` > the environment variables above; if the client sends its own `Authorization`, the client's value wins.

## Data and Privacy

- Data file: `<data directory>/usage.jsonl`, one record per line, example fields:

  ```json
  {"ts":"2026-09-22T00:30:12.345Z","agent":"ZCode/Zhipu","provider":"stepfun","path":"/v1/chat/completions","model":"step-2-16k","status":200,"prompt_tokens":120,"completion_tokens":80,"total_tokens":200,"latency_ms":812}
  ```

- **Never recorded**: request/response bodies, Authorization headers, API keys. Only timestamp, client, provider, model, token counts, status code and latency.
- `aggregate.json`: aggregate snapshot (statistics + consumed byte offset) used to speed up cold starts; deleting it triggers an automatic full rebuild. Legacy snapshots from v1.5.0 and earlier are rebuilt automatically since they lack per-provider data.
- Backup: copy the data directory. Clear: `POST http://127.0.0.1:8787/api/clear`.

## Local API Reference

| Endpoint | Description |
|---|---|
| `GET /` | Dashboard full page (daily bar chart, model/client/provider rankings, recent requests, memory/sockets) |
| `GET /?layout=window` | Small-window layout (KPIs + chart) |
| `GET /?layout=panel` | Bottom-bar layout (ultra-compact KPIs on the lite payload) |
| `GET /` in the dashboard | Pelican test one-click copy: click the hint button or the prompt text to copy the test prompt (desktop and mobile) |
| `GET /api/stats?days=30` | JSON aggregate stats (reads the in-memory aggregate, O(buckets); includes the `byProvider` breakdown and current-provider info) |
| `GET /api/stats?days=14&lite=1` | **Slim payload**: 5 models / 5 clients / 6 recent entries, max 14 days (used by Lite mode and the bottom-bar layout) |
| `GET /api/providers` | Provider list (key/name/baseUrl/built-in/has-key; **never includes any key**) |
| `POST /api/provider` | Switch the active provider, body `{"key":"deepseek"}`; an unknown key returns 400 + the valid list |
| `GET /api/logs?limit=500` | Recent requests (ring buffer, at most `RECENT_MAX` entries) |
| `GET /healthz` | Health check (with a `loading` flag and the active provider; useful for waiting until history is loaded) |
| `POST /api/snapshot` | Flush logs and persist the aggregate snapshot immediately |
| `POST /api/clear` | Clear local data (raw log + snapshot + in-memory aggregate) |

## File Structure

```
stepfun-usage-monitor/
├─ proxy.mjs           Core: local reverse proxy + usage parsing + incremental aggregation + snapshots + dashboard serving (zero dependencies)
├─ bin/cli.mjs         Unified CLI entry: proxy mode by default / --mcp mode (npx direct-load entry)
├─ lib/paths.mjs       Data-directory resolution (unified rules for npx direct load / manual install)
├─ lib/providers.mjs   Multi-provider registry and four-level routing (v1.5.5)
├─ lib/replay-worker.mjs  History parallel-replay worker (worker_threads)
├─ lib/open-panel.mjs  Docked-popup / standalone-browser launcher (v1.5.9; shared by the MCP open_monitor_panel tool and --panel)
├─ dashboard.html      Dashboard page (fully local, no CDN links; ?layout= three layouts + provider switcher + bottom-bar "Full Display" button)
├─ mcp-server.mjs      MCP server: conversational usage queries + docked-popup raising for agents (v1.5.9)
├─ stats.mjs           Terminal report: node stats.mjs [days]
├─ start.cmd           One-click start (double-click on Windows)
├─ open-window.cmd     Small-window launcher (borderless Chrome/Edge --app window)
├─ open-panel.cmd      Bottom-bar launcher
├─ marketplace.json    ZCode plugin marketplace manifest (v1.5.9)
├─ plugins/stepfun-usage-monitor/   Official ZCode plugin directory (v1.5.9)
│  ├─ .zcode-plugin/plugin.json  plugin manifest (name/version/commands/mcpServers…)
│  ├─ commands/sfm.md            standard command (/sfm: query usage + raise the docked popup)
│  └─ .mcp.json                  stdio MCP server definition (${CLAUDE_PLUGIN_ROOT})
├─ ide-extension/      VS Code-family extension (bottom bar / window / browser + status bar)
│  ├─ package.json / extension.js / media/chart.svg
│  ├─ test/build-vsix.mjs builds it → dist/stepfun-monitor-1.5.9.vsix
│  └─ dist/stepfun-monitor-1.5.9.vsix  installable as-is
├─ docs/releases/      Bilingual release notes per version (Chinese + English)
├─ data/usage.jsonl    Usage details (append-only, created on first run; default location for manual installs)
├─ data/aggregate.json Aggregate snapshot (auto-generated, deletable)
├─ data/providers.json Provider configuration (optional; under ~/.stepfun-usage-monitor/ for npx direct loads)
├─ demo-data/          Demo data (generated by `npm run seed`, for dashboard preview only, safe to delete)
└─ test/               Test / benchmark scripts
   ├─ run-e2e.mjs          End-to-end tests (mock upstream + streaming/non-streaming/fallback cases)
   ├─ mock-upstream.mjs    Mock StepFun upstream (MOCK_DELAY simulates inference latency)
   ├─ mcp-test.mjs         MCP protocol conformance tests
   ├─ verify-ui.mjs        Dashboard / CLI report checks
   ├─ ui-perf-check.mjs    v1.4.0 interaction performance / 3 performance modes: static assertions + payload measurements
   ├─ ui-feature-check.mjs v1.3.0 Pelican-test one-click copy: static assertions
   ├─ v15-check.mjs        v1.5.9 multi-provider/direct-load/layouts/extension/data-directory/ZCode-plugin-structure/docked-popup assertions (static + runtime)
   ├─ npm-pack-check.mjs   v1.5.0 npx direct-load chain verification (npm pack → install → dual-mode run, 15 items)
   ├─ build-vsix.mjs       Zero-dependency VSIX build (ZIP writing + CRC32 + read-back self-verification)
   ├─ browser-smoke.mjs    Real-browser runtime checks (CDP-driven local Chrome/Edge; three layouts, three modes, provider switcher, bottom-bar Full Display button)
   ├─ replay-parity.mjs    Parallel vs sequential replay consistency check
   ├─ bench.mjs            Performance benchmark (cold start / memory / concurrency, writes bench-result.txt)
   ├─ seed-demo.mjs        Generate demo data
   └─ cleanup.mjs          Clean up test leftovers
```

## Tests and Verification

```bat
node test/run-e2e.mjs                 :: end-to-end: streaming/non-streaming usage parsing, stream_options injection and fallback, keys never stored
node test/mcp-test.mjs                :: MCP: initialize / tools/list / tools/call / unknown-method error codes
node test/verify-ui.mjs               :: dashboard accessibility and CLI report format
node test/ui-perf-check.mjs           :: 3 performance modes, wait animations, lite slim payload assertions
node test/ui-feature-check.mjs        :: Pelican-test one-click copy static assertions
node test/v15-check.mjs               :: v1.5.9: multi-provider routing/switching/byProvider, GitHub direct load, three layouts, ZCode plugin structure, docked popup, extension, data directory (static + runtime)
node test/npm-pack-check.mjs          :: v1.5.0: npm pack → tarball install → bin dual-mode real run (15 items)
node test/build-vsix.mjs              :: build the VSIX (ide-extension/dist/)
node test/browser-smoke.mjs           :: real-browser runtime checks incl. three layouts, three modes and the provider switcher (needs local Chrome or Edge)
node test/replay-parity.mjs           :: parallel vs sequential replay: field-by-field aggregate consistency (run bench first)
node test/bench.mjs                   :: performance benchmark (generates 200k records, writes test/bench-result.txt)
node test/seed-demo.mjs demo-data     :: regenerate demo data
```

Preview the dashboard with demo data (does not affect real records):

```bat
set PORT=8787 && set DATA_DIR=demo-data && node proxy.mjs
```

## FAQ

- **Want the agent to show usage at the bottom of the screen (v1.5.9)**: install the stepfun-usage-monitor plugin from the ZCode marketplace and type `/sfm` (or tell the agent "open the usage monitor popup") to raise the docked popup; click "⤢ Full Display" inside it for the full dashboard. CLI equivalent: `node bin/cli.mjs --panel [full]`.
- **Port already in use**: set `PORT=8788`, restart, and update the client's Base URL accordingly.
- **Streaming chats show no tokens**: make sure `DISABLE_USAGE_INJECT=1` is not set; some very old clients strip `stream_options` themselves — enable a "track usage/usage" style option in the client if available.
- **Want to track other providers (GLM / DeepSeek / Kimi…) too**: no second instance needed — switch the active provider with one click in the dashboard top bar; or route per request with the `/p/<key>/v1/...` path prefix or the `X-Provider: <key>` header; custom gateways can be added in `providers.json`. See "Multi-Provider Support".
- **Do not run multiple instances against the same data directory**: the snapshot's byte offset assumes a single writer; use a different `DATA_DIR` per instance.
- **Where do npx direct load and manual install keep data**: npx direct load defaults to `~/.stepfun-usage-monitor/`; manual installs reuse the repo's `data/` (when history exists). When mixing the two, set `DATA_DIR` explicitly to unify them.
- **A hard exit (closing the window) can lose the last few seconds of detail**: snapshots persist at ≥3s intervals, so a restart only replays a very short tail; a normal shutdown (Ctrl+C) persists immediately.
- **The provider usage table is empty after upgrading from v1.5.0**: legacy snapshots contain no per-provider data, so the first start performs an automatic full replay rebuild (one-time); afterwards the fast path resumes.
- **Want it faster with a huge history**: raise `REPLAY_WORKERS` (default 4); or keep `aggregate.json` so the next start takes the snapshot path.
- **Performance**: with 200k history records, resident memory is ~56 MB, `/api/stats` ~0.45 ms, 300-concurrent throughput ~1456 req/s; per-request overhead < 1 ms (excluding network). See `npm run bench` output for details.
