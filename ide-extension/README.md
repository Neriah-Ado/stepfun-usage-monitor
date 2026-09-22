# StepFun Usage Monitor（VS Code 系 IDE 伴侣扩展）

在 VS Code / Cursor / Trae / CodeBuddy 等 VS Code 内核 IDE 中，以三种方式浏览
[stepfun-usage-monitor](https://github.com/Neriah-Ado/stepfun-usage-monitor) 的
Token 用量仪表盘：

| 方式 | 入口 | 说明 |
|---|---|---|
| **底边栏面板** | 底部 Panel「StepFun 监控 · Token 用量」 | 超紧凑横条（`?layout=panel`），与终端/输出同栏 |
| **小窗** | 命令面板 → `StepFun 监控：小窗打开` | 紧凑布局（`?layout=window`），可拖出为独立窗口 |
| **独立浏览器页面** | 命令面板 → `StepFun 监控：在浏览器打开完整仪表盘` | 系统浏览器完整版 |

另有状态栏按钮实时显示今日 tokens（点击打开小窗）。

## 安装

1. 从项目 [Releases](https://github.com/Neriah-Ado/stepfun-usage-monitor/releases) 下载 `stepfun-monitor-<版本>.vsix`；
2. IDE 中 `Ctrl+Shift+P` → **Extensions: Install from VSIX** → 选择下载的文件；
3. 重载窗口，底部面板即出现「StepFun 监控」。

> ZCode 桌面端为独立 Electron 应用（非 VS Code 内核，不支持 VSIX），
> 请使用主项目 README 的「GitHub URL 直载」与三种浏览布局。

## 代理自启动

默认（`stepfunMonitor.autoStart: true`）在打开视图且本地代理未运行时，自动执行：

```
npx -y github:Neriah-Ado/stepfun-usage-monitor
```

从 GitHub URL 直载并启动代理（需本机有 Node.js ≥ 18 与 git）。代理独立于 IDE 生命周期运行，
数据默认存储在 `~/.stepfun-usage-monitor/`，所有数据仅存本地。

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `stepfunMonitor.url` | `http://127.0.0.1:8787` | 监控代理地址 |
| `stepfunMonitor.autoStart` | `true` | 代理未运行时自动从 GitHub 拉起 |
| `stepfunMonitor.startCommand` | `npx` | 启动命令 |
| `stepfunMonitor.startArgs` | `["-y","github:Neriah-Ado/stepfun-usage-monitor"]` | 启动参数 |

MIT License.
