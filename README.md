<img src="assets/icon.png" align="right" width="96" alt="zcode-tps-monitor 图标">

# stepfun-usage-monitor — ZCode Token 速率监控（zcode-tps-monitor）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

**V2.5.0**：本仓库不再是 v1.x 的「StepFun API 用量本地监控代理」，而是参照 [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor) 重写的 **ZCode 会话级 Token 速率监控插件**：每轮回复结束时自动显示**本轮即时** tok/s——数据直接读取 ZCode usage 数据库，非模型自述、非估算；另附实时监控大屏、斜杠命令、MCP 工具与可选的业务 TPS 监控。V2.1.0 新增**外观自定义**（主题 / 字体 / 字号 / 主题色）与**液态玻璃**大屏；V2.2.0 完成**性能优化**——大屏改 SSE 实时推送（空闲零轮询、仅心跳）、canvas 脏标记重绘、查询预编译语句与建议索引自检、钩子耗时诊断；V2.3.0 新增**Electron 桌面客户端**（可选独立分发物）——仪表盘主窗口、透明置顶悬浮条、托盘、开机自启与自动更新，三平台打包；V2.4.0 新增**多 agent 数据源**——Claude Code、Codex、OpenCode、Cline 的本地会话用量经统一 Provider 接口接入；V2.5.0 补齐**多 agent 聚合展示**——大屏切换条、分组卡片、同轴对比曲线、会话聚焦与悬浮条 focusAgent（默认仍只读 ZCode，新 UI 仅在多源时出现）。**插件本体零 npm 依赖、纯 Node 实现、数据全本地**。

> **从 v1.x 升级**：v1.x（≤ 1.5.11）是通过本地反向代理统计 API 用量的形态，客户端需把 Base URL 指向 `127.0.0.1:8787`。V2.0.0 放弃了代理架构，改为直读 ZCode 自身 usage 数据库——**无需改任何客户端配置，装上即用**。v1.x 的代码保留在 git 历史中（tag `v1.5.10` 及更早提交）。

> **[English README](README.en.md)** · 本文档为中文版。

本仓库同时是一个 ZCode 本地插件市场（marketplace 名称：`tps-local-marketplace`），插件本体位于 [`plugins/zcode-tps-monitor/`](plugins/zcode-tps-monitor/README.md)。完整双语 Release Notes 见 [`docs/releases/`](docs/releases/)。

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  ZCode 客户端                                                │
│                                                              │
│  SessionStart 钩子 ──▶ 记录会话 ID + 注入使用提示              │
│  UserPromptSubmit 钩子 ─▶ 读 usage 库,注入上一轮速率作上下文   │
│  Stop 钩子 ──▶ 按 turn_id 圈定本轮,算即时速率                 │
│                    │                                         │
│                    ▼  systemMessage 由客户端直接显示           │
│            「537.3 tok/s · 首字 3.0s · 输出 223 tok …」        │
└───────────────────────┬──────────────────────────────────────┘
                        │ 只读
                        ▼
              ~/.zcode/cli/db/db.sqlite（model_usage 表）
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  /tps · /tps-doctor   实时大屏        MCP 工具
  （斜杠命令）        dashboard/      tps_snapshot
                      server.mjs     tps_watch
```

- **真实数据**：Token 速率完全来自 ZCode usage 数据库中的真实 token 累计值（输出侧口径，含思考 token），不经过模型转述，也不做估算。
- **零依赖**：全部为 Node 内置能力（`node:sqlite` / `node:http` 等），无任何 npm 包；钩子单次执行仅一次毫秒级数据库读取，开销可忽略。
- **全本地**：不联网、不上传、无后台常驻进程（大屏空闲 3 小时自动退出）。

## 功能特性

- **本轮即时速率行（默认开启）** —— 每轮回复结束的瞬间（Stop 钩子）自动显示一行指标：本轮即时 tok/s、首 token 延迟（TTFT）、输出 token 数、纯生成耗时、请求段数/单段峰值、最近数轮滑动平均、会话累计与采样时刻。多段工具调用的长轮次按「总产出 / 总纯生成时长」加权，段间等待不计入。
- **实时监控大屏** —— `/dashboard` 一键拉起，浏览器深色运维风格面板；**SSE 实时推送**取代定时轮询，新样本到达即刷新，空闲时通道上只有心跳；空闲 3 小时自动退出，不留后台进程。默认**液态玻璃**质感，可整体关闭。
- **外观自定义** —— 主题（深色 / 浅色 / 跟随系统）、界面与数字字体、基准字号、整体缩放、主题色、玻璃强度均可配置；大屏右上角「⚙ 外观」抽屉即时保存即时生效，配置同时作用于 Windows 悬浮条。
- **斜杠命令** —— `/tps` 即时快照；`/tps 10` 采样观察 10 秒（2–30 秒）；`/tps-doctor` 环境自检逐项排查。
- **MCP 工具** —— `tps_snapshot` / `tps_watch`，供 agent 程序化取数。
- **桌面悬浮条（Windows）** —— `overlay.ps1` 桌面常驻文字悬浮条，随时可见当前速率（无 Electron 时的轻量替代，仅 Windows、不再新增功能）。
- **Electron 桌面客户端（可选，V2.3.0）** —— 跨平台（Windows / macOS / Linux）桌面形态：仪表盘主窗口、透明置顶悬浮条、托盘、开机自启与自动更新；与浏览器大屏共用同一份页面与配置。
- **多 agent 数据源（V2.4.0）** —— 同一套「本轮即时 tok/s」口径覆盖 Claude Code、Codex、OpenCode、Cline 的本地会话数据，与 ZCode 自身数据同屏聚合；默认仍只读 ZCode，输出与 V2.3.0 一致。
- **多 agent 聚合展示（V2.5.0）** —— 大屏新增数据源切换条、每源分组卡片（能力缺失显示「—」）、同轴对比曲线（图例标注实测 / 估算口径）与每源会话切换器；悬浮条与托盘支持 `focusAgent` 聚焦。单源时全部隐藏，与 V2.4.0 视觉一致。
- **业务 TPS 监控（可选）** —— 配置 `metrics_url` 接入真实业务指标接口（字段自动兼容三层嵌套），未配置时使用内置演示数据；与 Token 速率相互独立。
- **低开销** —— 钩子一次只读连接完成查询（预编译语句，单次预算 50ms，超支可被 `/tps-doctor` 检出）；canvas 仅在有新样本或窗口变化时重绘；DOM 值不变不写；悬浮条 2s 轮询、无变化跳过更新。

## 实时推送与性能

大屏与悬浮条的刷新全部由数据驱动，不做无谓的空转：

- **SSE 推送**：`GET /api/events`（`text/event-stream`，纯 `node:http` 实现）。连接建立先推一次全量 `snapshot`，之后只推增量事件——`token`（新速率样本）、`history-append`（历史增量）、`sys`（系统指标，5s 一次）；每 15s 一条心跳注释行。断线按 `retry: 2000` 自动重连并重新推送全量快照。
- **空闲零轮询**：无数据变化时通道上只有心跳注释行（零数据载荷），页面上不存在任何周期性请求；`setInterval` 仅保留时钟。
- **单次采集扇出**：服务端一条 1s 采集 tick 只读一次库，供所有 SSE 客户端复用；CPU 百分比采样（内含 250ms 睡眠）在 5s 窗口内缓存。
- **REST 端点保留**：`/api/token-rate`、`/api/metrics` 行为不变，供第三方与不支持 EventSource 的浏览器使用（后者自动回退轮询）。
- **钩子耗时诊断**：钩子单次 DB 读取计时写入本地 `~/.zcode/tps-monitor.perf.log`，`/tps-doctor`（`--json`）的 `perf` 节呈现最近耗时、P50/P95/最大值、超 50ms 预算次数与索引全表扫描提示。

| 指标 | 数值 |
|---|---|
| 空闲大屏周期性轮询请求 | 0（仅 15s 心跳注释行） |
| 稳态增量包大小 | < 1KB |
| 2 万行 usage 库 `queryTurn` 耗时 | P95 ≈ 5ms（预算 50ms） |
| 建议索引效果 | 全表扫描 6 → 0 |
| SSE 系统指标推送间隔 | 5s |
| 悬浮条轮询间隔 | 2s |

建议索引（usage 库很大且 doctor 提示全表扫描时可酌情执行；插件以只读方式连接，不会代客户端建索引）：

```sql
CREATE INDEX IF NOT EXISTS idx_model_usage_session_completed ON model_usage(session_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_status_completed ON model_usage(status, completed_at DESC);
```

## 效果预览

每轮回复结束时自动显示一行速率指标，无需任何手动操作：

![token 速率行效果](plugins/zcode-tps-monitor/docs/effect-token-rate.png)

| 字段 | 含义 |
|---|---|
| `537.3 tok/s` | 本轮即时输出速率（含思考 token；多段轮次为加权速率） |
| `首字 3.0s` | 首 token 延迟（TTFT，本轮第一段） |
| `输出 223 tok / 生成 0.4s` | 本轮输出 token 数与纯生成耗时（不含段间工具等待） |
| `2 段 / 峰 537.3` | 本轮的请求段数与单段峰值速率（多段轮次才显示） |
| `近3次均 494.9` | 最近数轮滑动平均 |
| `累计 51.3k tok` | 当前会话累计输出（独立统计，不受窗口限制） |
| `⏱ 10:23:04` | 采样时刻（回复结束时间） |

数字显示规则：每轮「输出」用千分位精确数字（如 `2,762 tok`）；「累计」用紧凑单位——千以下原始、1k~1万一位小数（`9.8k`）、1万~100万取整（`51k`）、百万以上一位小数 M（`73.8M`）。

## 多 agent 支持（V2.4.0 数据层 + V2.5.0 展示层）

除 ZCode 自身外，插件还能读其他客户端工具的本地用量数据。做法不是给每个工具写一套统计逻辑，而是先把「读 ZCode usage 库」抽象成一个统一的 **Provider 接口**，再把每个客户端的数据源实现到这个接口后面。聚合层只认归一化后的记录，上游字段名的差异（`output_tokens` / `outputTokens` / `tokensOut` / `completion_tokens`…）全部收口在各自的 Provider 内部。

**默认行为与 V2.3.0 完全一致**：不配置时 `providers` 为 `["zcode"]`，速率行、`/tps`、大屏、MCP 全部只读 ZCode 的 usage 库——走的就是 V2.3.0 那条代码路径，只在结果上多一个 `provider` 字段。多 agent 能力要显式开启。

### 各数据源与口径声明

| ID | 客户端 | 数据位置（默认） | 格式 | 速率 | TTFT | 会话维度 |
|---|---|---|---|---|---|---|
| `zcode` | ZCode | `~/.zcode/cli/db/db.sqlite` · `model_usage` 表 | sqlite | ✅ | ✅ | ✅ |
| `claude-code` | Claude Code | `~/.claude/projects/**/*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `codex` | Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `opencode` | OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | json | ✅ | ❌ | ✅ |
| `cline` | Cline | `<编辑器 globalStorage>/…/tasks/*/api_conversation_history.json` | json | ✅ | ❌ | ✅ |

- 各源的数据根目录都可用环境变量覆盖：`TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME`；`ZCODE_USAGE_DB` 沿用既有语义。默认值取各客户端的官方位置。
- **能力降级**：四个第三方客户端都不记录首 token 时刻，因此它们的 TTFT 显示为 `-`（`ttftMs` 为 `null`），**不会拿相邻请求的时间差冒充首字延迟**。
- **生成耗时口径不统一，横向不可比**：

  | 数据源 | 口径 | 说明 |
  |---|---|---|
  | `zcode` | `completed_at - first_token_at` | 实测值 |
  | `claude-code` | 相邻请求时间差 | 超过 120s 视为夹了人工思考，判无效 |
  | `codex` | `token_count` 事件间隔 | 旧版只给累计值时按差分求增量，累计回退自动识别 reset |
  | `opencode` | 客户端自记的 `created` / `completed` | 最接近实测 |
  | `cline` | 相邻条目差 | 与任意条目比对，不限有用例的条目 |

- 聚合口径与单源一致：窗口速率取「有效样本的总产出 / 总纯生成时长」，多源时窗口统计与累计统计跨源求和；同刻并列的样本按 `providers` 里的声明顺序排列，保证结果可复现。

### 开启方式

在 `~/.zcode/tps-monitor.config.json` 中新增 `providers` 字段（**只增不删**，旧配置无此字段时行为与之前完全一致）：

```json
{
  "providers": ["zcode", "claude-code", "codex", "opencode", "cline"]
}
```

| 写法 | 含义 |
|---|---|
| 不写 / `["zcode"]` | 只读 ZCode，与 V2.3.0 逐字节一致（默认） |
| `["claude-code"]` | 只看 Claude Code 的会话数据 |
| `["zcode", "codex"]` | 两源聚合，按完成时刻合并排序 |
| 全五个 | 全聚合；未安装的客户端自动跳过，读都不读 |

未知 ID 在归一化时被丢弃并回退默认值，写错一个名字不会让插件起不来。也可用环境变量 `TPS_PROVIDERS` 覆盖（逗号分隔），优先级低于配置文件。

### 聚合展示（V2.5.0，仅在启用 ≥2 个源时出现）

启用多个源后，大屏 header 下方出现**数据源切换条**（全部 / ZCode / Claude Code / …），并新增两块内容——**分组卡片**（每源一张「速率 / 首字 / 输出 / 请求」卡，能力缺失字段显示「—」）与**同轴对比视图**（每源一条速率曲线，图例标注实测 / 估算口径；聚焦某源时其余变淡）。同一工具多会话时卡片内可下拉**聚焦某个历史会话**或跟随当前会话，每个源的记忆独立存于浏览器 localStorage。

- 切换条数据来自新端点 `GET /api/agents`（逐源探测 + 会话列表）；数据源列表变化经 SSE `agents` 事件实时推送。
- 聚焦单源时对比曲线使用各源**自己的当前会话**口径；顶部主卡片始终是 followed 会话口径——两处横向不可比，是跨工具场景的固有属性。
- 单源配置下切换条与多 agent 区块**完全不渲染**，页面与 V2.4.0 一致；对比视图空闲零轮询，仍由新样本驱动重绘。

### 悬浮条聚焦（focusAgent）

`~/.zcode/tps-monitor.config.json` 新增 `focusAgent` 字段（缺省 `zcode`，`"all"` = 聚合），决定悬浮条显示哪个客户端的速率：

- **Electron 托盘**新增「聚焦数据源」子菜单（单选，标注各源可用性），写入即生效；悬浮条聚焦非 zcode 源时显示来源标签。
- **overlay.ps1** 读同一份配置，轮询 URL 追加 `?agent=<id>`，统计行前缀来源名；不配置时 URL 与 V2.4.0 逐字节一致。
- REST `GET /api/token-rate` 支持可选 `?agent=` / `?session=` 作用域（未知源 400），供脚本按源取数。

### 命令与接口

| 用法 | 说明 |
|---|---|
| `node scripts/token-rate.mjs --agents` | 列出全部数据源的探测结果、数据格式、会话数与样本数（`--json` 可编程消费） |
| `node scripts/token-rate.mjs --agent claude-code` | 只统计某个源；无 TTFT 时字段降级显示 |
| `node scripts/token-rate.mjs --session <id>` | 只统计指定会话（优先于 `ZCODE_SESSION_ID`） |
| `/tps`（多源时） | 人类可读输出按数据源分组（`各源速率:`块），`--json` 附 `perProvider`；单源保持原格式 |
| `/tps-doctor` | 「数据源(多 agent)」逐项给出可用 / 不可用 + 原因 + 数据格式 + 样本条数 |
| MCP `tps_snapshot` / `tps_watch` | 返回结构**只增字段**：新增 `provider` 与 `sessionId`，多源时附 `sources` / `agents` 明细 |
| 大屏 `/api/agents` | 已启用数据源清单 + 逐源探测 + 会话列表（切换条 / 卡片 / 会话切换器共用） |
| 大屏 `/api/config` | `providers` 与 `focusAgent` 读写（与 `appearance` 相互独立）；SSE 多源快照附 `perProvider` |

### 合规说明

- 插件核心（hooks / scripts / mcp / commands / dashboard）**零 npm 依赖**，Provider 全部纯 Node 实现（`node:fs` / `node:path` / `node:os` / `node:sqlite`），要求 Node ≥ 22.5。
- **全部只读本地文件，不联网、无遥测、不上报任何数据**；不会修改任何客户端的数据目录，连接 usage 库时也是只读方式。
- **故障隔离**：任一源数据损坏或格式变更，只影响该源自己（`sources` 里记一条失败原因），其余源照常出数，插件其余功能不受影响。JSONL 解析带单行故障隔离与 2 万条上限，坏行只跳过自己。
- **钩子热路径不读 JSONL**：Stop / prompt-submit 钩子始终直连 zcode usage 库，不经聚合层——JSONL 可能到几十 MB，逐条解析会顶破 50ms 预算。因此即使配满五个源，钩子输出与只用 zcode 时逐字节相同。

## 安装（三种方式，任选其一）

要求 **Node.js ≥ 22.5**（需内置 `node:sqlite`；Windows / macOS / Linux 相同）。

### 方式一：从 GitHub 添加市场（推荐）

在 ZCode 中执行：

```text
/plugin marketplace add Neriah-Ado/stepfun-usage-monitor
/plugin install zcode-tps-monitor@tps-local-marketplace
```

安装后**重开会话**使钩子重新注册，之后每轮回复结束即自动显示速率。

### 方式二：本地目录

克隆本仓库后，在 ZCode 中打开 **设置 → 插件管理 → 发现 → +**，来源选择「本地目录」，指向仓库根目录即可。

### 方式三：只用手脚本 / 大屏（不装插件）

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor/plugins/zcode-tps-monitor

node scripts/token-rate.mjs            # 当前速率（人类可读）
node scripts/token-rate.mjs --turn     # 本轮（刚结束轮次）即时速率
node scripts/token-rate.mjs --json     # JSON 输出
node scripts/doctor.mjs                # 环境自检
node dashboard/server.mjs              # 实时大屏（默认 127.0.0.1:7423）
```

### 更新

```text
/plugin marketplace update tps-local-marketplace
```

更新后重装/升级插件，并重开会话使钩子重新注册。

## 桌面客户端（Electron，可选）

插件本体之外，本仓库还带一个**可选的 Electron 桌面客户端**：它复用插件的采集核心、大屏服务与同一份外观配置，额外提供常驻桌面形态。它是**独立分发物，不属于插件市场**，装不装都不影响插件本身的任何功能。

**开发运行**（需要 Node ≥ 22.5 与 npm）：

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor
npm install
npm run dev            # 启动 Electron(首次运行会下载 Electron 二进制)
```

**安装包**（从仓库 Releases 页面下载，或本地构建）：

```bash
npm run icons          # 重新生成图标(纯 Node,无需图片处理依赖)
npm run dist:win       # Windows:NSIS 安装包(x64/arm64)+ portable(x64)
npm run dist:mac       # macOS:dmg(x64/arm64)
npm run dist:linux     # Linux:AppImage(x64/arm64)
```

推送 `v*` 标签时 `.github/workflows/release.yml` 会自动跑完单测并构建三平台产物，上传为 GitHub Release 附件；客户端经 `electron-updater` 自动检查更新。

**界面与操作**：

| 元素 | 行为 |
|---|---|
| 主窗口 | 加载与浏览器**同一份**大屏页面；尺寸 / 位置 / 置顶状态记忆；**关闭 = 最小化到托盘**，进程不退 |
| 页头「📌」 | 切换主窗口置顶 |
| 页头「▣」 | 显示 / 隐藏悬浮条 |
| 悬浮条 | 透明无边框置顶小窗，显示当前 tok/s；整条可拖拽；悬停展开 TTFT / 近 N 次均 / 累计 token 与迷你曲线 |
| 悬浮条「📌」 | 点击穿透开关：开启后点击落到下层窗口，悬停展开仍可用 |
| 托盘菜单 | 显示/隐藏悬浮条、打开仪表盘、主窗口置顶、悬浮条点击穿透、开机自启、退出 |

**配置互通**：桌面端与浏览器大屏读写**同一份** `~/.zcode/tps-monitor.config.json` 的 `appearance` 节——任一端改外观，另一端重启即生效。桌面专属状态（窗口位置、悬浮条可见性与开关、开机自启）单独存在 `~/.zcode/tps-monitor.desktop.json`，不污染插件配置节，文件损坏或越界时自动回落默认值。

> **体积说明**：安装包含完整 Electron 运行时，属百 MB 量级（NSIS 安装包 / portable 通常在 80–100 MB 上下，dmg / AppImage 与之相当或略大，具体以 Release 附件为准）。只想要 Windows 上的一枚悬浮条、不想装 Electron 的话，`dashboard/overlay.ps1` 仍是零安装单文件选择。

> **依赖隔离**：`electron` / `electron-builder` / `electron-updater` 全部集中在**工作区级根 `package.json`**，Electron 代码全部在 `electron/` 目录内；插件目录（hooks / scripts / mcp / commands / dashboard）零 npm 依赖、行为零改动，`node --test` 有专门断言守着这条线。

## 使用

| 场景 | 操作 |
|---|---|
| 查看每轮速率 | 无需操作，每轮回复结束时自动显示本轮即时速率 |
| 即时快照 | 输入 `/tps`；或 `/tps 10` 持续采样 10 秒 |
| 打开监控大屏 | 输入 `/dashboard`，或手动 `node dashboard/server.mjs` |
| 环境自检 | 速率行不见了？输入 `/tps-doctor` 逐项排查 |
| 查看其他客户端数据 | `/tps` 已按 `providers` 配置聚合；命令行用 `--agent claude-code` 只看单源，`--agents` 看各源探测结果 |
| 关闭本轮即时行 | `~/.zcode/tps-monitor.config.json` 写入 `{"stopHookLine": false}`，重开会话生效 |
| 关闭全部速率注入 | 同文件写入 `{"tokenRateLine": false}`，重开会话生效 |
| 改大屏外观 | 大屏右上角「⚙ 外观」抽屉；或直接编辑配置文件的 `appearance` 节（见下文） |
| 桌面悬浮条 | 运行 `dashboard/overlay.ps1`（Windows）；跨平台请用 Electron 桌面客户端（见上） |
| agent 取数 | MCP 工具 `tps_snapshot` / `tps_watch` |

命令带插件名前缀的等价写法：`/zcode-tps-monitor:tps`、`/zcode-tps-monitor:tps-doctor`、`/zcode-tps-monitor:dashboard`。

## 配置

### 业务 TPS（可选）

插件默认提供演示数据；若要监控真实业务吞吐，在 **设置 → 插件管理 → zcode-tps-monitor** 中配置 `metrics_url`，指向任意返回 JSON 的指标接口。字段自动兼容（支持最多三层嵌套）：

| 指标 | 识别的字段名 |
|---|---|
| 吞吐 | `tps` / `qps` / `throughput` / `transactionsPerSecond` |
| 延迟 | `p50` / `p95` / `p99`（或 `latency_p50` 等） |
| 错误率 | `error_rate` / `errorRate` / `err_rate` |

示例接口返回：

```json
{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}
```

> 注意：`metrics_url` 未配置时，插件的 MCP 服务器在部分客户端会因清单变量无法展开而启动失败（表现为 `plugins validate` 报 `plugin_variable_missing: metrics_url`）。在插件设置里为该字段随便填个值（空串即可）即可；钩子、命令与技能不受影响。

### 外观自定义（大屏 / 悬浮条）

`~/.zcode/tps-monitor.config.json` 中新增 `appearance` 节（与 `stopHookLine` 等同级，**只增不删**——旧配置无此节时行为与之前完全一致）：

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

| 字段 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `theme` | `dark` / `light` / `system` | `dark` | `system` 跟随系统深浅色偏好 |
| `fontFamily` | CSS 字体栈 | `Segoe UI, Microsoft YaHei, system-ui, sans-serif` | 界面字体 |
| `monoFont` | CSS 字体栈 | `Cascadia Mono, Consolas, monospace` | 数字 / 时钟字体 |
| `fontSize` | 8–24 | `16` | 基准字号（px） |
| `fontScale` | 0.8–1.5 | `1` | 整体缩放倍率（根字号 = fontSize × fontScale） |
| `accentColor` | `#hex` / `rgb(a)` / `hsl(a)` / 常用色名 | `#4da3ff` | 主题色（曲线、按钮、高亮） |
| `glassIntensity` | 0–1 | `0.6` | 液态玻璃强度；`0` 完全关闭，恢复纯色面板 |
| `fontUrl` | `http(s)://` / `file://` | 空 | 可选 Web 字体，加载失败静默回退系统字体 |

- 数值越界自动夹紧到合法区间；非法值（注入字符、非法颜色 / 协议）整条写入被拒绝，不影响已存配置；配置文件损坏时给出修复提示，不静默覆盖。
- 更方便的方式：大屏右上角「⚙ 外观」抽屉内调整并保存，即时生效。
- 悬浮条 `overlay.ps1` 读取同一配置（玻璃强度 > 0 时尝试 Acrylic 背景，失败自动回退原形态）；Electron 悬浮条与主窗口读取的也是这一份配置。

### 环境变量与配置文件

| 项 | 说明 |
|---|---|
| `ZCODE_USAGE_DB` | 覆盖 usage 数据库路径（默认 `~/.zcode/cli/db/db.sqlite`），特殊安装位置用 |
| `TPS_PROVIDERS` | 覆盖启用的数据源（逗号分隔，如 `zcode,claude-code`），优先级低于配置文件 |
| `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME` | 覆盖对应客户端的数据根目录，默认取各客户端官方位置 |
| `~/.zcode/tps-monitor.config.json` | 本地配置：`stopHookLine`（Stop 钩子速率行开关）、`tokenRateLine`（速率注入总开关）、`providers`（多 agent 数据源，见上）、`appearance`（大屏外观，见上） |
| 大屏端口 | `dashboard/server.mjs` 默认监听 `127.0.0.1:7423` |

## 工作原理

```
用户发送消息
   │
   ▼
UserPromptSubmit 钩子
   │  读取 ZCode usage 数据库，注入上一轮速率作模型上下文
   ▼
模型回复（工具调用 × N 段）
   │
   ▼
Stop 钩子（回复刚结束，本轮已全部入库）
   │  按最新 turn_id 圈定本轮全部请求，
   │  计算即时速率（总产出 / 总纯生成时长）
   ▼
systemMessage 直接显示本轮速率行
```

- **SessionStart 钩子**：会话启动时记录当前会话 ID 并注入使用提示。
- **UserPromptSubmit 钩子**：每轮触发一次，毫秒级数据库读取；此刻本轮尚未发生，因此只注入上一轮数据作上下文（纯模型上下文，禁止引用展示）。
- **Stop 钩子**：回复刚结束、本轮数据已完整入库的瞬间触发，按 `turn_id` 精确圈定本轮（一次用户消息触发的全部请求，含多段工具调用），经 `systemMessage` 由客户端直接显示——无需模型转发，天然零滞后。
- Token 速率与业务 TPS 相互独立：前者始终来自真实数据，后者取决于是否配置 `metrics_url`。
- **数据源选择只发生在非钩子路径**：钩子固定读 ZCode usage 库（保证热路径不碰 JSONL）；`/tps`、大屏、Electron、MCP 经聚合层按 `providers` 取数，单源且为 `zcode` 时走与 V2.3.0 完全相同的代码路径。

## 项目结构

```
marketplace.json                      市场清单（tps-local-marketplace → plugins/zcode-tps-monitor）
package.json                          Electron 桌面客户端工作区清单（独立分发物，不进市场）
electron-builder.yml                  三平台打包配置（nsis / dmg / AppImage + GitHub Releases 发布）
.github/workflows/release.yml         标签触发的三平台构建流水线（先跑 node --test）
electron/                             Electron 桌面客户端（V2.3.0，与插件核心隔离）
├─ main.mjs                           主进程：窗口 / 托盘 / 开机自启 / 自动更新 / IPC
├─ preload.cjs                        预加载：contextBridge + 通道白名单
├─ renderer/overlay.html              悬浮条渲染层（透明 / 可拖 / 悬停展开）
├─ lib/                               纯逻辑：overlay-payload / collect-loop / state-store
└─ build/make-icons.mjs               纯 Node 生成 ICO / ICNS / PNG 图标
plugins/zcode-tps-monitor/
├─ .zcode-plugin/plugin.json          插件清单（V2.5.0，含 userConfig.metrics_url）
├─ .claude-plugin/plugin.json         Claude 兼容清单（同版本）
├─ .mcp.json                          stdio MCP 服务器定义（tps_snapshot / tps_watch）
├─ commands/                          /tps · /tps-doctor · /dashboard
├─ skills/zcode-tps-monitor/SKILL.md  技能：用户问速率/TPS 相关问题时自动触发
├─ hooks/
│  ├─ hooks.json                      SessionStart / UserPromptSubmit / Stop 注册
│  ├─ session-start.mjs               会话提示
│  ├─ prompt-submit.mjs               上一轮速率注入上下文
│  └─ stop.mjs                        本轮即时速率行
├─ scripts/
│  ├─ collect.mjs                     业务 TPS 采集（--watch N 采样观察）
│  ├─ token-rate.mjs                  Token 速率 CLI（--turn / --json / --agent / --session / --agents）
│  ├─ doctor.mjs                      环境自检（--json 可编程消费，含 perf 与多 agent 数据源节）
│  ├─ lib/collect-core.mjs            采集与格式化核心（MCP 与脚本共用；aggregateRate/aggregateTurn/agentStatus 聚合层）
│  ├─ lib/config.mjs                  appearance / providers 配置读写与校验（大屏 / doctor / 桌面端共用）
│  ├─ lib/usage-db.mjs                usage 库只读访问层（预编译语句 + 索引自检）
│  ├─ lib/perf-log.mjs                钩子耗时诊断日志（~/.zcode/tps-monitor.perf.log）
│  ├─ lib/providers/                  多 agent 数据源（V2.4.0，零依赖纯 Node）
│  │  ├─ index.mjs                    注册表：ID / 别名 / 能力矩阵 / 归一化 / 按配置取源
│  │  ├─ common.mjs                   归一化与视图构建（速率公式与 usage-db 同源）
│  │  ├─ zcode.mjs                    ~/.zcode/cli/db/db.sqlite（V2.3.0 逻辑原样迁入）
│  │  ├─ claude-code.mjs              ~/.claude/projects/**/*.jsonl
│  │  ├─ codex.mjs                    ~/.codex/sessions/（无 TTFT，能力降级）
│  │  ├─ opencode.mjs                 opencode storage/message 本地存储
│  │  └─ cline.mjs                    Cline 任务目录 api_conversation_history.json
│  └─ lib/sse.mjs                     SSE 线格式（事件 / 心跳 / retry）
├─ dashboard/
│  ├─ server.mjs                      实时大屏服务（默认 127.0.0.1:7423，空闲 3h 自动退出；/api/events SSE + /api/config）
│  ├─ server-core.mjs                 大屏服务工厂（Electron 主进程以随机端口复用）
│  ├─ index.html                      大屏页面（EventSource 局部更新 + canvas 脏标记 + CSS 变量主题 + 液态玻璃 + 外观设置抽屉 + 桌面专属按钮）
│  └─ overlay.ps1                     Windows 桌面悬浮条（2s 轮询，跟随 appearance 配置；无 Electron 时的轻量替代）
└─ docs/effect-token-rate.png         速率行效果图

test/config.test.mjs                  外观配置测试（node --test）
test/perf.test.mjs                    性能回归测试（SSE 格式 / 增量包 / 语句复用 / 钩子耗时）
test/providers.test.mjs               多 agent Provider 测试（每源夹具 / 能力降级 / 多源合并 / 损坏隔离 / 默认字节一致 / 钩子不读 JSONL）
test/aggregate-view.test.mjs          多 agent 聚合展示测试（/api/agents / agents 事件 / perProvider / 作用域参数 / 分组输出）
test/desktop.test.mjs                 Electron 桌面客户端测试（载荷口径 / 状态持久化 / 采集循环 / 图标容器 / IPC 一致 / 零依赖扫描）
test/token-rate.test.mjs              测试套件（node --test）
docs/releases/                        各版本双语 Release Notes（中文 + English）
assets/                               仓库图标（node assets/generate-icon.mjs 可再生成）
```

## 测试与验证

```bash
node --test                                              # 测试套件（数字格式化 / turn 查询 / 外观配置 / SSE 与性能断言 / 多 agent Provider / 聚合展示 / 桌面客户端等 88 条）
cd plugins/zcode-tps-monitor && node scripts/doctor.mjs  # 环境自检（--json 含 perf 与多 agent 数据源节）
```

MCP 服务器手工冒烟（响应为 `Content-Length` 帧，同时兼容裸 JSON 行请求）：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/zcode-tps-monitor/mcp/tps-server.mjs
```

## 常见问题

**Q：可以在 OpenCode / Codex / Claude Code 等其他工具中使用吗？**

A：插件机制与钩子绑定 ZCode——速率行只在 ZCode 会话里显示。但**数据源不限 ZCode**：V2.4.0 起可在 `providers` 里加入 Claude Code、Codex、OpenCode、Cline，`/tps`、大屏、MCP 就能读到这些客户端的本地会话用量（口径见「多 agent 支持」一节）。未开启时仍只读 ZCode，行为与此前完全一致；业务 TPS 采集脚本与大屏是独立程序，可脱离 ZCode 运行。

**Q：显示的速率准确吗？**

A：速率由客户端用量数据中的真实 token 累计值计算得出，口径为模型输出侧 token（含思考 token）。行在回复刚结束的瞬间采样，显示的就是本轮；多段轮次为「总产出 / 总纯生成时长」加权，段间工具等待不计入。ZCode 的纯生成耗时是实测值；其他客户端没有首 token 时刻，只能用估算口径且各家不同（见「多 agent 支持」一节的对照表），**跨源横向不可比**。与其他工具显示的数字也可能因统计窗口不同而略有差异。

**Q：速率行突然不见了？**

A：运行 `/tps-doctor` 自检。常见原因：Node 版本低于 22.5（需内置 `node:sqlite`）、ZCode 更新后表结构变化、升级插件后未重开会话（钩子需新会话注册）、或配置文件里关闭了注入。

**Q：大屏是轮询还是推送？会占多少资源？**

A：SSE 推送（`GET /api/events`）。空闲时通道上只有 15 秒一条心跳注释行，页面上不存在任何周期性请求；服务端一条 1s 采集 tick 只读一次库并扇出给所有 SSE 客户端。新样本到达时才按事件类型局部更新 DOM 与 canvas（脏标记重绘），稳态增量包 < 1KB。钩子侧单次 DB 读取有 50ms 预算，耗时分布与超支次数可在 `/tps-doctor` 的 perf 节查看。

**Q：macOS / Linux 支持吗？**

A：支持。钩子、命令、大屏、MCP 均为跨平台 Node 实现；usage 数据库路径按用户主目录自动解析，特殊安装位置可用 `ZCODE_USAGE_DB` 环境变量覆盖。桌面形态有两种：`overlay.ps1` 依赖 Windows API 仅限 Windows；**Electron 桌面客户端**（V2.3.0）三平台都有安装包（NSIS / dmg / AppImage），macOS 与 Linux 用户可用它获得悬浮条、托盘与开机自启。

**Q：和 v1.x 的 stepfun-usage-monitor 什么关系？**

A：同一个仓库的两代产品。v1.x 通过本地反向代理（`127.0.0.1:8787`）统计各大模型 API 的 Token 用量，需要改客户端 Base URL；V2.0.0 完整重构为 ZCode 插件，直读 ZCode 自身 usage 数据库，无需改任何客户端配置。若仍需要 v1.x 的代理，代码在 git 历史中（见 tag `v1.5.10`）。

**Q：演示数据怎么关掉？**

A：演示数据只影响「业务 TPS」部分（Token 速率始终真实）；不配置 `metrics_url` 即为演示模式，配置后自动切换为真实数据源。

**Q：不喜欢液态玻璃效果 / 想换字体？**

A：大屏右上角「⚙ 外观」抽屉里把「玻璃强度」拖到 0 即恢复纯色面板；主题、字体、字号、缩放、主题色都在同一抽屉内即时生效。也可直接编辑 `~/.zcode/tps-monitor.config.json` 的 `appearance` 节（字段见「配置」一节），或对悬浮条生效的同一配置。

## License

[MIT](LICENSE) © 2026 shy3130（上游作者）· V2.1.0 外观与液态玻璃、V2.2.0 性能优化、V2.3.0 Electron 桌面客户端、V2.4.0 多 agent Provider 数据层：Neriah-Ado
