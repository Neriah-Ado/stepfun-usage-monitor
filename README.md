# stepfun-usage-monitor — StepFun API Token 用量本地监控插件

统计 StepFun API（阶跃星辰，OpenAI 兼容接口）的 Token 用量。**零 npm 依赖、常驻内存 < 30MB、所有数据仅存本地**，通过「本地反向代理」方式接入，因此天然兼容几乎所有 Agent / 客户端。

## 架构

```
┌─────────────┐   Base URL 指向本地    ┌──────────────────────┐   转发(透传)   ┌──────────────────┐
│  ZCode      │ ────────────────────▶ │  本地代理 proxy.mjs   │ ────────────▶ │ api.stepfun.com  │
│  Cline      │  127.0.0.1:8787/v1/…  │  · 流式/非流式解析usage │  原样返回      │                  │
│  Continue … │ ◀──────────────────── │  · 追加写 usage.jsonl  │ ◀──────────── │                  │
└─────────────┘                       │  · 仪表盘 + 统计API    │               └──────────────────┘
                                      └──────────┬───────────┘
                                                 │ 读取(只读)
                                    ┌────────────┴────────────┐
                                    │ data/usage.jsonl (本地)  │◀── mcp-server.mjs（Agent 对话查询）
                                    └─────────────────────────┘
```

- **兼容性**：任何支持自定义 OpenAI 兼容 Base URL 的客户端均可接入（ZCode、Cline、Roo Code、Continue、Cursor、Cherry Studio、ChatBox、LobeChat、Open WebUI、Dify、LangChain/LiteLLM、openai-python/node SDK 等）；支持 MCP 的 Agent（ZCode 等）还可通过内置 MCP Server 直接对话查询。
- **低开销**：Node 单进程、流式响应逐字节直通（旁路扫描 usage，不缓冲不落盘中间数据），无数据库、无 Electron、无后台轮询。
- **全本地**：用量逐条追加写入 `data/usage.jsonl`（每行一条 JSON，崩溃安全）；不采集、不存储 API 密钥，Authorization 头仅透传。

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

> 说明：StepFun 遵循 OpenAI 规范，流式响应默认**不返回** usage，除非请求带 `stream_options.include_usage=true`。代理会自动为流式请求注入该字段（不产生任何计费影响）；若某上游不认该字段返回 400，代理会自动回退重发原始请求。

## 数据与隐私

- 数据文件：`data/usage.jsonl`，每行一条记录，字段示例：

  ```json
  {"ts":"2026-09-22T00:30:12.345Z","agent":"ZCode/智谱","path":"/v1/chat/completions","model":"step-2-16k","status":200,"prompt_tokens":120,"completion_tokens":80,"total_tokens":200,"latency_ms":812}
  ```

- **不记录**请求/响应正文、Authorization、API Key；仅记录时间、客户端、模型、token 数、状态码、耗时。
- 备份：直接复制 `data/` 目录即可。清空：`POST http://127.0.0.1:8787/api/clear`。

## 本地接口一览

| 接口 | 说明 |
|---|---|
| `GET /` | 仪表盘（每日柱状图、模型/客户端排行、最近请求） |
| `GET /api/stats?days=30` | JSON 统计聚合 |
| `GET /api/logs?days=7&limit=500` | 原始记录 |
| `GET /healthz` | 健康检查 |
| `POST /api/clear` | 清空本地数据 |

## 文件结构

```
stepfun-usage-monitor/
├─ proxy.mjs           核心：本地反代 + usage 解析 + 本地存储 + 仪表盘服务（零依赖）
├─ dashboard.html      仪表盘页面（纯本地，无任何 CDN 外链）
├─ mcp-server.mjs      MCP Server：Agent 对话式查询用量
├─ stats.mjs           终端报表：node stats.mjs [天数]
├─ start.cmd           一键启动（Windows 双击即可）
├─ data/usage.jsonl    真实用量数据（首次运行自动创建）
├─ demo-data/          演示数据（仅用于预览仪表盘效果，可随时删除）
└─ test/               测试与验证脚本
   ├─ run-e2e.mjs          端到端测试（mock 上游 + 流式/非流式/回退用例）
   ├─ mock-upstream.mjs    模拟 StepFun 上游
   ├─ mcp-test.mjs         MCP 协议一致性测试
   ├─ verify-ui.mjs        仪表盘 / CLI 报表校验
   ├─ seed-demo.mjs        生成演示数据
   └─ cleanup.mjs          清理测试残留
```

## 测试与验证

```bat
node test/run-e2e.mjs                 :: 端到端：非流式/流式 usage 解析、stream_options 注入与回退、密钥不入库
node test/mcp-test.mjs                :: MCP：initialize / tools/list / tools/call / 未知方法错误码
node test/verify-ui.mjs               :: 仪表盘可访问性与 CLI 报表格式
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
- **性能**：实测单请求额外开销 < 1ms（不含网络），内存占用稳定在 30MB 以内（20 万条记录上限自动裁剪）。
