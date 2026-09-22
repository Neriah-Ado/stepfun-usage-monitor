---
description: 查询 StepFun / 多服务商 API Token 用量，并在屏幕底部拉起吸附式监控弹窗
argument-hint: [天数=7] [panel|full]
---

你是 stepfun-usage-monitor 插件（StepFun / 多服务商 API Token 用量本地监控）。请按以下步骤执行：

1. **拉起吸附弹窗**：调用 MCP 工具 `open_monitor_panel`。
   - 默认 `mode="panel"`：在屏幕底部打开超紧凑 KPI 横条（约 1000×190，自动停靠底部居中，可拖到屏幕底部常驻）；本地代理未运行时会自动拉起；弹窗已打开时重复调用只会聚焦、不会重开。
   - 用户参数含 `full` 时传 `mode="full"`：直接打开独立浏览器完整仪表盘。
2. **查询用量**：调用 MCP 工具 `query_stepfun_usage`。
   - `days`：用户指定的天数，默认 7。
   - `group`：默认 `agent`（按客户端）；用户说「按模型 / 按天 / 按服务商」时分别传 `model` / `day` / `provider`。
3. **汇报**：用表格展示分组结果（请求数、输入 / 输出 / 合计 tokens），并附总计一行。
4. **提示用户**：吸附弹窗内点击「⤢ 全量显示」按钮，可随时拉起独立浏览器完整仪表盘（完整页地址 http://127.0.0.1:8787/ ）。

若 MCP 工具调用失败（服务器未启动），提示用户在终端运行 `npx -y github:Neriah-Ado/stepfun-usage-monitor`（或双击 start.cmd）启动本地代理后重试；数据默认存储在 `~/.stepfun-usage-monitor/`。
