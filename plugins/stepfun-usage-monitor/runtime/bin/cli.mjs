#!/usr/bin/env node
/**
 * stepfun-usage-monitor 统一 CLI 入口（v1.5.0）
 *
 * 支持 `npx github:Neriah-Ado/stepfun-usage-monitor` 直接从 GitHub URL 拉起，
 * 无需 clone 仓库、无需 npm install（零依赖）。
 *
 * 用法：
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor                 # 启动监控代理 + 仪表盘（默认）
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor --mcp           # 以 stdio MCP Server 模式运行（Agent 对话查询）
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor --panel         # v1.5.9：屏幕底部吸附弹窗（等价 --panel panel）
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor --panel full    # v1.5.9：独立浏览器完整仪表盘
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor --port 8788     # 指定端口
 *   npx -y github:Neriah-Ado/stepfun-usage-monitor --data-dir D:\my-data
 *
 * 等价于手动安装后的 `node proxy.mjs` / `node mcp-server.mjs`。
 * 数据目录解析规则见 lib/paths.mjs（npx 运行时数据落在 ~/.stepfun-usage-monitor/，不受 npm 缓存清理影响）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const HELP = [
  'stepfun-usage-monitor — StepFun API Token 用量本地监控（零依赖 · 数据全本地）',
  '',
  '用法：',
  '  stepfun-usage-monitor                  启动本地反向代理 + 仪表盘（默认）',
  '  stepfun-usage-monitor --mcp            以 stdio MCP Server 模式运行（供 ZCode/Claude Code 等 Agent 对话查询）',
  '  stepfun-usage-monitor --panel [full]   屏幕底部吸附弹窗（v1.5.9；full=独立浏览器完整仪表盘）',
  '  stepfun-usage-monitor --port <N>       指定代理端口（默认 8787）',
  '  stepfun-usage-monitor --data-dir <P>   指定数据目录（默认 ~/.stepfun-usage-monitor/）',
  '  stepfun-usage-monitor --version        显示版本号',
  '  stepfun-usage-monitor --help           显示本帮助',
  '',
  '从 GitHub URL 直接运行：',
  '  npx -y github:Neriah-Ado/stepfun-usage-monitor',
  '',
  '仪表盘浏览方式：',
  '  完整页   http://127.0.0.1:8787/',
  '  小窗     http://127.0.0.1:8787/?layout=window',
  '  吸附弹窗 http://127.0.0.1:8787/?layout=panel（或 --panel；弹窗内「全量显示」拉起完整页）',
].join('\n');

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/* ---------------- 参数解析 ---------------- */
const argv = process.argv.slice(2);
const next = (flag) => {
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length) return argv.splice(i, 2)[1];
  const eq = argv.findIndex((a) => a.startsWith(flag + '='));
  if (eq >= 0) { const v = argv.splice(eq, 1)[0].slice(flag.length + 1); return v; }
  return null;
};
const has = (flag) => { const i = argv.indexOf(flag); if (i >= 0) { argv.splice(i, 1); return true; } return false; };

const port = next('--port') || next('-p');
const dataDir = next('--data-dir');
if (port != null) process.env.PORT = String(port);
if (dataDir != null) process.env.DATA_DIR = dataDir;

if (has('--help') || has('-h')) {
  process.stdout.write(HELP + '\n');
  process.exit(0);
}
if (has('--version') || has('-V')) {
  process.stdout.write(readVersion() + '\n');
  process.exit(0);
}

/* ---------------- 吸附弹窗模式（v1.5.9）：--panel [panel|full] ---------------- */
let panelMode = null;
{
  const i = argv.indexOf('--panel');
  if (i >= 0) {
    argv.splice(i, 1);
    const v = argv[i];
    if (v === 'panel' || v === 'full') { argv.splice(i, 1); panelMode = v; }
    else panelMode = 'panel';
  }
}
if (panelMode) {
  const { openMonitorPanel, PANEL_WIDTH, PANEL_HEIGHT } = await import(pathToFileURL(path.join(ROOT, 'lib', 'open-panel.mjs')).href);
  const r = await openMonitorPanel({ mode: panelMode, port: port ? Number(port) : undefined });
  const lines = [r.ok
    ? (r.alreadyOpen ? `吸附弹窗已在运行，已聚焦：${r.url}` : `已打开${r.mode === 'panel' ? '底部吸附弹窗' : '独立浏览器完整页'}：${r.url}`)
    : `打开失败：${r.note || '未知错误'}`];
  if (r.proxyStarted) lines.push('本地代理此前未运行，已自动拉起。');
  if (r.position) lines.push(`停靠位置 ${r.position.x},${r.position.y}（尺寸 ${PANEL_WIDTH}x${PANEL_HEIGHT}）。`);
  if (r.mode === 'panel' && r.ok) lines.push('弹窗内点击「⤢ 全量显示」可拉起独立浏览器完整页。');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(r.ok ? 0 : 1);
}

/* 未知参数直接透传给 proxy.mjs（保持与 node proxy.mjs 一致的行为） */

/* ---------------- 模式分发 ---------------- */
// 环境变量必须先于动态 import 设置：proxy.mjs / mcp-server.mjs 在模块顶层读取配置。
if (has('--mcp')) {
  await import(pathToFileURL(path.join(ROOT, 'mcp-server.mjs')).href);
} else {
  await import(pathToFileURL(path.join(ROOT, 'proxy.mjs')).href);
}
