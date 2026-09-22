/**
 * stepfun-monitor — StepFun Usage Monitor 的 VS Code 系 IDE 伴侣扩展（v1.5.0）
 *
 * 提供三种在 IDE 内浏览仪表盘的方式：
 *   1. 底边栏面板（Panel webview，?layout=panel 超紧凑横条）
 *   2. 小窗（webview panel，?layout=window 紧凑布局，可拖出为独立窗口）
 *   3. 独立浏览器页面（openExternal 打开完整仪表盘）
 * 另有状态栏按钮实时显示今日 tokens；代理未运行时可自动 `npx github:` 从 GitHub 拉起。
 *
 * 零 npm 依赖：仅使用 vscode 内置 API 与 Node 内置模块（CommonJS，兼容旧版 VS Code 内核 IDE）。
 */
'use strict';

const vscode = require('vscode');
const http = require('http');
const { spawn } = require('child_process');

/* ---------------- 配置 ---------------- */
function cfg() { return vscode.workspace.getConfiguration('stepfunMonitor'); }
function baseUrl() { return String(cfg().get('url') || 'http://127.0.0.1:8787').replace(/\/+$/, ''); }

/* ---------------- HTTP 小工具（http.get + 超时） ---------------- */
function getJSON(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 2500 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

let serverProc = null;
let startingPromise = null;

async function checkAlive() {
  const r = await getJSON(baseUrl() + '/healthz', 2000);
  return r && r.ok === true ? r : null;
}

/** 确保本地代理在运行；未运行且 autoStart 开启时用 npx 从 GitHub 拉起（后台、独立于 IDE 生命周期） */
async function ensureServer(force) {
  const alive = await checkAlive();
  if (alive) return true;
  if (!force && !cfg().get('autoStart')) return false;
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    const command = cfg().get('startCommand') || 'npx';
    const args = cfg().get('startArgs') || ['-y', 'github:Neriah-Ado/stepfun-usage-monitor'];
    try {
      // detached + unref：代理独立于 IDE 运行，IDE 关闭后仍在（下次启动直接复用）
      serverProc = spawn(command, args, {
        shell: process.platform === 'win32',   // Windows 下 npx 实为 npx.cmd，需 shell 解析
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      serverProc.on('error', () => { /* 命令不存在等：由下方健康轮询兜底报错 */ });
      serverProc.unref();
    } catch { /* 启动失败：由健康轮询兜底 */ }

    // 首次 npx 需从 GitHub 拉取包体，放宽到 90 秒
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await checkAlive()) return true;
    }
    return false;
  })();

  try { return await startingPromise; } finally { startingPromise = null; }
}

/* ---------------- Webview HTML（iframe 嵌入仪表盘布局） ---------------- */
function iframeHtml(viewPath, title) {
  const url = baseUrl() + viewPath;
  let origin = '';
  try { origin = new URL(url).origin; } catch { origin = 'http://127.0.0.1:8787'; }
  const csp = `default-src 'none'; frame-src ${origin} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${title}</title>
<style>
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#f5f6f8}
  iframe{border:0;width:100%;height:100%;display:block}
  .boot{font:13px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2329;padding:16px}
  .boot code{background:#eef1f6;padding:2px 6px;border-radius:4px}
</style></head>
<body><div class="boot">正在连接本地代理 <b>${origin}</b> …（首次会通过 npx 从 GitHub 拉取，约需几十秒）<br><br>
可先手动启动：<code>${cfg().get('startCommand') || 'npx'} ${(cfg().get('startArgs') || []).join(' ')}</code></div>
<iframe src="${url}"></iframe></body></html>`;
}

const PANEL_VIEW = 'stepfunMonitor.panel';

class MonitorPanelProvider {
  resolveWebviewView(view) {
    view.webview.options = { enableScripts: true };
    view.webview.html = iframeHtml('/?layout=panel', 'StepFun 用量监控 · 底边栏');
    // 若代理未运行：后台拉起，成功后重载一次 webview（iframe 才能连上）
    ensureServer(false).then((ok) => { if (ok) view.webview.html = iframeHtml('/?layout=panel', 'StepFun 用量监控 · 底边栏'); });
  }
}

let currentWindowPanel = null;

async function openWindow() {
  if (currentWindowPanel) { currentWindowPanel.reveal(); return; }
  const panel = vscode.window.createWebviewPanel(
    'stepfunMonitor.window', 'StepFun Token 用量监控',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  currentWindowPanel = panel;
  panel.webview.html = iframeHtml('/?layout=window', 'StepFun 用量监控 · 小窗');
  ensureServer(false).then((ok) => { if (ok && !panel._disposed) panel.webview.html = iframeHtml('/?layout=window', 'StepFun 用量监控 · 小窗'); });
  panel.onDidDispose(() => { currentWindowPanel = null; });
}

async function openInBrowser() {
  await ensureServer(false);
  vscode.env.openExternal(vscode.Uri.parse(baseUrl() + '/'));
}

/* ---------------- 状态栏：今日 tokens ---------------- */
const compact = (n) => {
  if (n == null) return '—';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
};

function activate(context) {
  const provider = new MonitorPanelProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PANEL_VIEW, provider),

    vscode.commands.registerCommand('stepfunMonitor.openPanel', async () => {
      await ensureServer(false);
      vscode.commands.executeCommand(PANEL_VIEW + '.focus');
    }),
    vscode.commands.registerCommand('stepfunMonitor.openWindow', openWindow),
    vscode.commands.registerCommand('stepfunMonitor.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('stepfunMonitor.startServer', async () => {
      const ok = await ensureServer(true);
      vscode.window.showInformationMessage(ok
        ? `StepFun 监控代理已就绪：${baseUrl()}`
        : `未能启动代理。请检查 Node.js / git 是否可用，或手动运行：${cfg().get('startCommand') || 'npx'} ${(cfg().get('startArgs') || []).join(' ')}`);
    }),

    /* 状态栏按钮：点击 = 小窗；文本 = 今日 tokens */
    (() => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      item.text = '$(pulse) StepFun …';
      item.tooltip = 'StepFun Token 用量监控 — 点击打开小窗';
      item.command = 'stepfunMonitor.openWindow';
      const update = async () => {
        const s = await getJSON(baseUrl() + '/api/stats?days=1&lite=1', 4000);
        if (!s) { item.text = '$(pulse) StepFun: 未连接'; return; }
        const today = (s.byDay && s.byDay.length) ? s.byDay[s.byDay.length - 1].total : 0;
        item.text = `$(pulse) StepFun 今日 ${compact(today)} tok`;
      };
      update();
      const timer = setInterval(update, 60000);
      item.show();
      const disposable = { dispose() { clearInterval(timer); item.dispose(); } };
      disposable.item = item;
      return disposable;
    })(),
  );
}

module.exports = { activate };
