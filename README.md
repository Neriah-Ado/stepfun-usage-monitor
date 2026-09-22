# stepfun-usage-monitor — StepFun API Token 用量本地监控插件

统计 StepFun API（阶跃星辰，OpenAI 兼容接口）的 Token 用量。**零 npm 依赖、常驻内存通常 < 60MB、所有数据仅存本地**，通过「本地反向代理」方式接入，因此天然兼容几乎所有 Agent / 客户端。

## 架构

```
┌─────────────┐   Base URL 指向本地    ┌────────────────────────┐   转发(透传)   ┌──────────────────┐
│  ZCode      │ ────────────────────▶ │  本地代理 proxy.mjs     │ ────────────▶ │ api.stepfun.com  │
│  Cline      │  127.0.0.1:8787/v1/…  │  · 流式/非流式解析usage  │  原样返回      │                  │
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
- **全本地**：用量逐条追加写入 `data/usage.jsonl`（每行一条 JSON，崩溃安全）；聚合快照 `data/aggregate.json` 仅含统计数字，不含密钥与请求正文。

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
2. 聚合快照 `aggregate.json`（含已消费的字节偏移）：重启时只读快照 + 回放尾部增量，不再全量重放；日志被截断/清空时自动回退全量重建。
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


## 快速开始

1. 确认已安装 Node.js ≥ 18（无需 `npm install`，零依赖）。
2. 双击 `start.cmd`（或在终端运行 `node proxy.mjs`），看到：

   ```
   监听地址   : http://127.0.0.1:8787
   仪表盘     : http://127.0.0.1:8787/
   数据文件   : ...\data\usage.jsonl
   ```

3. 在 Agent 里把 StepFun 的 Base URL 从 `https://api.stepfun.com/v1` 改为 `http://127.0.0.1:8787/v1`（API Key 填原来的 StepFun Key，保持不变）。
4. 打开 `http://127.0.0.1:8787/` 查看仪表盘；或运行 `node stats.mjs 7` 看终端报表。

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

## MCP 接入（ZCode / Claude Code 等，对话式查询）

在 Agent 的 MCP 配置（如 ZCode 的 `mcp.json`）中加入：

```json
{
  "mcpServers": {
    "stepfun-usage": {
      "command": "node",
      "args": ["<本目录绝对路径>\\mcp-server.mjs"]
    }
  }
}
```

之后即可在对话中直接问：「查一下我最近 7 天的 StepFun token 用量，按模型分组」——Agent 会调用 `query_stepfun_usage(days=7, group="model")` 工具返回统计。

## 环境变量（均可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 代理监听端口 |
| `TARGET_URL` | `https://api.stepfun.com` | 上游地址（也可指向其他 OpenAI 兼容服务商做多服务商统计） |
| `DATA_DIR` | `./data` | 本地数据目录 |
| `STEPFUN_API_KEY` | 无 | 设置后：客户端未带 Authorization 时自动注入（客户端可不配 Key） |
| `DISABLE_USAGE_INJECT` | 未设置 | 设为 `1` 关闭流式请求的 `stream_options.include_usage` 自动注入 |
| `SNAPSHOT_MS` | `20000` | 聚合快照落盘间隔（ms）；另有 ≥3s 节流落盘与加载完成即落盘 |
| `DISABLE_SNAPSHOT` | 未设置 | 设为 `1` 完全关闭快照（每次启动全量回放） |
| `REPLAY_WORKERS` | `min(CPU-1, 4)` | 并行回放线程数；`0`=单线程。数据 < 4MB 时自动走单线程 |
| `RECENT_MAX` | `200` | 最近请求环形缓冲条数（内存上限） |
| `MAX_SOCKETS` | `256` | 上游 keepAlive 连接池并发上限 |
| `MAX_INJECT_BYTES` | `1048576` | 请求体超过该字节数则跳过注入/解析，直接流式透传 |
| `MEMORY_SOFT_LIMIT_MB` | `384` | RSS 软阈值，超过则裁剪最近请求缓冲并落盘快照 |

> 说明：StepFun 遵循 OpenAI 规范，流式响应默认**不返回** usage，除非请求带 `stream_options.include_usage=true`。代理会自动为流式请求注入该字段（不产生任何计费影响）；若某上游不认该字段返回 400，代理会自动回退重发原始请求。

## 数据与隐私

- 数据文件：`data/usage.jsonl`，每行一条记录，字段示例：

  ```json
  {"ts":"2026-09-22T00:30:12.345Z","agent":"ZCode/智谱","path":"/v1/chat/completions","model":"step-2-16k","status":200,"prompt_tokens":120,"completion_tokens":80,"total_tokens":200,"latency_ms":812}
  ```

- **不记录**请求/响应正文、Authorization、API Key；仅记录时间、客户端、模型、token 数、状态码、耗时。
- `data/aggregate.json`：聚合快照（仅统计数字 + 已消费字节偏移），用于加速冷启动；删除后会自动全量重建。
- 备份：直接复制 `data/` 目录即可。清空：`POST http://127.0.0.1:8787/api/clear`。

## 本地接口一览

| 接口 | 说明 |
|---|---|
| `GET /` | 仪表盘（每日柱状图、模型/客户端排行、最近请求、内存/连接数） |
| `GET /` 仪表盘内 | 鹈鹕测试一键复制：点击「提示」按钮或提示文本复制测试提示词（桌面/移动端均可） |
| `GET /api/stats?days=30` | JSON 统计聚合（读内存聚合，O(桶数)） |
| `GET /api/stats?days=14&lite=1` | **精简载荷**：模型/客户端各 5 条、最近 6 条、至多 14 天（v1.4.0 轻量档位使用） |
| `GET /api/logs?limit=500` | 最近请求（环形缓冲，最多 `RECENT_MAX` 条） |
| `GET /healthz` | 健康检查（含 `loading` 标记，可用于等待历史加载完成） |
| `POST /api/snapshot` | 立即 flush 日志并落盘聚合快照 |
| `POST /api/clear` | 清空本地数据（明细 + 快照 + 内存聚合） |

## 文件结构

```
stepfun-usage-monitor/
├─ proxy.mjs           核心：本地反代 + usage 解析 + 增量聚合 + 快照 + 仪表盘服务（零依赖）
├─ lib/replay-worker.mjs  历史并行回放 worker（worker_threads）
├─ dashboard.html      仪表盘页面（纯本地，无任何 CDN 外链）
├─ mcp-server.mjs      MCP Server：Agent 对话式查询用量
├─ stats.mjs           终端报表：node stats.mjs [天数]
├─ start.cmd           一键启动（Windows 双击即可）
├─ data/usage.jsonl    用量明细（追加写，首次运行自动创建）
├─ data/aggregate.json 聚合快照（自动生成，可删除）
├─ demo-data/          演示数据（`npm run seed` 生成，仅用于预览仪表盘，可随时删除）
└─ test/               测试 / 基准脚本
   ├─ run-e2e.mjs          端到端测试（mock 上游 + 流式/非流式/回退用例）
   ├─ mock-upstream.mjs    模拟 StepFun 上游（支持 MOCK_DELAY 模拟推理延迟）
   ├─ mcp-test.mjs         MCP 协议一致性测试
   ├─ verify-ui.mjs        仪表盘 / CLI 报表校验
   ├─ ui-perf-check.mjs    v1.4.0 交互性能 / 3 档性能模式的静态断言与载荷实测
   ├─ browser-smoke.mjs    v1.4.0 真实浏览器运行时校验（CDP 驱动本机 Chrome/Edge，零依赖，附三档截图）
   ├─ ui-feature-check.mjs v1.3.0 鹈鹕测试一键复制的静态断言
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
node test/ui-perf-check.mjs           :: v1.4.0：3 档性能模式、等待动画、lite 精简载荷断言
node test/browser-smoke.mjs           :: v1.4.0：真实浏览器运行时校验（需本机安装 Chrome 或 Edge）
node test/ui-feature-check.mjs        :: v1.3.0：鹈鹕测试一键复制的静态断言
node test/replay-parity.mjs           :: 并行回放 vs 顺序回放：聚合结果逐字段一致性
node test/bench.mjs                   :: 性能基准（生成 20 万条数据，输出 test/bench-result.txt）
node test/seed-demo.mjs demo-data     :: 重新生成演示数据
```

预览仪表盘效果（使用演示数据、不影响真实记录）：

```bat
set PORT=8787 && set DATA_DIR=demo-data && node proxy.mjs
```

## 常见问题

- **端口被占用**：设置 `PORT=8788` 后重启，客户端 Base URL 同步修改。
- **流式对话没统计到 tokens**：确认未设置 `DISABLE_USAGE_INJECT=1`；个别极老客户端自行剥离了 `stream_options`，可在客户端设置里开启「统计用量/usage」类选项。
- **想同时统计其他服务商**：另起一个实例，例如 `set TARGET_URL=https://api.moonshot.cn && set PORT=8788 && node proxy.mjs`，数据目录可用 `DATA_DIR` 分开。
- **同一数据目录不要多实例同时写**：快照的字节偏移假设单写者；多实例请用不同 `DATA_DIR`。
- **强制退出（直接关闭窗口）会丢最后几秒明细**：快照每 ≥3s 节流落盘，重启后仅需回放极短尾部；正常关闭（Ctrl+C）会立即落盘。
- **历史很大时想更快**：调大 `REPLAY_WORKERS`（默认 4）；或保留 `aggregate.json` 让下次启动走快照路径。
- **性能**：20 万条历史下常驻内存约 56MB、`/api/stats` 约 0.45ms、300 并发吞吐约 1456 req/s；单请求额外开销 < 1ms（不含网络）。详见 `npm run bench` 输出。
