<img src="assets/icon.png" align="right" width="96" alt="zcode-tps-monitor icon">

# stepfun-usage-monitor — ZCode Token Rate Monitor (zcode-tps-monitor)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

**V2.4.0**: this repository is no longer the v1.x "StepFun API token-usage local proxy"; it is the **ZCode session-level token rate monitor** rebuilt after [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor): at the end of every reply it automatically shows the **instant tok/s of the current turn** — read directly from the ZCode usage database, not model self-reporting, not estimation. It also ships a real-time dashboard, slash commands, MCP tools, and optional business-TPS monitoring. V2.1.0 adds **appearance customization** (theme / fonts / font size / accent color) and a **liquid-glass** dashboard; V2.2.0 delivers the **performance pass** — the dashboard moves to SSE real-time push (idle means zero polling, heartbeats only), canvas dirty-flag redraw, prepared statements with suggested-index self-checks, and hook read-timing diagnostics; V2.3.0 adds the **Electron desktop client** (optional standalone distribution) — dashboard main window, transparent always-on-top overlay, tray, autostart and auto-update, packaged for three platforms; V2.4.0 adds **multi-agent data sources** — Claude Code, Codex, OpenCode and Cline local session usage behind one unified Provider interface, aggregated alongside ZCode's own (ZCode only by default, behaving exactly as V2.3.0). **Zero npm dependencies in the plugin itself, pure Node, all data stays local.**

> **Upgrading from v1.x**: v1.x (≤ 1.5.11) counted API usage through a local reverse proxy and required pointing your client's Base URL at `127.0.0.1:8787`. V2.0.0 drops the proxy architecture and reads ZCode's own usage database directly — **no client configuration changes, install and go**. The v1.x code remains in git history (tag `v1.5.10` and earlier commits).

> **[中文 README](README.md)** · This is the English version.

This repository doubles as a ZCode local plugin marketplace (marketplace name: `tps-local-marketplace`); the plugin itself lives in [`plugins/zcode-tps-monitor/`](plugins/zcode-tps-monitor/README.md). Full bilingual release notes are in [`docs/releases/`](docs/releases/).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  ZCode client                                                │
│                                                              │
│  SessionStart hook ──▶ record session ID + usage hint         │
│  UserPromptSubmit hook ─▶ read usage DB, inject prev-turn rate│
│  Stop hook ──▶ scope the turn by turn_id, compute rate        │
│                    │                                         │
│                    ▼  rendered directly via systemMessage     │
│         「537.3 tok/s · TTFT 3.0s · output 223 tok …」         │
└───────────────────────┬──────────────────────────────────────┘
                        │ read-only
                        ▼
              ~/.zcode/cli/db/db.sqlite (model_usage table)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  /tps · /tps-doctor   Live dashboard   MCP tools
  (slash commands)   dashboard/       tps_snapshot
                     server.mjs       tps_watch
```

- **Real data**: the token rate comes entirely from real token accumulations in the ZCode usage database (output-side counting, including thinking tokens) — no model relay, no estimation.
- **Zero dependencies**: Node built-ins only (`node:sqlite` / `node:http`); each hook run is a single millisecond-scale database read.
- **Fully local**: no network, no uploads, no resident background process (the dashboard auto-exits after 3 idle hours).

## Features

- **Instant current-turn rate line (on by default)** — the moment a reply ends (Stop hook), one line is shown automatically: instant tok/s for the turn, time to first token (TTFT), output tokens, pure generation time, request segments / per-segment peak, recent sliding average, session cumulative output, and sampling time. Multi-segment turns (tool calls) are weighted by "total output / total pure generation time", excluding inter-segment tool waits.
- **Real-time dashboard** — `/dashboard` opens a dark ops-style browser panel driven by **SSE real-time push** instead of interval polling: it refreshes the moment a new sample arrives, and while idle the channel carries heartbeats only. Auto-exits after 3 idle hours, leaving no background process. Liquid-glass surfaces by default, fully disableable.
- **Appearance customization** — theme (dark / light / follow system), UI and numeric fonts, base font size, overall scale, accent color, and glass intensity are all configurable; the "⚙ Appearance" drawer in the dashboard header saves and applies instantly, and the same config also drives the Windows overlay and the Electron client.
- **Slash commands** — `/tps` for an instant snapshot; `/tps 10` to sample for 10 seconds (2–30); `/tps-doctor` for environment self-checks.
- **MCP tools** — `tps_snapshot` / `tps_watch` for programmatic access by agents.
- **Desktop overlay (Windows)** — `overlay.ps1` keeps the current rate visible as a resident text overlay (the lightweight alternative when Electron is unavailable; Windows-only, maintained without new features).
- **Electron desktop client (optional, V2.3.0)** — cross-platform (Windows / macOS / Linux) desktop form factor: dashboard main window, transparent always-on-top overlay, tray, autostart and auto-update; it shares the same page and config as the browser dashboard.
- **Multi-agent data sources (V2.4.0)** — the same "instant tok/s of this turn" measure now covers the local session data of Claude Code, Codex, OpenCode and Cline, aggregated alongside ZCode's own; the default still reads ZCode only and matches V2.3.0 exactly.
- **Business TPS monitoring (optional)** — configure `metrics_url` to point at a real metrics endpoint (field names auto-matched across up to three nesting levels); built-in demo data is used when unconfigured. Independent of the token rate.
- **Low overhead** — hooks run one read-only connection with prepared statements (50ms per-read budget, over-budget reads reported by `/tps-doctor`); the canvas redraws only on a new sample or a window resize; DOM values are written only when they change; the overlay polls every 2s and skips updates when nothing changed.

## Real-time push and performance

Both the dashboard and the overlay are data-driven rather than time-driven:

- **SSE push**: `GET /api/events` (`text/event-stream`, pure `node:http`). On connect the server pushes one full `snapshot`, then increments only — `token` (new rate sample), `history-append` (history increment), `sys` (system metrics, every 5s); a heartbeat comment line every 15s. Disconnects auto-reconnect per `retry: 2000` and receive a fresh full snapshot.
- **Zero idle polling**: with no data changes the channel carries heartbeat comment lines only (zero data payload) and the page issues no periodic request at all; `setInterval` is kept for the clock.
- **One tick, many consumers**: the server's single 1s collection tick reads the database once and fans out to every SSE client; CPU percentage sampling (which sleeps 250ms internally) is cached in a 5s window.
- **REST endpoints preserved**: `/api/token-rate` and `/api/metrics` behave as before for third parties and for browsers without EventSource (which fall back to polling).
- **Hook read-timing diagnostics**: each hook's single DB read is timed into a local `~/.zcode/tps-monitor.perf.log`; `/tps-doctor` (`--json`) surfaces the last duration, P50/P95/max, over-50ms-budget counts, and full-scan hints in its `perf` section.

| Metric | Value |
|---|---|
| Periodic polling requests on an idle dashboard | 0 (15s heartbeat comment lines only) |
| Steady-state increment packet size | < 1KB |
| `queryTurn` on a 20,000-row usage DB | P95 ≈ 5ms (budget 50ms) |
| Suggested-index effect | Full scans 6 → 0 |
| SSE system-metrics cadence | 5s |
| Overlay poll interval | 2s |

Suggested indexes (run at your discretion when the usage DB is large and doctor reports full scans; the plugin connects read-only and never creates indexes on the client's behalf):

```sql
CREATE INDEX IF NOT EXISTS idx_model_usage_session_completed ON model_usage(session_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_status_completed ON model_usage(status, completed_at DESC);
```

## Preview

One line of rate metrics is shown automatically when each reply ends — no manual action needed:

![token rate line effect](plugins/zcode-tps-monitor/docs/effect-token-rate.png)

| Field | Meaning |
|---|---|
| `537.3 tok/s` | Instant output rate for the turn (incl. thinking tokens; weighted for multi-segment turns) |
| `TTFT 3.0s` | Time to first token (first segment of the turn) |
| `output 223 tok / gen 0.4s` | Output tokens and pure generation time (excluding inter-segment tool waits) |
| `2 seg / peak 537.3` | Request segments in the turn and per-segment peak rate (multi-segment turns only) |
| `avg3 494.9` | Sliding average of the last few turns |
| `total 51.3k tok` | Cumulative output of the current session (independent counter) |
| `⏱ 10:23:04` | Sampling moment (reply end time) |

Number formatting: per-turn "output" uses exact thousands-separated numbers (e.g. `2,762 tok`); "total" uses compact units — raw below 1k, one decimal for 1k–10k (`9.8k`), rounded for 10k–1M (`51k`), one decimal M above 1M (`73.8M`).

## Multi-agent support (V2.4.0)

Besides ZCode itself, the plugin can read the local usage data of other client tools. The approach is not a bespoke statistic per tool: "read the ZCode usage DB" is first abstracted into a unified **Provider interface**, and each client's data source is then implemented behind that interface. The aggregation layer only ever sees normalized records, so upstream field-name differences (`output_tokens` / `outputTokens` / `tokensOut` / `completion_tokens`…) are contained inside each Provider.

**The default behaviour is exactly V2.3.0**: with no configuration, `providers` is `["zcode"]` and the rate line, `/tps`, the dashboard and MCP all read only ZCode's usage DB — literally the V2.3.0 code path, with one extra `provider` field on the result. Multi-agent support has to be turned on explicitly.

### Sources and measurement definitions

| ID | Client | Data location (default) | Format | Rate | TTFT | Session scope |
|---|---|---|---|---|---|---|
| `zcode` | ZCode | `~/.zcode/cli/db/db.sqlite` · `model_usage` table | sqlite | ✅ | ✅ | ✅ |
| `claude-code` | Claude Code | `~/.claude/projects/**/*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `codex` | Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `opencode` | OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | json | ✅ | ❌ | ✅ |
| `cline` | Cline | `<editor globalStorage>/…/tasks/*/api_conversation_history.json` | json | ✅ | ❌ | ✅ |

- Each source's data root can be overridden by environment variable: `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME`; `ZCODE_USAGE_DB` keeps its existing meaning. Defaults are each client's official location.
- **Capability degradation**: none of the four third-party clients record a first-token timestamp, so their TTFT renders as `-` (`ttftMs` is `null`). **An inter-request gap is never passed off as a first-token delay.**
- **Generation time is not defined uniformly across sources and is not comparable across them**:

  | Source | Definition | Notes |
  |---|---|---|
  | `zcode` | `completed_at - first_token_at` | Measured |
  | `claude-code` | Gap to the previous request | Gaps over 120s are treated as human thinking time and rejected |
  | `codex` | Interval between `token_count` events | Older builds report cumulative totals only; deltas are derived, with reset detection |
  | `opencode` | Client-recorded `created` / `completed` | The closest to a real measurement |
  | `cline` | Gap to the previous entry | Compared against any entry, not only ones carrying usage |

- Aggregation follows the same convention as single-source: the window rate is "total output / total pure generation time" over valid samples, window and cumulative statistics sum across sources, and simultaneous records are ordered by declaration order in `providers` so results are reproducible.

### Turning it on

Add a `providers` field to `~/.zcode/tps-monitor.config.json` (**additive only** — an old config without it behaves exactly as before):

```json
{
  "providers": ["zcode", "claude-code", "codex", "opencode", "cline"]
}
```

| Value | Meaning |
|---|---|
| absent / `["zcode"]` | ZCode only, byte-identical to V2.3.0 (default) |
| `["claude-code"]` | Claude Code sessions only |
| `["zcode", "codex"]` | Two sources aggregated, merged by completion time |
| all five | Everything; clients that aren't installed are skipped without being read |

Unknown ids are dropped during normalization with a fallback to the default, so a typo can't stop the plugin from starting. The `TPS_PROVIDERS` environment variable (comma-separated) overrides the list at a lower priority than the config file.

### Commands and interfaces

| Usage | Description |
|---|---|
| `node scripts/token-rate.mjs --agents` | Lists every source's probe result, data format, session count and sample count (`--json` for programmatic use) |
| `node scripts/token-rate.mjs --agent claude-code` | A single source only; fields degrade when TTFT is unavailable |
| `node scripts/token-rate.mjs --session <id>` | One session only (takes priority over `ZCODE_SESSION_ID`) |
| `/tps-doctor` | The "数据源(多 agent)" check reports available / unavailable + reason + data format + sample count per source |
| MCP `tps_snapshot` / `tps_watch` | Return structures are **additive only**: new `provider` and `sessionId`, plus `sources` / `agents` detail when multiple sources are enabled |
| Dashboard `/api/config` | Gains read/write for `providers` (independent of `appearance`); the SSE `token` payload carries `provider` |

### Compliance notes

- The plugin core (hooks / scripts / mcp / commands / dashboard) keeps **zero npm dependencies**; every Provider is pure Node (`node:fs` / `node:path` / `node:os` / `node:sqlite`), requiring Node ≥ 22.5.
- **Local files only: no network, no telemetry, nothing reported anywhere.** No client's data directory is ever written to, and the usage DB is connected read-only.
- **Fault isolation**: if one source's data is corrupt or its format changes, only that source is affected (a failure reason is recorded in `sources`) — the other sources keep reporting and the rest of the plugin is unaffected. JSONL parsing has per-line fault isolation and a 20,000-record cap, so a bad line only skips itself.
- **The hook hot path never reads JSONL**: the Stop and prompt-submit hooks always talk to the zcode usage DB directly and never go through the aggregation layer — JSONL can reach tens of megabytes, and parsing it would blow the 50ms budget. So even with all five sources configured, hook output is byte-identical to a zcode-only setup.
- The multi-agent aggregation UI is V2.5.0's scope; this release delivers the data and command layers only.

## Installation (three ways, pick one)

Requires **Node.js ≥ 22.5** (for the built-in `node:sqlite`; same on Windows / macOS / Linux).

### Option 1: add the marketplace from GitHub (recommended)

In ZCode, run:

```text
/plugin marketplace add Neriah-Ado/stepfun-usage-monitor
/plugin install zcode-tps-monitor@tps-local-marketplace
```

After installing, **restart the session** so the hooks re-register; every reply then ends with the rate line.

### Option 2: local directory

Clone this repository, then in ZCode open **Settings → Plugin Management → Discover → +**, choose "Local directory" as the source, and point it at the repository root.

### Option 3: scripts / dashboard only (no plugin install)

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor/plugins/zcode-tps-monitor

node scripts/token-rate.mjs            # current rate (human-readable)
node scripts/token-rate.mjs --turn     # instant rate of the just-finished turn
node scripts/token-rate.mjs --json     # JSON output
node scripts/doctor.mjs                # environment self-check
node dashboard/server.mjs              # live dashboard (default 127.0.0.1:7423)
```

### Updating

```text
/plugin marketplace update tps-local-marketplace
```

Reinstall/upgrade the plugin afterwards and restart the session so the hooks re-register.

## Desktop client (Electron, optional)

Alongside the plugin, this repository ships an **optional Electron desktop client**. It reuses the plugin's collection core, dashboard server and the same appearance config, and adds a resident desktop form factor. It is an **independent distribution artifact and is not part of the plugin marketplace** — installing it or not changes nothing about the plugin itself.

**Development run** (needs Node ≥ 22.5 and npm):

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor
npm install
npm run dev            # start Electron (the first run downloads the Electron binary)
```

**Installers** (download from the repository's Releases page, or build locally):

```bash
npm run icons          # regenerate icons (pure Node, no image-processing dependency)
npm run dist:win       # Windows: NSIS installer (x64/arm64) + portable (x64)
npm run dist:mac       # macOS: dmg (x64/arm64)
npm run dist:linux     # Linux: AppImage (x64/arm64)
```

Pushing a `v*` tag makes `.github/workflows/release.yml` run the full unit-test suite and then build all three platforms, uploading the artifacts as GitHub Release assets; the client checks for updates through `electron-updater`.

**UI and controls**:

| Element | Behavior |
|---|---|
| Main window | Loads the **same** dashboard page as the browser; size / position / always-on-top are remembered; **close = minimize to tray**, the process stays alive |
| Header "📌" | Toggle main-window always-on-top |
| Header "▣" | Show / hide the overlay |
| Overlay | Transparent frameless always-on-top window showing the current tok/s; the whole strip is draggable; hovering expands TTFT / N-sample average / cumulative tokens plus a mini curve |
| Overlay "📌" | Click-through toggle: with it on, clicks fall through to the window below while hover-expand keeps working |
| Tray menu | Show/hide overlay, open dashboard, main window on top, overlay click-through, open at login, quit |

**Config interop**: the desktop client and the browser dashboard read and write the **same** `appearance` section of `~/.zcode/tps-monitor.config.json` — change the appearance on either side and the other picks it up on restart. Desktop-only state (window bounds, overlay visibility and toggles, autostart) lives in a separate `~/.zcode/tps-monitor.desktop.json` and never pollutes the plugin config; a corrupt or out-of-range file falls back to defaults.

> **Size note**: the install bundles the full Electron runtime and lands in the hundreds of MB (an NSIS installer or portable build is typically in the 80–100 MB range, with dmg / AppImage comparable or slightly larger; see the Release assets for exact figures). If all you want is a Windows overlay and you would rather not install Electron, `dashboard/overlay.ps1` remains a zero-install single-file option.

> **Dependency isolation**: `electron` / `electron-builder` / `electron-updater` all live in the **workspace-level root `package.json`**, and every Electron line lives under `electron/`. The plugin directory (hooks / scripts / mcp / commands / dashboard) keeps zero npm dependencies and unchanged behavior — `node --test` carries a dedicated assertion guarding exactly that.

## Usage

| Scenario | Action |
|---|---|
| Per-turn rate | Nothing to do — shown automatically when each reply ends |
| Instant snapshot | Type `/tps`; or `/tps 10` to sample for 10 seconds |
| Open the dashboard | Type `/dashboard`, or run `node dashboard/server.mjs` |
| Environment self-check | Rate line missing? Type `/tps-doctor` |
| Other clients' data | `/tps` already aggregates whatever `providers` lists; from the CLI, `--agent claude-code` reads one source, `--agents` shows every source's probe result |
| Disable the current-turn line | Write `{"stopHookLine": false}` to `~/.zcode/tps-monitor.config.json`, restart the session |
| Disable all rate injection | Write `{"tokenRateLine": false}` to the same file, restart the session |
| Change the dashboard appearance | The "⚙ Appearance" drawer in the dashboard header; or edit the `appearance` section of the config file (see below) |
| Desktop overlay | Run `dashboard/overlay.ps1` (Windows); for cross-platform use the Electron desktop client (see above) |
| Programmatic access | MCP tools `tps_snapshot` / `tps_watch` |

Plugin-prefixed equivalents: `/zcode-tps-monitor:tps`, `/zcode-tps-monitor:tps-doctor`, `/zcode-tps-monitor:dashboard`.

## Configuration

### Business TPS (optional)

Demo data is used by default; to monitor real business throughput, configure `metrics_url` under **Settings → Plugin Management → zcode-tps-monitor**, pointing at any endpoint that returns JSON. Field names are auto-matched (up to three nesting levels):

| Metric | Recognized field names |
|---|---|
| Throughput | `tps` / `qps` / `throughput` / `transactionsPerSecond` |
| Latency | `p50` / `p95` / `p99` (or `latency_p50`, etc.) |
| Error rate | `error_rate` / `errorRate` / `err_rate` |

Example response:

```json
{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}
```

> Note: when `metrics_url` is unset, the plugin's MCP server may fail to start in some clients because the manifest variable cannot be expanded (surfacing as `plugin_variable_missing: metrics_url` from `plugins validate`). Putting any value (even an empty string) in the plugin settings is enough; hooks, commands and the skill are unaffected.

### Appearance customization (dashboard / overlay)

A new `appearance` section lives in `~/.zcode/tps-monitor.config.json` (alongside `stopHookLine`, **additive only** — an old config without it behaves exactly as before):

```json
{
  "appearance": {
    "theme": "dark",
    "fontFamily": "Segoe UI, Microsoft YaHei, system-ui, sans-serif",
    "monoFont": "Cascadia Mono, Consolas, monospace",
    "fontSize": 16,
    "fontScale": 1,
    "accentColor": "#4da3ff",
    "glassIntensity": 0.6,
    "fontUrl": ""
  }
}
```

| Field | Values | Default | Notes |
|---|---|---|---|
| `theme` | `dark` / `light` / `system` | `dark` | `system` follows the OS light/dark preference |
| `fontFamily` | CSS font stack | `Segoe UI, Microsoft YaHei, system-ui, sans-serif` | UI font |
| `monoFont` | CSS font stack | `Cascadia Mono, Consolas, monospace` | Numeric / clock font |
| `fontSize` | 8–24 | `16` | Base font size (px) |
| `fontScale` | 0.8–1.5 | `1` | Overall scale (root font size = fontSize × fontScale) |
| `accentColor` | `#hex` / `rgb(a)` / `hsl(a)` / common name | `#4da3ff` | Accent color (curves, buttons, highlights) |
| `glassIntensity` | 0–1 | `0.6` | Liquid glass strength; `0` disables it and restores solid panels |
| `fontUrl` | `http(s)://` / `file://` | empty | Optional web font; silently falls back to the system font on failure |

- Out-of-range numbers are clamped; illegal values (injection characters, invalid colors / protocols) reject the whole write without touching the stored config; a corrupt config file yields a repair hint instead of a silent overwrite.
- Easier still: adjust and save in the dashboard's "⚙ Appearance" drawer — changes apply immediately.
- The overlay `overlay.ps1` reads the same config (Acrylic is attempted when glass intensity > 0, falling back to the original transparent form on failure); so do the Electron overlay and main window.

### Environment variables and config files

| Item | Description |
|---|---|
| `ZCODE_USAGE_DB` | Override the usage database path (default `~/.zcode/cli/db/db.sqlite`) for non-standard installs |
| `TPS_PROVIDERS` | Override the enabled sources (comma-separated, e.g. `zcode,claude-code`); lower priority than the config file |
| `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME` | Override the corresponding client's data root, defaulting to each client's official location |
| `~/.zcode/tps-monitor.config.json` | Local config: `stopHookLine` (Stop-hook rate line switch), `tokenRateLine` (master rate-injection switch), `providers` (multi-agent sources, see above), `appearance` (dashboard appearance, see above) |
| Dashboard port | `dashboard/server.mjs` listens on `127.0.0.1:7423` by default |

## How it works

```
user sends a message
   │
   ▼
UserPromptSubmit hook
   │  reads the ZCode usage database, injects the previous turn's rate as model context
   ▼
model replies (tool calls × N segments)
   │
   ▼
Stop hook (reply just ended, turn fully recorded)
   │  scopes all requests of the turn by the latest turn_id,
   │  computes the instant rate (total output / total pure generation time)
   ▼
systemMessage renders the turn's rate line directly
```

- **SessionStart hook**: records the current session ID and injects a usage hint.
- **UserPromptSubmit hook**: runs once per turn with a millisecond-scale database read; the current turn hasn't happened yet, so only the previous turn's data is injected as pure model context (never to be quoted back).
- **Stop hook**: fires the instant the reply ends and the turn's data is fully recorded, scoping the turn precisely by `turn_id` (all requests triggered by one user message, including multi-segment tool calls), rendered directly by the client via `systemMessage` — no model relay, zero lag by construction.
- Token rate and business TPS are independent: the former always comes from real data, the latter depends on whether `metrics_url` is configured.
- **Source selection happens only off the hook path**: the hooks always read the ZCode usage DB (keeping JSONL out of the hot path), while `/tps`, the dashboard, Electron and MCP go through the aggregation layer and follow `providers`. With a single `zcode` source they run exactly the V2.3.0 code path.

## Repository layout

```
marketplace.json                      Marketplace manifest (tps-local-marketplace → plugins/zcode-tps-monitor)
package.json                          Electron desktop-client workspace manifest (standalone distribution, not in the marketplace)
electron-builder.yml                  Three-platform packaging config (nsis / dmg / AppImage + GitHub Releases publishing)
.github/workflows/release.yml         Tag-triggered three-platform build pipeline (runs node --test first)
electron/                             Electron desktop client (V2.3.0, isolated from the plugin core)
├─ main.mjs                           Main process: windows / tray / autostart / auto-update / IPC
├─ preload.cjs                        Preload: contextBridge + channel allowlist
├─ renderer/overlay.html              Overlay render layer (transparent / draggable / hover-expand)
├─ lib/                               Pure logic: overlay-payload / collect-loop / state-store
└─ build/make-icons.mjs               Pure-Node ICO / ICNS / PNG icon generation
plugins/zcode-tps-monitor/
├─ .zcode-plugin/plugin.json          Plugin manifest (V2.4.0, incl. userConfig.metrics_url)
├─ .claude-plugin/plugin.json         Claude-compatible manifest (same version)
├─ .mcp.json                          stdio MCP server definition (tps_snapshot / tps_watch)
├─ commands/                          /tps · /tps-doctor · /dashboard
├─ skills/zcode-tps-monitor/SKILL.md  Skill: auto-triggers on rate/TPS questions
├─ hooks/
│  ├─ hooks.json                      SessionStart / UserPromptSubmit / Stop registration
│  ├─ session-start.mjs               Session hint
│  ├─ prompt-submit.mjs               Previous-turn rate as model context
│  └─ stop.mjs                        Current-turn instant rate line
├─ scripts/
│  ├─ collect.mjs                     Business TPS collection (--watch N to sample)
│  ├─ token-rate.mjs                  Token rate CLI (--turn / --json / --agent / --session / --agents)
│  ├─ doctor.mjs                      Environment self-check (--json for programmatic use, incl. perf and multi-agent source sections)
│  ├─ lib/collect-core.mjs            Collection & formatting core (shared by MCP and scripts; aggregateRate/aggregateTurn/agentStatus aggregation layer)
│  ├─ lib/config.mjs                  appearance / providers config read/write & validation (shared by dashboard, doctor and the desktop client)
│  ├─ lib/usage-db.mjs                Usage-DB read-only access layer (prepared statements + index self-check)
│  ├─ lib/perf-log.mjs                Hook read-timing diagnostics (~/.zcode/tps-monitor.perf.log)
│  ├─ lib/providers/                  Multi-agent data sources (V2.4.0, zero-dependency pure Node)
│  │  ├─ index.mjs                    Registry: ids / aliases / capability matrix / normalization / source selection
│  │  ├─ common.mjs                   Normalization and view building (rate formula shared with usage-db)
│  │  ├─ zcode.mjs                    ~/.zcode/cli/db/db.sqlite (V2.3.0 logic migrated verbatim)
│  │  ├─ claude-code.mjs              ~/.claude/projects/**/*.jsonl
│  │  ├─ codex.mjs                    ~/.codex/sessions/ (no TTFT; capability degradation)
│  │  ├─ opencode.mjs                 opencode storage/message local storage
│  │  └─ cline.mjs                    Cline task dir api_conversation_history.json
│  └─ lib/sse.mjs                     SSE wire format (events / heartbeat / retry)
├─ dashboard/
│  ├─ server.mjs                      Live dashboard server (default 127.0.0.1:7423, auto-exits after 3 idle hours; /api/events SSE + /api/config)
│  ├─ server-core.mjs                 Dashboard server factory (reused by the Electron main process on an ephemeral port)
│  ├─ index.html                      Dashboard page (EventSource partial updates + canvas dirty flag + CSS-variable theming + liquid glass + appearance drawer + desktop-only buttons)
│  └─ overlay.ps1                     Windows desktop overlay (2s polling, follows the appearance config; lightweight alternative when Electron is absent)
└─ docs/effect-token-rate.png         Rate-line effect image

test/config.test.mjs                  Appearance config tests (node --test)
test/perf.test.mjs                    Performance regression tests (SSE format / increments / statement reuse / hook timings)
test/providers.test.mjs               Multi-agent Provider tests (per-source fixtures / capability degradation / multi-source merge / corruption isolation / default byte-identity / hooks never read JSONL)
test/desktop.test.mjs                 Electron desktop-client tests (payload semantics / state persistence / collection loop / icon containers / IPC agreement / zero-dependency scan)
test/token-rate.test.mjs              Test suite (node --test)
docs/releases/                        Bilingual release notes per version (Chinese + English)
assets/                               Repository icon (regenerate with node assets/generate-icon.mjs)
```

## Testing and verification

```bash
node --test                                              # test suite (number formatting / turn queries / appearance config / SSE & performance assertions / multi-agent Providers / desktop client, 76 in total)
cd plugins/zcode-tps-monitor && node scripts/doctor.mjs  # environment self-check (--json includes the perf and multi-agent source sections)
```

Manual MCP smoke test (responses are `Content-Length` frames; bare JSON-line requests are also accepted):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/zcode-tps-monitor/mcp/tps-server.mjs
```

## FAQ

**Q: Can I use it in OpenCode / Codex / Claude Code or other tools?**

A: The plugin mechanism and hooks are ZCode-specific, so the rate line only appears inside ZCode sessions. But the **data source is not limited to ZCode**: since V2.4.0 you can add Claude Code, Codex, OpenCode and Cline to `providers`, and `/tps`, the dashboard and MCP will read those clients' local session usage (definitions in the "Multi-agent support" section). When nothing is configured, only ZCode is read and behaviour is exactly as before; the business-TPS collector and dashboard are standalone programs that can run without ZCode.

**Q: Is the displayed rate accurate?**

A: The rate is computed from real token accumulations in the client's usage data, counting model output tokens (including thinking tokens). The line is sampled the instant a reply ends and reflects exactly that turn; multi-segment turns are weighted by "total output / total pure generation time", excluding inter-segment tool waits. ZCode's pure generation time is a measurement; the other clients record no first-token moment, so their durations use estimated definitions that differ per client (see the table in "Multi-agent support") and **are not comparable across sources**. Numbers may also differ slightly from other tools due to different counting windows.

**Q: The rate line suddenly disappeared?**

A: Run `/tps-doctor`. Common causes: Node below 22.5 (needs the built-in `node:sqlite`), a table-structure change after a ZCode update, a session not restarted after a plugin upgrade (hooks register on new sessions), or injection disabled in the config file.

**Q: Does the dashboard poll or push? How much does it cost?**

A: SSE push (`GET /api/events`). While idle the channel carries one heartbeat comment line every 15 seconds and the page issues no periodic request at all; the server's single 1s collection tick reads the database once and fans out to every SSE client. DOM and canvas are updated partially per event type (dirty-flag redraw) only when a new sample arrives, with steady-state increment packets under 1KB. On the hook side each DB read has a 50ms budget, and the timing distribution plus over-budget counts are visible in `/tps-doctor`'s perf section.

**Q: macOS / Linux support?**

A: Yes. Hooks, commands, dashboard and MCP are all cross-platform Node implementations; the usage database path is resolved from the user home directory, and non-standard installs can override it with the `ZCODE_USAGE_DB` environment variable. Two desktop form factors exist: `overlay.ps1` depends on Windows APIs and is Windows-only, while the **Electron desktop client** (V2.3.0) ships installers for all three platforms (NSIS / dmg / AppImage), so macOS and Linux users get the overlay, tray and autostart from it.

**Q: What's the relationship with the v1.x stepfun-usage-monitor?**

A: Two generations of the same repository. v1.x counted LLM API token usage through a local reverse proxy (`127.0.0.1:8787`) and required changing the client Base URL; V2.0.0 is a complete rewrite as a ZCode plugin that reads ZCode's own usage database with no client configuration changes. If you still need the v1.x proxy, the code is in git history (see tag `v1.5.10`).

**Q: How do I turn off the demo data?**

A: Demo data only affects the "business TPS" part (the token rate is always real); leaving `metrics_url` unconfigured is demo mode, and configuring it switches to the real data source automatically.

**Q: I don't like the liquid glass effect / want different fonts?**

A: In the dashboard's "⚙ Appearance" drawer, drag "glass intensity" to 0 to restore solid panels; theme, fonts, font size, scale and accent color all live in the same drawer and apply instantly. You can also edit the `appearance` section of `~/.zcode/tps-monitor.config.json` directly — the same config drives the overlay.

## License

[MIT](LICENSE) © 2026 shy3130 (upstream author) · V2.1.0 appearance & liquid glass, V2.2.0 performance, V2.3.0 Electron desktop client, V2.4.0 multi-agent Provider data layer: Neriah-Ado
