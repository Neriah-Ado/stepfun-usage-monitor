#!/usr/bin/env node
/**
 * lib/open-panel.mjs — 「吸附弹窗 / 独立浏览器页」拉起器（零依赖，v1.5.9）
 *
 * 背景：ZCode 插件体系（plugin.json）提供 MCP / skills / commands / hooks，
 *       没有客户端 UI 挂载点，因此用「Chrome/Edge --app 无边框窗口 + 吸底停靠」
 *       模拟 Agent 页面吸附弹窗；弹窗内的「⤢ 全量显示」按钮由 dashboard.html
 *       负责拉起独立浏览器完整页。
 *
 * 复用单元：MCP `open_monitor_panel` 工具与 `bin/cli.mjs --panel` 均走本模块。
 *
 * 导出能力：
 *   findBrowser()                 探测本机 Edge / Chrome（win32 返回可执行路径，
 *                                 darwin 返回应用名，linux 返回命令名）
 *   screenSize()                  主屏分辨率（win32 走 PowerShell；失败返回 null）
 *   isProxyUp(port)               本地代理是否已就绪（GET /healthz）
 *   ensureProxy(port, timeoutMs)  未就绪则以后台进程拉起代理并等待就绪
 *   focusPanelWindow()            尝试把已打开的吸附弹窗提到前台（best-effort）
 *   openMonitorPanel(opts)        主入口：{ mode: 'panel'|'full', port, dryRun }
 *   resetPanelHandle()            测试辅助：清理内部句柄
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** 吸附弹窗尺寸与标题（与 open-panel.cmd、dashboard.html 保持一致） */
export const PANEL_WIDTH = 1000;
export const PANEL_HEIGHT = 190;
export const PANEL_TITLE = 'StepFun 用量监控 · 吸附弹窗';
export const WINDOW_TITLE = 'StepFun 用量监控 · 小窗';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 浏览器探测 ---------------- */
export function findBrowser() {
  if (process.platform === 'darwin') {
    for (const app of ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app']) {
      try { if (fs.existsSync(app)) return app.endsWith('Edge.app') ? 'Microsoft Edge' : 'Google Chrome'; } catch { /* ignore */ }
    }
    return null;
  }
  if (process.platform !== 'win32') {
    for (const cmd of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try { execFileSync('which', [cmd], { stdio: 'ignore' }); return cmd; } catch { /* try next */ }
    }
    return null;
  }
  const env = process.env;
  const candidates = [];
  const push = (p) => { if (p) candidates.push(p); };
  push(env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  push(env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  push(env.ProgramFiles && path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  push(env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}

/* ---------------- 主屏分辨率（用于吸底停靠） ---------------- */
export function screenSize() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output ("$($b.Width) $($b.Height)")',
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const m = String(out).match(/(\d{3,5})\s+(\d{3,5})/);
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  } catch { /* 探测失败：调用方回退到不指定位置 */ }
  return null;
}

/* ---------------- 本地代理保障 ---------------- */
export async function isProxyUp(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/** 代理未运行时自动拉起（detached 后台进程，不随调用方退出而消亡） */
export async function ensureProxy(port = 8787, timeoutMs = 10000) {
  if (await isProxyUp(port)) return { started: false, alreadyRunning: true };
  const entry = path.join(ROOT, 'bin', 'cli.mjs');
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port) },
    detached: true, stdio: 'ignore',
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(250);
    if (await isProxyUp(port)) return { started: true, alreadyRunning: false, pid: child.pid, child };
  }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  return { started: false, alreadyRunning: false, error: `本地代理未在 ${Math.round(timeoutMs / 1000)}s 内就绪` };
}

/* ---------------- 已开弹窗唤焦 ---------------- */
export function focusPanelWindow() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$w=New-Object -ComObject WScript.Shell; if($w.AppActivate('${PANEL_TITLE}')){'OK'}else{'NO'}`,
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return String(out).includes('OK');
  } catch { return false; }
}

/* ---------------- 浏览器拉起 ---------------- */
function launchBrowser(browser, chromeArgs) {
  if (process.platform === 'darwin') {
    return spawn('open', ['-na', browser, '--args', ...chromeArgs], { detached: true, stdio: 'ignore' });
  }
  return spawn(browser, chromeArgs, { detached: true, stdio: 'ignore' });
}

/* ---------------- 主入口 ---------------- */
/**
 * @param {object}  opts
 * @param {string}  [opts.mode]   'panel'（默认，底部吸附弹窗）| 'full'（独立浏览器完整页）
 * @param {number}  [opts.port]   代理端口，默认 8787（或环境变量 PORT）
 * @param {boolean} [opts.dryRun] 仅解析执行计划（浏览器 / URL / 停靠位置），不真正开窗
 * @returns {Promise<{ok,mode,port,url,browser,position,proxyStarted,alreadyOpen,pid,note}>}
 */
export async function openMonitorPanel(opts = {}) {
  const port = Number(opts.port || process.env.PORT || 8787);
  const mode = opts.mode === 'full' ? 'full' : 'panel';
  const res = { ok: false, mode, port, url: '', browser: '', position: null, proxyStarted: false, alreadyOpen: false, pid: null, note: '' };

  const browser = findBrowser();
  res.browser = browser || '';
  if (!browser) {
    res.note = '未找到 Edge / Chrome（请安装其中任意一款）';
    return res;
  }
  res.url = mode === 'panel' ? `http://127.0.0.1:${port}/?layout=panel` : `http://127.0.0.1:${port}/`;

  if (opts.dryRun) {
    res.ok = true;
    res.note = 'dry-run：仅解析执行计划，未真正打开窗口';
    if (mode === 'panel') {
      const s = screenSize();
      if (s) res.position = { x: Math.max(0, Math.round((s.width - PANEL_WIDTH) / 2)), y: Math.max(0, s.height - PANEL_HEIGHT) };
    }
    return res;
  }

  // 弹窗已在运行（标题命中）→ 只聚焦，不重开
  if (mode === 'panel' && focusPanelWindow()) {
    res.alreadyOpen = true;
    res.ok = true;
    res.note = '吸附弹窗已在运行，已尝试提到前台';
    return res;
  }

  const p = await ensureProxy(port);
  res.proxyStarted = !!p.started;
  if (p.error) { res.note = p.error; return res; }

  const args = mode === 'panel'
    ? [`--app=${res.url}`, `--window-size=${PANEL_WIDTH},${PANEL_HEIGHT}`]
    : [res.url];
  if (mode === 'panel') {
    const s = screenSize();
    if (s) {
      const pos = { x: Math.max(0, Math.round((s.width - PANEL_WIDTH) / 2)), y: Math.max(0, s.height - PANEL_HEIGHT) };
      res.position = pos;
      args.push(`--window-position=${pos.x},${pos.y}`);
    }
  }
  const child = launchBrowser(browser, args);
  child.unref();
  res.pid = child.pid;
  res.ok = true;
  res.note = mode === 'panel' ? '已打开底部吸附弹窗（可拖到屏幕底部常驻）' : '已打开独立浏览器完整页';
  return res;
}

/** 测试辅助：清理内部句柄（保留接口，供未来扩展） */
export function resetPanelHandle() { /* 当前版本无持久句柄 */ }
