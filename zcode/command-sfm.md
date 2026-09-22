---
description: 查询 StepFun API Token 用量并给出三种浏览方式
---

请使用 stepfun-usage（stepfun-usage-monitor）MCP 服务器的 query_stepfun_usage 工具查询最近 7 天、按天分组的 StepFun API Token 用量，然后：

1. 用表格汇报：每日请求数、输入 / 输出 / 合计 tokens；
2. 额外给出三个本地浏览入口（直接原样输出，不要改动地址）：
   - 完整仪表盘：http://127.0.0.1:8787/
   - 小窗（无边框独立窗口，适合悬浮在编辑器旁）：http://127.0.0.1:8787/?layout=window
   - 底部横条（超紧凑状态条，适合当作常驻底栏）：http://127.0.0.1:8787/?layout=panel

如果 MCP 工具调用失败（服务器未启动），提示用户在终端运行：
`npx -y github:Neriah-Ado/stepfun-usage-monitor`
（等价于手动安装仓库后双击 start.cmd；仪表盘数据默认存储在 ~/.stepfun-usage-monitor/）
