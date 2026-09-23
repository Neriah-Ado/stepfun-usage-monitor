<img src="assets/icon.png" align="right" width="96" alt="zcode-tps-monitor 图标">

# stepfun-usage-monitor — ZCode Token 速率监控（zcode-tps-monitor）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

**V2.0.0**：完整重构——本仓库不再是 v1.x 的「StepFun API 用量本地监控代理」，而是参照 [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor) 重写的 **ZCode 会话级 Token 速率监控插件**：每轮回复结束时自动显示**本轮即时** tok/s——数据直接读取 ZCode usage 数据库，非模型自述、非估算；另附实时监控大屏、斜杠命令、MCP 工具与可选的业务 TPS 监控。**零 npm 依赖、纯 Node 实现、数据全本地**。

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
- **实时监控大屏** —— `/dashboard` 一键拉起，浏览器深色运维风格面板，秒级自动刷新；空闲 3 小时自动退出，不留后台进程。
- **斜杠命令** —— `/tps` 即时快照；`/tps 10` 采样观察 10 秒（2–30 秒）；`/tps-doctor` 环境自检逐项排查。
- **MCP 工具** —— `tps_snapshot` / `tps_watch`，供 agent 程序化取数。
- **桌面悬浮条（Windows）** —— `overlay.ps1` 桌面常驻文字悬浮条，随时可见当前速率。
- **业务 TPS 监控（可选）** —— 配置 `metrics_url` 接入真实业务指标接口（字段自动兼容三层嵌套），未配置时使用内置演示数据；与 Token 速率相互独立。

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

## 使用

| 场景 | 操作 |
|---|---|
| 查看每轮速率 | 无需操作，每轮回复结束时自动显示本轮即时速率 |
| 即时快照 | 输入 `/tps`；或 `/tps 10` 持续采样 10 秒 |
| 打开监控大屏 | 输入 `/dashboard`，或手动 `node dashboard/server.mjs` |
| 环境自检 | 速率行不见了？输入 `/tps-doctor` 逐项排查 |
| 关闭本轮即时行 | `~/.zcode/tps-monitor.config.json` 写入 `{"stopHookLine": false}`，重开会话生效 |
| 关闭全部速率注入 | 同文件写入 `{"tokenRateLine": false}`，重开会话生效 |
| 桌面悬浮条 | 运行 `dashboard/overlay.ps1`（Windows） |
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

### 环境变量与配置文件

| 项 | 说明 |
|---|---|
| `ZCODE_USAGE_DB` | 覆盖 usage 数据库路径（默认 `~/.zcode/cli/db/db.sqlite`），特殊安装位置用 |
| `~/.zcode/tps-monitor.config.json` | 本地配置：`stopHookLine`（Stop 钩子速率行开关）、`tokenRateLine`（速率注入总开关） |
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
- Token 速率与业务 TPS 相互独立：前者始终来自 ZCode 真实数据，后者取决于是否配置 `metrics_url`。

## 项目结构

```
marketplace.json                      市场清单（tps-local-marketplace → plugins/zcode-tps-monitor）
plugins/zcode-tps-monitor/
├─ .zcode-plugin/plugin.json          插件清单（V2.0.0，含 userConfig.metrics_url）
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
│  ├─ token-rate.mjs                  Token 速率 CLI（--turn / --json）
│  ├─ doctor.mjs                      环境自检（--json 可编程消费）
│  └─ lib/collect-core.mjs            采集与格式化核心（MCP 与脚本共用）
├─ dashboard/
│  ├─ server.mjs                      实时大屏服务（默认 127.0.0.1:7423，空闲 3h 自动退出）
│  ├─ index.html                      大屏页面（秒级自动刷新）
│  └─ overlay.ps1                     Windows 桌面悬浮条
└─ docs/effect-token-rate.png         速率行效果图

test/token-rate.test.mjs              测试套件（node --test）
docs/releases/                        各版本双语 Release Notes（中文 + English）
assets/                               仓库图标（node assets/generate-icon.mjs 可再生成）
```

## 测试与验证

```bash
node --test                                              # 测试套件（数字格式化 / turn 查询等）
cd plugins/zcode-tps-monitor && node scripts/doctor.mjs  # 环境自检
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

A：插件机制、钩子与数据源均绑定 ZCode，token 速率功能是 ZCode 专属；其中业务 TPS 采集脚本与大屏是独立程序，可脱离 ZCode 运行，但离开 ZCode 没有速率数据来源。

**Q：显示的速率准确吗？**

A：速率由 ZCode usage 数据库中的真实 token 累计值计算得出，口径为模型输出侧 token（含思考 token）。行在回复刚结束的瞬间采样，显示的就是本轮；多段轮次为「总产出 / 总纯生成时长」加权，段间工具等待不计入。与其他工具显示的数字可能因统计窗口不同而略有差异。

**Q：速率行突然不见了？**

A：运行 `/tps-doctor` 自检。常见原因：Node 版本低于 22.5（需内置 `node:sqlite`）、ZCode 更新后表结构变化、升级插件后未重开会话（钩子需新会话注册）、或配置文件里关闭了注入。

**Q：macOS / Linux 支持吗？**

A：支持。钩子、命令、大屏、MCP 均为跨平台 Node 实现；usage 数据库路径按用户主目录自动解析，特殊安装位置可用 `ZCODE_USAGE_DB` 环境变量覆盖。唯一例外是桌面悬浮条 `overlay.ps1`，它依赖 Windows API，仅限 Windows（macOS 用户用监控大屏即可）。

**Q：和 v1.x 的 stepfun-usage-monitor 什么关系？**

A：同一个仓库的两代产品。v1.x 通过本地反向代理（`127.0.0.1:8787`）统计各大模型 API 的 Token 用量，需要改客户端 Base URL；V2.0.0 完整重构为 ZCode 插件，直读 ZCode 自身 usage 数据库，无需改任何客户端配置。若仍需要 v1.x 的代理，代码在 git 历史中（见 tag `v1.5.10`）。

**Q：演示数据怎么关掉？**

A：演示数据只影响「业务 TPS」部分（Token 速率始终真实）；不配置 `metrics_url` 即为演示模式，配置后自动切换为真实数据源。

## License

[MIT](LICENSE) © 2026 shy3130（上游作者）· V2.0.0 重构：Neriah-Ado
