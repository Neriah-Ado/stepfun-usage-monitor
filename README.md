# stepfun-usage-monitor — StepFun API Token 用量本地监控插件

统计 StepFun API（阶跃星辰，OpenAI 兼容接口）的 Token 用量。**零 npm 依赖、常驻内存通常 < 60MB、所有数据仅存本地**，通过「本地反向代理」方式接入，因此天然兼容几乎所有 Agent / 客户端。

**v1.5.9**：适配 **ZCode 官方插件市场结构**（`marketplace.json` + `plugins/` 标准插件目录），新增 **Agent 页面吸附弹窗**（屏幕底部超紧凑横条，自动停靠底部居中）与弹窗内「⤢ 全量显示」独立页入口；**多服务商支持**（v1.5.5）——同一个代理实例内一键切换 StepFun / 智谱 GLM / DeepSeek / Kimi / MiniMax / 通义千问 / 零一万物等 OpenAI 兼容 API（也可自定义任意网关），用量按服务商分组统计。完整双语 Release Notes 见 [`docs/releases/`](docs/releases/)。

> **[English README](README.en.md)** · 本文档为中文版。

## 架构

```
┌─────────────┐   Base URL 指向本地    ┌────────────────────────┐   转发(透传)   ┌──────────────────┐
│  ZCode      │ ────────────────────▶ │  本地代理 proxy.mjs     │ ────────────▶ │ 激活服务商上游    │
│  Cline      │  127.0.0.1:8787/v1/…  │  · 流式/非流式解析usage  │  原样返回      │ (stepfun/GLM/…)  │
│  Continue … │ ◀──────────────────── │  · 增量聚合 + 环形缓冲   │ ◀──────────── │                  │
└─────────────┘                       │  · 仪表盘 + 统计API      │               └──────────────────┘
                                      └───────┬─────────────────┘
                    ┌─────────────────────────┼─────────────────────────┐
                    │ data/usage.jsonl (明细)  │ data/aggregate.json(快照) │
                    └─────────────────────────┴─────────────────────────┘
                                 │ 读取（只读）
                    mcp-server.mjs（Agent 对话查询）·  stats.mjs（终端报表）
```

- **兼容性**：任何支持自定义 OpenAI 兼容 Base URL 的客户端均可接入（ZCode、Cline、Roo Code、Continue、Cursor、Cherry Studio、ChatBox、LobeChat、Open WebUI、Dify、LangChain/LiteLLM、openai-python/node SDK 等）；支持 MCP 的 Agent（ZCode 等）还可通过内置 MCP Server 直接对话查询。
- **低开销**：Node 单进程、流式响应逐块直通（旁路扫描 usage，不缓冲不落盘中间数据），无数据库、无 Electron、无后台轮询。
- **全本地**：用量逐条追加写入 `usage.jsonl`（每行一条 JSON，崩溃安全）；聚合快照 `aggregate.json` 仅含统计数字，不含密钥与请求正文。

## 多服务商支持（v1.5.5）

同一个代理实例可服务多家大模型服务商，**无需起多个实例、无需改客户端配置**：

- **内置 7 家**：StepFun 阶跃星辰 / 智谱 GLM / DeepSeek / Kimi Moonshot / MiniMax / 通义千问 Qwen / 零一万物 Yi（均为官方 OpenAI 兼容端点）。
- **自定义服务商**：在数据目录放一份 `providers.json`，可添加任意 OpenAI 兼容网关，也可按 key 覆盖内置服务商的 `baseUrl` / `apiKey` / `modelPrefixes`：

```json
{
  "active": "deepseek",
  "providers": [
    { "key": "my-gateway", "name": "我的网关", "baseUrl": "https://gw.example.com/v1", "apiKey": "sk-...", "modelPrefixes": ["gw-"] }
  ]
}
```

- **路由优先级**（前一级命中即不再向下匹配）：

| 优先级 | 方式 | 示例 |
|---|---|---|
| 1 | 路径前缀 `/p/<key>/v1/...`（转发时自动剥除前缀） | `/p/deepseek/v1/chat/completions` |
| 2 | 请求头 `X-Provider: <key>` | 适合不方便改路径的客户端 |
| 3 | 模型名前缀命中服务商 `modelPrefixes` | `deepseek-chat` → deepseek |
| 4 | 激活默认 | 仪表盘顶栏一键切换，或 `POST /api/provider` |

- **密钥注入**：客户端未带 `Authorization` 时，按 `providers.json` 的 `apiKey` > 环境变量顺序注入（见「环境变量」一节）；`TARGET_URL` 仍可覆盖 StepFun 的 baseUrl。
- **未知 key 不静默**：路径前缀 / 请求头 / 切换请求指定了未知服务商时返回 400 + 合法服务商列表。
- **按服务商统计**：仪表盘新增服务商切换器与服务商用量表面板；`/api/stats` 新增 `byProvider` 分组；MCP 查询支持 `group="provider"`。

## 安装（三种方式，任选其一）

### 方式一：GitHub URL 直载（推荐，无需 clone / 无需安装）

本包以零依赖 npm 包形态发布，任何装有 **Node.js ≥ 18** 的机器都可以直接从 GitHub URL 拉起：

```bat
:: 启动监控代理 + 仪表盘（默认端口 8787）
npx -y github:Neriah-Ado/stepfun-usage-monitor

:: 以 MCP Server 模式运行（供 Agent 对话查询用量）
npx -y github:Neriah-Ado/stepfun-usage-monitor --mcp

:: 指定端口 / 数据目录
npx -y github:Neriah-Ado/stepfun-usage-monitor --port 8788 --data-dir D:\sfm-data
```

- 首次运行 npx 自动从 GitHub 下载并缓存，之后秒启；运行所需文件与 `bin/cli.mjs` 统一入口见 `package.json` 的 `bin` / `files` 字段。
- **数据目录与 npm 缓存解耦**：npx 运行时数据统一落在 `~/.stepfun-usage-monitor/`（Windows 为 `C:\Users\<你>\.stepfun-usage-monitor\`），npm 缓存被清理不影响历史数据；目录解析优先级：`DATA_DIR` 环境变量 > `~/.stepfun-usage-monitor/`（存在即用）> 包内 `data/`（检测到历史 `usage.jsonl` 时原地兼容）。`providers.json` 同样放在数据目录。

**ZCode 插件市场安装（v1.5.9，推荐）**：本仓库同时是一个 ZCode 插件市场（根目录 `marketplace.json`）。在 ZCode 中把本仓库添加为插件市场来源后，安装 `stepfun-usage-monitor` 插件，即可获得：

- `/sfm` 命令：一键查询用量并在屏幕底部拉起**吸附弹窗**（超紧凑 KPI 横条，约 1000×190，自动停靠底部居中；代理未运行会自动拉起，重复调用只聚焦不重开）；
- 弹窗内「⤢ 全量显示」按钮：随时拉起独立浏览器完整仪表盘；
- 插件自带 `.mcp.json`（stdio MCP，`${CLAUDE_PLUGIN_ROOT}` 指向仓库统一入口），无需再手动粘贴 MCP 配置。

插件目录结构（符合 ZCode 官方规范）：

```
marketplace.json                      市场清单（plugins[] → ./plugins/stepfun-usage-monitor）
plugins/stepfun-usage-monitor/
├─ .zcode-plugin/plugin.json         插件清单（name/version/commands/mcpServers…）
├─ commands/sfm.md                   标准命令（/sfm）
└─ .mcp.json                         stdio MCP 服务器定义
```

**ZCode 接入（MCP 对话查询，手动配置）**：ZCode → 设置 → MCP 服务器 → 添加，JSON 模式填入：

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

**其他支持 MCP 的 Agent**：

| Agent | 配置方法 |
|---|---|
| Claude Code | `claude mcp add stepfun-usage -- npx -y github:Neriah-Ado/stepfun-usage-monitor --mcp` |
| Cline / Roo Code（VS Code） | MCP Servers → Configure → 粘贴上面的 JSON |
| Cursor | `~/.cursor/mcp.json` 粘贴上面的 JSON |
| 通用 stdio 客户端 | `"command": "npx", "args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]` |

**用量统计接入**（与安装方式无关）：把客户端里 StepFun 的 Base URL 从 `https://api.stepfun.com` 改为 `http://127.0.0.1:8787`，见下文「各 Agent 接入配置」。

### 方式二：VS Code 系 IDE 扩展（VSIX）

适用于 VS Code 及其分支（Cursor、VSCodium 等）：在 IDE 内直接浏览仪表盘，支持 **底边栏面板 / 小窗 / 独立浏览器页** 三种方式；代理未运行时可自动 `npx` 从 GitHub 拉起（`stepfunMonitor.autoStart`，默认开启）。

1. 从 GitHub Release 下载 `stepfun-monitor-1.5.9.vsix`（仓库 `ide-extension/dist/` 内亦有同名文件）。
2. 安装：命令行 `code --install-extension stepfun-monitor-1.5.9.vsix`，或扩展面板右上角 `…` → **从 VSIX 安装…**。
3. 命令面板（Ctrl+Shift+P）可用命令：
   - **StepFun 监控：显示底边栏面板** — 底边栏内嵌仪表盘（`?layout=panel`）
   - **StepFun 监控：小窗打开** — 独立编辑器小窗（`?layout=window`）
   - **StepFun 监控：在浏览器打开完整仪表盘** — 跳转系统浏览器
   - **StepFun 监控：启动本地代理（npx 从 GitHub 拉起）**
4. 状态栏实时显示今日 token 消耗；代理地址等在设置项 `stepfunMonitor.*` 中调整。

> **ZCode 桌面版**是基于 Electron 的独立应用（非 VS Code 内核），不支持 VSIX 扩展。ZCode 用户请用**方式一** + 插件市场安装（v1.5.9，见上）与下文「仪表盘的三种浏览方式」。

### 方式三：手动安装（保留）

```bat
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor
start.cmd          :: 或 node proxy.mjs
```

1. 确认已安装 Node.js ≥ 18（无需 `npm install`，零依赖）。
2. 双击 `start.cmd`（或 `node proxy.mjs`）后看到：

   ```
   监听地址   : http://127.0.0.1:8787
   仪表盘     : http://127.0.0.1:8787/
   数据文件   : ...\data\usage.jsonl
   ```

3. 在 Agent 里把 Base URL 改为 `http://127.0.0.1:8787/v1`（API Key 填原来的 StepFun Key，保持不变）。
4. MCP 配置也可用手动安装写法：`"command": "node", "args": ["<本目录绝对路径>\\mcp-server.mjs"]`。

> 手动安装的历史用户（仓库 `data/` 已有 `usage.jsonl`）升级后仍原地读写原目录，数据不迁移；手动安装与 npx 直载混用时，请用 `DATA_DIR` 显式指向同一目录。

## 仪表盘的三种浏览方式

同一份仪表盘按 `?layout=` 参数渲染为三种布局，右上角可随时互切：

| 方式 | 入口 | 内容 | 适合 |
|---|---|---|---|
| **完整页** | `http://127.0.0.1:8787/` | 全部功能：KPI、图表、排行、最近请求、3 档性能模式、服务商切换 | 桌面浏览器 |
| **小窗** | `/?layout=window` 或双击 `open-window.cmd` | KPI + 图表（隐藏长表格） | 悬浮窗 / 分屏 |
| **底部横条（吸附弹窗）** | `/?layout=panel`、双击 `open-panel.cmd`、`/sfm` 命令或 `--panel` | 超紧凑 KPI 横条 + 「⤢ 全量显示」按钮（整页高约 220px，走 lite 精简载荷） | 贴边停靠 / 常驻 |

- `open-window.cmd`：用 Chrome/Edge `--app` 无边框窗口打开小窗；`open-panel.cmd`：打开小尺寸底栏窗口。
- 由 MCP `open_monitor_panel` 或 `--panel` 拉起的底栏窗口会按主屏分辨率**自动停靠底部居中**，重复调用只聚焦不重开。
- 嵌入模式下右上角「↗ 浏览器页」一键跳出独立浏览器页面；底栏（吸附弹窗）则在标题栏提供「⤢ 全量显示」独立页入口；完整页提供「小窗」「底栏」两个嵌入入口。
- **在 ZCode 内（v1.5.9 吸附弹窗）**：安装插件市场中的 stepfun-usage-monitor 插件后，对 Agent 说「看看 token 用量」或输入 `/sfm`，即会在屏幕底部拉起吸附弹窗（`?layout=panel`，自动停靠）；弹窗内点「⤢ 全量显示」打开独立浏览器完整页。也可用 MCP 工具 `open_monitor_panel(mode="panel"\|"full")` 或命令行 `node bin/cli.mjs --panel [full]` 直接拉起。
- **在 VS Code 系 IDE 内**：安装方式二的扩展后，底边栏面板 / 小窗 / 浏览器三模式开箱即用。

## 界面交互性能与性能档位（v1.4.0）

仪表盘提供 **轻量 / 进阶 / 极致** 三档性能模式（档位栏位于自动刷新区域之外，选择持久化在浏览器 `localStorage`，支持键盘 ←/→ 切换）。**轻量档以「尽可能减少性能占用」为唯一目标**。

| | 轻量 | 进阶（默认） | 极致 |
|---|---|---|---|
| 轮询间隔 | **120 s** | 30 s | **10 s** |
| 数据载荷 | **`?lite=1` 精简** | 完整 | 完整 |
| 图表 | **不绘制 SVG**，仅文字摘要 | 完整柱状图 | 完整柱状图 |
| 排行榜 / 最近请求行数 | 5 / 6 | 8 / 10 | 12 / 20 |
| 动画 / 过渡 / 阴影 / 渐变 | **全部关闭** | 轻量过渡 | 数字滚动 + 入场 + 高亮 |
| 页面隐藏时 | **暂停轮询** | 暂停轮询 | 暂停轮询 |

轻量档的三重降载：① 前端关闭全部动画、过渡、阴影与渐变（CSS 层一次性短路，骨架屏退化为纯色块）；② 不构造 SVG 图表字符串、只输出文字摘要；③ 服务端以 `?lite=1` 只序列化 5+5+6 条记录、至多 14 天，显著降低 `JSON.stringify` 与前端解析成本。

除此之外，以下优化在**所有档位**生效：

- **点击零等待**：复制提示词等操作采用乐观 UI——按钮态与 Toast 同步立即呈现，异步工作后置，感知延迟为 0。
- **数据未变化时零 DOM 操作**：每次刷新做数据签名短路，轮询场景下最常见的「无新请求」路径不产生任何 DOM 写入。
- **原地增量更新**：`#app` 只挂载一次骨架，之后仅更新变化的文本 / 条宽 / SVG，不再整段重建 DOM。
- **让帧渲染**：数据到达后经 `requestAnimationFrame` 让出一帧再更新，交互响应优先。
- **等待动画**：首屏骨架 shimmer；请求超过 **350ms** 才显示顶部进度条与「同步中」指示（避免快请求时闪烁）。
- **后台零开销**：页面隐藏即清除定时器，回到前台且数据过期才补拉；`setTimeout` 链替代 `setInterval`，慢请求不堆叠。
- **无障碍**：系统开启「减少动态效果」（`prefers-reduced-motion`）时，即使选择极致档也会关闭全部动效。

## 性能（v1.1.0 第一轮优化实测）

基准环境：Windows / Node v22.12.0 / 20 万条历史（38.4 MB）/ 本机回环 mock 上游；对照组为 v1.0.1。复现命令：`npm run bench`。

| 指标 | v1.0.1 | v1.1.0 | 变化 |
|---|---|---|---|
| 冷启动可服务（/healthz 可响应） | 447 ms | **252 ms** | ↓44% |
| 全量历史就绪 | 447 ms | **379 ms** | ↓15% |
| 全量历史就绪（命中快照） | — | **227 ms** | ↓49% |
| 加载 20 万条后常驻内存 | 204 MB | **56 MB** | ↓73% |
| `/api/stats` 平均延迟 | 73.65 ms | **0.45 ms** | ↓99%（163×） |
| `/api/stats` 50 并发总耗时 | 3665 ms | **15 ms** | ↓99.6% |
| 300 并发吞吐 | 1277 req/s | **1456 req/s** | ↑14% |
| 300 并发 p95 延迟 | 224 ms | **199 ms** | ↓11% |
| 并发压测后内存 | 142 MB | **66 MB** | ↓54% |

优化手段（对应三类目标）：

**冷启动**
1. 先 `listen` 再后台加载历史——旧版必须同步解析完全部日志才能接受连接，新版启动即可服务，统计随后补齐。
2. 聚合快照 `aggregate.json`（含已消费的字节偏移）：重启时只读快照 + 回放尾部增量，不再全量重放；日志被截断/清空时自动回退全量重建。v1.5.5 起仅信任含 `byProvider` 的 v3+ 快照，旧版快照首次启动时自动全量重建。
3. **worker 线程并行回放**：按行边界把日志切成 N 段（默认 `min(CPU-1, 4)` 线程）并行聚合再合并；并行与顺序回放结果经逐字段校验完全一致（`npm run test:parity`），任一线程失败自动回退单线程。
4. 回放按行切分并定期让出事件循环，加载期间在途请求延迟不受影响；日键记忆化避免反复构造 `Date`。

**高内存**
1. 增量聚合（`Map` 桶）替代「全量记录数组」——内存从 O(记录数) 降为 O(桶数)。
2. 最近请求改用**定长环形缓冲**（默认 200 条），并消除 `Array.shift` 等 O(n) 操作。
3. 超过 `MAX_INJECT_BYTES`（默认 1MB）的请求体直接流式透传，不进入内存做注入/解析。
4. SSE 扫描缓冲上限 8KB；日志写入使用定长背压队列；RSS 超过软阈值自动裁剪缓冲并落盘快照。

**多任务并行**
1. `/api/stats` 直接读内存聚合（O(桶数)），旧版每次都要遍历全部历史（20 万条 ≈ 74 ms CPU 占用，并发轮询时相互争抢事件循环）。
2. 上游 keepAlive 连接池 + `maxSockets` 限流，避免并发下 socket 与文件描述符失控。
3. 仅在疑似包含 `usage` 的 SSE 帧上执行 `JSON.parse`（长流式对话可跳过 99% 以上的解析）。
4. 非流式请求跳过请求体 JSON 解析（模型名优先从响应体/SSE 帧获取）；非 JSON 响应零拷贝直通。

## 各 Agent 接入配置

| Agent | 配置位置 | Base URL 改为 |
|---|---|---|
| **ZCode** | 设置 → 模型服务 / 自定义模型（OpenAI 兼容） | `http://127.0.0.1:8787/v1` |
| Cline / Roo Code (VS Code) | 设置 → API Provider → OpenAI Compatible → Base URL | 同上 |
| Continue (VS Code/JetBrains) | `config.yaml` 中 provider `openai` 的 `apiBase` | 同上 |
| Cursor | Models → OpenAI API Key → Override Base URL | 同上 |
| Cherry Studio / ChatBox / LobeChat / Open WebUI | 模型服务 → 自定义提供商 → API 地址 | 同上 |
| Dify / FastGPT | 模型供应商 → OpenAI-API-compatible → API Base | 同上 |
| LangChain / LiteLLM / openai SDK | `OPENAI_BASE_URL` / `base_url` 参数 | 同上 |
| curl / 脚本 | `curl http://127.0.0.1:8787/v1/chat/completions ...` | 同上 |

> 通用原则：把客户端里 `https://api.stepfun.com` 替换为 `http://127.0.0.1:8787`，路径 `/v1/...` 与密钥都不变。
> 客户端可通过请求头 `X-Agent: 某名称` 自定义在仪表盘中显示的名称；未设置时按 User-Agent 自动识别。
> 想改用其他服务商（GLM / DeepSeek / Kimi 等）时，用仪表盘顶栏切换器一键切换，或用 `/p/<key>/v1/...` 路径前缀 / `X-Provider` 请求头按请求路由，详见「多服务商支持」。

## MCP 接入（ZCode / Claude Code 等，对话式查询）

在 Agent 的 MCP 配置（如 ZCode 的 `mcp.json`）中加入（推荐 npx 直载写法）：

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

手动安装等价写法：`"command": "node", "args": ["<本目录绝对路径>\\mcp-server.mjs"]`。

之后即可在对话中直接问：「查一下我最近 7 天的 StepFun token 用量，按模型分组」——Agent 会调用 `query_stepfun_usage(days=7, group="model")` 工具返回统计。v1.5.5 起 `group` 还支持 `"provider"`（按服务商分组）。v1.5.9 起还可让 Agent 调用 `open_monitor_panel(mode="panel"|"full")` 直接拉起屏幕底部吸附弹窗或独立浏览器完整页（代理未运行会自动拉起）。

## 环境变量（均可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 代理监听端口 |
| `TARGET_URL` | `https://api.stepfun.com` | 仅覆盖 StepFun 服务商的 baseUrl（兼容旧用法）；其他服务商请在 `providers.json` 中配置 |
| `DATA_DIR` | 按 `lib/paths.mjs` 解析 | 本地数据目录：显式指定最优先；npx 直载默认 `~/.stepfun-usage-monitor/`；手动安装检测到 `data/usage.jsonl` 时沿用原目录。`providers.json` 也存放在此 |
| `STEPFUN_API_KEY` | 无 | 设置后：客户端未带 Authorization 时自动注入 StepFun 密钥 |
| `GLM_API_KEY` / `BIGMODEL_API_KEY` | 无 | 智谱 GLM 密钥（任一即可） |
| `DEEPSEEK_API_KEY` | 无 | DeepSeek 密钥 |
| `MOONSHOT_API_KEY` / `KIMI_API_KEY` | 无 | Kimi Moonshot 密钥（任一即可） |
| `MINIMAX_API_KEY` | 无 | MiniMax 密钥 |
| `DASHSCOPE_API_KEY` | 无 | 通义千问 Qwen 密钥 |
| `YI_API_KEY` / `LINGYIWANWU_API_KEY` | 无 | 零一万物 Yi 密钥（任一即可） |
| `DISABLE_USAGE_INJECT` | 未设置 | 设为 `1` 关闭流式请求的 `stream_options.include_usage` 自动注入 |
| `SNAPSHOT_MS` | `20000` | 聚合快照落盘间隔（ms）；另有 ≥3s 节流落盘与加载完成即落盘 |
| `DISABLE_SNAPSHOT` | 未设置 | 设为 `1` 完全关闭快照（每次启动全量回放） |
| `REPLAY_WORKERS` | `min(CPU-1, 4)` | 并行回放线程数；`0`=单线程。数据 < 4MB 时自动走单线程 |
| `RECENT_MAX` | `200` | 最近请求环形缓冲条数（内存上限） |
| `MAX_SOCKETS` | `256` | 上游 keepAlive 连接池并发上限 |
| `MAX_INJECT_BYTES` | `1048576` | 请求体超过该字节数则跳过注入/解析，直接流式透传 |
| `MEMORY_SOFT_LIMIT_MB` | `384` | RSS 软阈值，超过则裁剪最近请求缓冲并落盘快照 |

> 说明：StepFun 遵循 OpenAI 规范，流式响应默认**不返回** usage，除非请求带 `stream_options.include_usage=true`。代理会自动为流式请求注入该字段（不产生任何计费影响）；若某上游不认该字段返回 400，代理会自动回退重发原始请求。
> 密钥注入优先级：`providers.json` 内的 `apiKey` > 上表所列环境变量；客户端自己带了 `Authorization` 时以客户端为准。

## 数据与隐私

- 数据文件：`<数据目录>/usage.jsonl`，每行一条记录，字段示例：

  ```json
  {"ts":"2026-09-22T00:30:12.345Z","agent":"ZCode/智谱","provider":"stepfun","path":"/v1/chat/completions","model":"step-2-16k","status":200,"prompt_tokens":120,"completion_tokens":80,"total_tokens":200,"latency_ms":812}
  ```

- **不记录**请求/响应正文、Authorization、API Key；仅记录时间、客户端、服务商、模型、token 数、状态码、耗时。
- `aggregate.json`：聚合快照（仅统计数字 + 已消费字节偏移），用于加速冷启动；删除后会自动全量重建。v1.5.0 及更早版本的旧快照会被忽略并按新格式重建。
- 备份：直接复制数据目录即可。清空：`POST http://127.0.0.1:8787/api/clear`。

## 本地接口一览

| 接口 | 说明 |
|---|---|
| `GET /` | 仪表盘完整页（每日柱状图、模型/客户端/服务商排行、最近请求、内存/连接数） |
| `GET /?layout=window` | 小窗布局（KPI + 图表） |
| `GET /?layout=panel` | 底部横条布局（超紧凑 KPI，走 lite 精简载荷） |
| `GET /` 仪表盘内 | 鹈鹕测试一键复制：点击「提示」按钮或提示文本复制测试提示词（桌面/移动端均可） |
| `GET /api/stats?days=30` | JSON 统计聚合（读内存聚合，O(桶数)；含 `byProvider` 分组与当前服务商信息） |
| `GET /api/stats?days=14&lite=1` | **精简载荷**：模型/客户端各 5 条、最近 6 条、至多 14 天（轻量档与底栏布局使用） |
| `GET /api/providers` | 服务商列表（key/名称/baseUrl/是否内置/是否已配密钥；**不含任何密钥**） |
| `POST /api/provider` | 一键切换激活服务商，body `{"key":"deepseek"}`；未知 key 返回 400 + 合法列表 |
| `GET /api/logs?limit=500` | 最近请求（环形缓冲，最多 `RECENT_MAX` 条） |
| `GET /healthz` | 健康检查（含 `loading` 标记与当前激活服务商，可用于等待历史加载完成） |
| `POST /api/snapshot` | 立即 flush 日志并落盘聚合快照 |
| `POST /api/clear` | 清空本地数据（明细 + 快照 + 内存聚合） |

## 文件结构

```
stepfun-usage-monitor/
├─ proxy.mjs           核心：本地反代 + usage 解析 + 增量聚合 + 快照 + 仪表盘服务（零依赖）
├─ bin/cli.mjs         统一 CLI 入口：默认代理模式 / --mcp 模式（npx 直载入口）
├─ lib/paths.mjs       数据目录解析（npx 直载 / 手动安装统一规则）
├─ lib/providers.mjs   多服务商注册表与四级路由（v1.5.5）
├─ lib/replay-worker.mjs  历史并行回放 worker（worker_threads）
├─ lib/open-panel.mjs  吸附弹窗 / 独立浏览器页拉起器（v1.5.9；MCP open_monitor_panel 与 --panel 共用）
├─ dashboard.html      仪表盘页面（纯本地，无任何 CDN 外链；支持 ?layout= 三种布局 + 服务商切换器 + 底栏「全量显示」按钮）
├─ mcp-server.mjs      MCP Server：Agent 对话式查询用量 + 拉起吸附弹窗（v1.5.9）
├─ stats.mjs           终端报表：node stats.mjs [天数]
├─ start.cmd           一键启动（Windows 双击即可）
├─ open-window.cmd     小窗启动器（Chrome/Edge --app 无边框窗口）
├─ open-panel.cmd      底部横条启动器
├─ marketplace.json    ZCode 插件市场清单（v1.5.9）
├─ plugins/stepfun-usage-monitor/   ZCode 官方插件目录（v1.5.9）
│  ├─ .zcode-plugin/plugin.json  插件清单（name/version/commands/mcpServers…）
│  ├─ commands/sfm.md            标准命令（/sfm：查询用量 + 拉起吸附弹窗）
│  └─ .mcp.json                  stdio MCP 服务器定义（${CLAUDE_PLUGIN_ROOT}）
├─ ide-extension/      VS Code 系扩展（底边栏/小窗/浏览器三模式 + 状态栏）
│  ├─ package.json / extension.js / media/chart.svg
│  ├─ test/build-vsix.mjs 引用其产出 → dist/stepfun-monitor-1.5.9.vsix
│  └─ dist/stepfun-monitor-1.5.9.vsix  可直接安装
├─ docs/releases/      各版本双语 Release Notes（中文 + English）
├─ data/usage.jsonl    用量明细（追加写，首次运行自动创建；手动安装默认位置）
├─ data/aggregate.json 聚合快照（自动生成，可删除）
├─ data/providers.json 服务商配置（可选；npx 直载时位于 ~/.stepfun-usage-monitor/）
├─ demo-data/          演示数据（`npm run seed` 生成，仅用于预览仪表盘，可随时删除）
└─ test/               测试 / 基准脚本
   ├─ run-e2e.mjs          端到端测试（mock 上游 + 流式/非流式/回退用例）
   ├─ mock-upstream.mjs    模拟 StepFun 上游（支持 MOCK_DELAY 模拟推理延迟）
   ├─ mcp-test.mjs         MCP 协议一致性测试
   ├─ verify-ui.mjs        仪表盘 / CLI 报表校验
   ├─ ui-perf-check.mjs    v1.4.0 交互性能 / 3 档性能模式的静态断言与载荷实测
   ├─ ui-feature-check.mjs v1.3.0 鹈鹕测试一键复制的静态断言
   ├─ v15-check.mjs        v1.5.9 多服务商/直载/布局/扩展/数据目录/ZCode 插件结构/吸附弹窗断言（静态+运行时）
   ├─ npm-pack-check.mjs   v1.5.0 npx 直载链路验证（npm pack → 安装 → 双模式运行，15 项）
   ├─ build-vsix.mjs       零依赖 VSIX 打包（ZIP 写入 + CRC32 + 自校验）
   ├─ browser-smoke.mjs    真实浏览器运行时校验（CDP 驱动本机 Chrome/Edge，含三种布局/三档性能/服务商切换/底栏全量显示按钮）
   ├─ replay-parity.mjs    并行回放 vs 顺序回放一致性校验
   ├─ bench.mjs            性能基准（冷启动 / 内存 / 并发，输出 bench-result.txt）
   ├─ seed-demo.mjs        生成演示数据
   └─ cleanup.mjs          清理测试残留
```

## 测试与验证

```bat
node test/run-e2e.mjs                 :: 端到端：非流式/流式 usage 解析、stream_options 注入与回退、密钥不入库
node test/mcp-test.mjs                :: MCP：initialize / tools/list / tools/call / 未知方法错误码
node test/verify-ui.mjs               :: 仪表盘可访问性与 CLI 报表格式
node test/ui-perf-check.mjs           :: 3 档性能模式、等待动画、lite 精简载荷断言
node test/ui-feature-check.mjs        :: 鹈鹕测试一键复制的静态断言
node test/v15-check.mjs               :: v1.5.9：多服务商路由/切换/byProvider、GitHub 直载、三种布局、ZCode 插件结构、吸附弹窗、扩展、数据目录（静态+运行时）
node test/npm-pack-check.mjs          :: v1.5.0：npm pack → tarball 安装 → bin 双模式真实运行（15 项）
node test/build-vsix.mjs              :: 构建 VSIX（ide-extension/dist/）
node test/browser-smoke.mjs           :: 真实浏览器运行时校验，含三种布局、三档性能与服务商切换（需本机 Chrome 或 Edge）
node test/replay-parity.mjs           :: 并行回放 vs 顺序回放：聚合结果逐字段一致性（需先跑 bench）
node test/bench.mjs                   :: 性能基准（生成 20 万条数据，输出 test/bench-result.txt）
node test/seed-demo.mjs demo-data     :: 重新生成演示数据
```

预览仪表盘效果（使用演示数据、不影响真实记录）：

```bat
set PORT=8787 && set DATA_DIR=demo-data && node proxy.mjs
```

## 常见问题

- **想让 Agent 直接在屏幕底部显示用量（v1.5.9）**：安装 ZCode 插件市场中的 stepfun-usage-monitor 插件，输入 `/sfm`（或对 Agent 说「打开用量监控弹窗」）即拉起吸附弹窗；点弹窗内「⤢ 全量显示」看完整仪表盘。命令行等价写法：`node bin/cli.mjs --panel [full]`。
- **端口被占用**：设置 `PORT=8788` 后重启，客户端 Base URL 同步修改。
- **流式对话没统计到 tokens**：确认未设置 `DISABLE_USAGE_INJECT=1`；个别极老客户端自行剥离了 `stream_options`，可在客户端设置里开启「统计用量/usage」类选项。
- **想同时统计其他服务商（GLM / DeepSeek / Kimi…）**：无需再起第二个实例——在仪表盘顶栏切换器一键切换激活服务商；或按请求用 `/p/<key>/v1/...` 路径前缀、`X-Provider: <key>` 请求头路由；也可在 `providers.json` 里添加自定义网关。详见「多服务商支持」。
- **同一数据目录不要多实例同时写**：快照的字节偏移假设单写者；多实例请用不同 `DATA_DIR`。
- **npx 直载和手动安装的数据在哪**：npx 直载默认 `~/.stepfun-usage-monitor/`；手动安装沿用仓库 `data/`（存在历史数据时）。两者混用请显式设置 `DATA_DIR` 统一。
- **强制退出（直接关闭窗口）会丢最后几秒明细**：快照每 ≥3s 节流落盘，重启后仅需回放极短尾部；正常关闭（Ctrl+C）会立即落盘。
- **从 v1.5.0 升级后服务商用量表是空的**：旧版快照不含按服务商的分组数据，首次启动会自动全量回放重建（一次性），之后恢复正常。
- **历史很大时想更快**：调大 `REPLAY_WORKERS`（默认 4）；或保留 `aggregate.json` 让下次启动走快照路径。
- **性能**：20 万条历史下常驻内存约 56MB、`/api/stats` 约 0.45ms、300 并发吞吐约 1456 req/s；单请求额外开销 < 1ms（不含网络）。详见 `npm run bench` 输出。
