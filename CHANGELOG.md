# 更新日志

> 各版本的完整双语 Release Notes 见 [`docs/releases/`](docs/releases/)（中文 + English）。

## v1.5.5（多服务商支持 + 服务商一键切换）

### 新增
- **多服务商支持**：内置 7 家 OpenAI 兼容服务商（StepFun / 智谱 GLM / DeepSeek / Kimi Moonshot / MiniMax / 通义千问 Qwen / 零一万物 Yi）；数据目录放置 `providers.json` 可添加任意自定义 OpenAI 兼容网关，或按 key 覆盖内置服务商的 `baseUrl` / `apiKey` / `modelPrefixes`。
- **四级路由优先级**（前一级命中即不再向下匹配）：路径前缀 `/p/<key>/v1/...`（转发时自动剥除前缀）> 请求头 `X-Provider: <key>` > 模型名前缀（`modelPrefixes`）> 激活默认；未知 key 返回 400 + 合法服务商列表，不静默落默认。
- **密钥按服务商注入**：客户端未带 `Authorization` 时按 `providers.json` apiKey > 环境变量注入（`STEPFUN_API_KEY` / `GLM_API_KEY` / `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` / `MINIMAX_API_KEY` / `DASHSCOPE_API_KEY` / `YI_API_KEY`）；`TARGET_URL` 仍仅覆盖 StepFun（旧用法有效）。
- **仪表盘服务商切换器**：顶栏一键切换（乐观 UI + 失败回滚），激活项持久化 `providers.json`；新增服务商用量表面板与页脚当前服务商显示；底栏布局隐藏切换器、小窗布局隐藏服务商表。
- **统计与查询**：`usage.jsonl` 记录新增 `provider` 字段（旧记录归入 stepfun，向后兼容）；`/api/stats` 新增 `byProvider` 与 `meta.provider` / `meta.providers`；MCP `query_stepfun_usage` 支持 `group="provider"`；新增 `GET /api/providers` 与 `POST /api/provider`。
- VSIX 扩展重建为 `stepfun-monitor-1.5.5.vsix`；并行回放按服务商聚合。
- 测试：`test/v15-check.mjs` 扩充为 76 项静态+运行时断言（多服务商路由/切换/byProvider）；`browser-smoke` 增至 60 项（含切换器真机断言）。

### 修复
- **升级路径快照兼容**：v1.5.0 及更早版本的 `aggregate.json` 快照不含 `byProvider` 字段，直接沿用会导致服务商分组统计为空。现仅信任 v3+ 快照；对「请求数 > 0 但 byProvider 为空」的损坏快照自动全量回放重建（一次性开销）。

## v1.5.0（GitHub URL 直载 + 三种浏览布局 + VS Code 系扩展）

### 新增
- **GitHub URL 直载**：`npx -y github:Neriah-Ado/stepfun-usage-monitor` 免 clone 免安装直接拉起；`bin/cli.mjs` 统一入口支持默认代理模式与 `--mcp` 模式，及 `--port` / `--data-dir` / `--version` / `--help`。
- **统一数据目录解析**（`lib/paths.mjs`，proxy / mcp-server / stats 三入口一致）：`DATA_DIR` > `~/.stepfun-usage-monitor/` > 包内 `data/`（历史数据原地兼容）。npx 运行时数据不再落入 npm 缓存目录。
- **仪表盘三种浏览布局**：`?layout=full|window|panel`——完整页 / 小窗（KPI+图表）/ 底部横条（超紧凑 KPI，走 lite 精简载荷，整页高约 220px）；head 内联脚本先于样式写入 `data-layout`，杜绝嵌入模式 FOUC；三种布局右上角一键互切，嵌入模式提供「↗ 浏览器页」独立页入口。
- **小窗 / 底栏启动器**：`open-window.cmd`（Chrome/Edge `--app` 无边框窗口）、`open-panel.cmd`。
- **VS Code 系 IDE 扩展**（`ide-extension/`）：底边栏 Webview 面板 / 小窗编辑器 / 独立浏览器三命令 + 状态栏今日 tokens + 代理未运行自动 npx 拉起；附零依赖 VSIX 打包器（`test/build-vsix.mjs`，ZIP+CRC32+自校验），产物 `ide-extension/dist/stepfun-monitor-1.5.0.vsix`。
- **ZCode 原生命令**：`zcode/command-sfm.md` 提供 `/sfm` 对话式查询指令。
- 测试：`test/v15-check.mjs`（40 项静态+运行时）、`test/npm-pack-check.mjs`（npm pack → tarball 安装 → bin 双模式真实运行，15 项）；browser-smoke 新增三种布局 17 项真机断言（总 51 项）。

### 修复
- `/?layout=window`、`/?layout=panel` 等带查询串的根路径此前会穿透到上游（路由仅匹配 `url === '/'`），现按 pathname 匹配本地路由。

### 文档
- README 安装章节重写为三轨：方式一 GitHub URL 直载（含 ZCode / Claude Code / Cline / Cursor 的 MCP 配置片段）、方式二 VSIX 扩展、方式三手动安装（保留）；新增「仪表盘的三种浏览方式」章节。

## v1.4.0（交互性能优化 + 轻量 / 进阶 / 极致 3 档性能模式）

面向**点击响应延迟**、**交互性能**与**可配置的性能占用**做专项优化。代理端与数据格式保持向后兼容。

### 1. 降低点击响应延迟
- **乐观 UI**：点击「提示」/提示词芯片时，按钮变绿与 Toast 反馈**同步立即执行**，剪贴板写入等异步动作全部后置，感知延迟由「等剪贴板 API 返回」降为 0；仅在真正失败时才回滚为错误提示。
- **单飞（single-flight）**：手动刷新与轮询共用一次在途请求，杜绝并发请求互相抢占事件循环。
- **渲染让帧**：数据到达后先用 `requestAnimationFrame` 让出一帧再执行 DOM 更新，点击等交互永远优先响应。
- **档位切换同步生效**：性能档位通过 `html[data-perf]` 属性同步写入，CSS 立即重建样式，不等待任何请求往返。

### 2. 提升交互性能（渲染路径重写）
- **一次性骨架 + 原地增量更新**：`#app` 不再整段 `innerHTML` 重建；骨架只挂载一次，后续仅写入变化的文本、条宽与 SVG。
- **签名短路**：每次刷新计算数据签名，**数据未变化时零 DOM 操作**（仅更新「更新于」时间戳）——这是轮询场景下最常见、也最耗 CPU 的路径。
- **分表短路**：模型排行 / 客户端排行 / 最近请求各自独立签名，互不牵连重绘。
- **图表按需重算**：SVG 字符串只在每日序列变化时重新构造。
- **避免强制布局**：`contain: content` 限定重排范围；最近请求面板使用 `content-visibility: auto` 跳过屏外渲染。
- **数字更新零开销**：`setNum()` 在数值未变时直接返回，不触发任何 DOM 写入与动画。

### 3. 新增卡顿等待动画
- **首屏骨架屏**：加载中数值位显示 shimmer 骨架，替代空白闪烁。
- **顶部不确定进度条**：仅当请求超过 **350ms**（即真正出现「卡顿」）才出现，避免快请求时进度条闪一下的视觉噪声。
- **同步指示**：请求进行中在档位栏显示「同步中…」微指示。
- **轻量档位降级**：以上动效在「轻量」档位全部禁用，退化为纯文本提示（零动画开销）。
- **系统级尊重**：`prefers-reduced-motion: reduce` 时，即使选择「极致」档也关闭全部动效。

### 4. 新增 3 档性能模式
档位栏位于 `#app` 之外（自动刷新不会重建），选择持久化于 `localStorage['sfm:perf']`，支持键盘 ←/→ 切换。

| | 轻量 | 进阶（默认） | 极致 |
|---|---|---|---|
| 轮询间隔 | **120 s** | 30 s | **10 s** |
| 数据载荷 | **`?lite=1` 精简**（模型/客户端各 5 条、最近 6 条、至多 14 天） | 完整（各 50 条 / 最近 50 条 / 30 天） | 完整（同进阶） |
| 图表 | **不绘制 SVG**，仅文字摘要（近 7 日合计 / 环比 / 单日峰值） | 完整柱状图 | 完整柱状图 |
| 排行榜行数 | 5 | 8 | 12 |
| 最近请求 | 6 | 10 | 20 |
| 动画 / 过渡 / 阴影 / 渐变 | **全部关闭** | 轻量过渡 | 数字滚动 + 入场 + 数值高亮 |
| Toast / 骨架 / 进度条 | 无（纯文本） | 静态提示 + 350ms 进度条 | 同进阶 |

- **页面隐藏即暂停**：`visibilitychange` 时清除定时器，回到前台且数据过期才立即补拉——后台标签页零轮询、零 CPU。
- **改为 `setTimeout` 链**：不再使用 `setInterval`，慢请求不会造成定时器堆叠。
- **离线暂停**：`offline` 事件时暂停轮询并给出提示。

### 5. 代理端（lite 精简载荷）
- `GET /api/stats?lite=1` 返回精简结果（`byModel`/`byAgent` 各 5 条、`recent` 6 条、天数上限 14），`meta.mode = "lite"`；减少 `JSON.stringify`、网络传输与前端解析开销。
- 新增 `meta.ts` 服务端时间戳；版本号同步为 1.4.0。

## v1.3.0（仪表盘：鹈鹕测试提示词一键复制）

仪表盘新增「鹈鹕测试（Pelican Test）」快捷入口：

- 新增**「提示」按钮**与**可点击的提示文本**（提示词芯片「画一只骑自行车的鹈鹕」），点击任一者即把测试提示词复制到剪贴板。
- 复制成功显示明确的视觉反馈：绿色「已复制：…」Toast + 按钮短暂变绿；失败显示红色错误 Toast（如「浏览器未授权剪贴板访问」）。
- **兼容性**：优先使用 `navigator.clipboard`（需安全上下文，`127.0.0.1` 属于安全上下文）；非 HTTPS / 旧 WebView 环境自动回退到隐藏 `textarea` + `execCommand('copy')`（iOS 下设置 `setSelectionRange`），并还原用户原有选区，不干扰页面其他交互。
- **不影响其他功能**：提示面板与 Toast 位于 `#app` 容器之外，30 秒自动刷新的整体重绘不会重建它们，事件监听器全程有效；复制为纯前端动作，不产生任何 API 请求。
- **移动端适配**：≥40px 触控目标、`touch-action: manipulation` 消除 300ms 延迟、`-webkit-tap-highlight-color: transparent`、`user-select: none` 防长按选中、面板自动换行。
- 代理版本号同步为 1.3.0（`/healthz` 与仪表盘页脚可见）。

## v1.1.0（第一轮性能优化）

针对**冷启动**、**高内存占用**、**多任务并行**三类场景做专项优化，功能与数据格式保持向后兼容（旧 `usage.jsonl` 可直接沿用，首次启动会自动重建聚合）。

### 冷启动
- 服务先 `listen`、历史后台增量加载：启动即可服务，不再像 v1.0.1 那样必须同步解析完整个日志才能接受连接。
- 新增聚合快照 `data/aggregate.json`（含已消费字节偏移）：重启只读快照 + 回放尾部增量；日志被截断/清空时自动回退全量重建。
- 新增 worker 线程并行回放（`lib/replay-worker.mjs`）：按行边界切段并行聚合再合并，默认 `min(CPU-1, 4)` 线程；并行与顺序结果逐字段一致（`npm run test:parity`），任一线程失败自动回退单线程。
- 回放按行切分并定期让出事件循环；日键记忆化避免重复构造 `Date`。

### 高内存
- 增量聚合（`Map` 桶）替代全量记录数组：内存从 O(记录数) 降为 O(桶数)。
- 最近请求改为定长环形缓冲（`RECENT_MAX`，默认 200 条），消除 `Array.shift` 等 O(n) 操作。
- 请求体超过 `MAX_INJECT_BYTES`（默认 1MB）直接流式透传，不进入内存做注入/解析。
- SSE 扫描缓冲上限由 64KB 降至 8KB；日志写入改为定长背压队列；RSS 超过 `MEMORY_SOFT_LIMIT_MB` 自动裁剪缓冲并落盘。

### 多任务并行
- `/api/stats` 改为读取内存聚合（O(桶数)），v1.0.1 每次调用都要遍历全部历史。
- 上游 keepAlive 连接池 + `MAX_SOCKETS` 限流。
- 仅在疑似含 `usage` 的 SSE 帧上执行 `JSON.parse`；非流式请求跳过请求体 JSON 解析；非 JSON 响应零拷贝直通。

### 新增接口与运维
- `GET /healthz` 返回 `loading` 标记；`POST /api/snapshot` 立即落盘快照；`/api/logs` 返回环形缓冲内的最近请求。
- 仪表盘新增内存占用、在用连接数、运行时长与版本信息，并显示历史加载进度提示。

### 实测（Windows / Node 22.12 / 20 万条 38.4MB 历史）
| 指标 | v1.0.1 | v1.1.0 |
|---|---|---|
| 冷启动可服务 | 447 ms | 252 ms |
| 全量历史就绪 | 447 ms | 379 ms（命中快照 227 ms） |
| 常驻内存 | 204 MB | 56 MB |
| `/api/stats` 平均 | 73.65 ms | 0.45 ms |
| `/api/stats` 50 并发 | 3665 ms | 15 ms |
| 300 并发吞吐 | 1277 req/s | 1456 req/s |

## v1.0.1（首个公开发布版本）
- 本地反向代理接入，兼容任意 OpenAI 兼容客户端；流式/非流式 usage 解析；流式请求自动注入 `stream_options.include_usage` 并在上游拒绝时自动回退重发。
- 本地 JSONL 存储、本地仪表盘（无 CDN 外链）、终端报表、MCP 查询工具（`query_stepfun_usage`）。
- 不记录请求/响应正文与 API Key。
