#!/usr/bin/env node
/**
 * v1.5.0 静态 + 运行时断言：GitHub URL 直载 / 三种嵌入布局 / VSIX 扩展 / 统一数据目录
 * 结果写入 test/v15-check.txt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const OUT = [];
const checks = [];
const assert = (name, cond, extra) => { checks.push([name, !!cond]); OUT.push(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`); };

try {
  const pkg = JSON.parse(R('package.json'));
  const cli = R('bin/cli.mjs');
  const pathsMjs = R('lib/paths.mjs');
  const proxy = R('proxy.mjs');
  const mcp = R('mcp-server.mjs');
  const stats = R('stats.mjs');
  const dash = R('dashboard.html');

  /* ===== 1. GitHub URL 直载（npx bin） ===== */
  assert('bin/cli.mjs 带 shebang', cli.startsWith('#!/usr/bin/env node'));
  assert('bin/cli.mjs 支持 --mcp 分发', /--mcp/.test(cli) && /mcp-server\.mjs/.test(cli));
  assert('bin/cli.mjs 支持 --port / --data-dir', /--port/.test(cli) && /--data-dir/.test(cli));
  assert('bin/cli.mjs 帮助含 npx 直载示例', cli.includes('npx -y github:Neriah-Ado/stepfun-usage-monitor'));
  assert('package.json version=1.5.0', pkg.version === '1.5.0');
  assert('package.json bin 指向 cli', pkg.bin && pkg.bin['stepfun-usage-monitor'] === 'bin/cli.mjs');
  assert('package.json files 含 bin/lib/zcode', ['bin/', 'lib/', 'zcode/'].every((f) => (pkg.files || []).includes(f)));
  assert('package.json repository 指向 GitHub', /github\.com\/Neriah-Ado\/stepfun-usage-monitor/.test(JSON.stringify(pkg.repository || {})));
  assert('lib/paths.mjs 四级解析（env/home/legacy/home）',
    /DATA_DIR/.test(pathsMjs) && /HOME_DATA_DIR/.test(pathsMjs) && /usage\.jsonl/.test(pathsMjs) && /export function resolveDataDir/.test(pathsMjs));
  assert('proxy.mjs 接入统一数据目录', /resolveDataDir/.test(proxy) && /from '\.\/lib\/paths\.mjs'/.test(proxy));
  assert('mcp-server.mjs 接入统一数据目录', /resolveDataDir/.test(mcp) && /from '\.\/lib\/paths\.mjs'/.test(mcp));
  assert('mcp-server.mjs 配置示例含 npx 直载', mcp.includes('"args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]'));
  assert('stats.mjs 接入统一数据目录', /resolveDataDir/.test(stats));

  /* ===== 2. 版本一致性 ===== */
  assert('proxy.mjs VERSION=1.5.0', /const VERSION = '1\.5\.0'/.test(proxy));
  assert('mcp-server.mjs serverInfo 1.5.0', /version: '1\.5\.0'/.test(mcp));
  assert('proxy.mjs 头部含 v1.5.0 说明', proxy.includes('v1.5.0'));

  /* ===== 3. 三种嵌入布局 ===== */
  assert('仪表盘 LAYOUT 常量', /const LAYOUT = document\.documentElement\.dataset\.layout \|\| 'full'/.test(dash));
  assert('防 FOUC 内联脚本（head 内先于样式写 data-layout）',
    /URLSearchParams\(location\.search\)/.test(dash) && dash.indexOf('URLSearchParams(location.search)') < dash.indexOf('<style>'));
  assert('布局切换链接（完整页/小窗/底栏）', ['lnk-full', 'lnk-window', 'lnk-panel'].every((id) => dash.includes(`id="${id}"`)));
  assert('独立浏览器入口 btn-open', /id="btn-open" href="\/" target="_blank"/.test(dash));
  assert('底栏 CSS：隐藏档位栏/长面板、紧凑卡片',
    /html\[data-layout="panel"\] #perf-bar\{display:none\}/.test(dash) &&
    /html\[data-layout="panel"\] #app > :not\(\.cards\)\{display:none!important\}/.test(dash) &&
    /html\[data-layout="panel"\] \.card\{padding:4px 8px/.test(dash));
  assert('小窗 CSS：保留图表、隐藏三张长表',
    /html\[data-layout="window"\] #p-models/.test(dash) &&
    /html\[data-layout="window"\] #p-recent,html\[data-layout="window"\] #hint-panel\{display:none!important\}/.test(dash));
  assert('完整页隐藏浏览器入口/完整页链接', /html:not\(\[data-layout\]\) #btn-open/.test(dash) && /html:not\(\[data-layout\]\) #lnk-full/.test(dash));
  assert('面板具名 id（p-models/p-agents）', /id="p-models"/.test(dash) && /id="p-agents"/.test(dash));
  assert('底栏布局走 lite 载荷', /LAYOUT === 'panel'/ .test(dash) && /\?&lite=1|'&lite=1'/.test(dash));

  /* ===== 4. 小窗 / 底栏启动器与 ZCode 原生命令 ===== */
  assert('open-window.cmd 存在且用 --app 无边框窗口', exists('open-window.cmd') && /--app=|window-size|app=/.test(exists('open-window.cmd') ? R('open-window.cmd') : ''));
  assert('open-panel.cmd 存在（底部横条窗口）', exists('open-panel.cmd') && /layout=panel/.test(exists('open-panel.cmd') ? R('open-panel.cmd') : ''));
  assert('zcode/command-sfm.md 存在（ZCode 原生 /sfm 命令）', exists('zcode/command-sfm.md'));

  /* ===== 5. VS Code 系 IDE 扩展 ===== */
  const extPkgRaw = exists('ide-extension/package.json') ? R('ide-extension/package.json') : '';
  let extPkg = {};
  try { extPkg = JSON.parse(extPkgRaw); } catch { /* parse fail */ }
  assert('扩展 manifest version=1.5.0', extPkg.version === '1.5.0');
  assert('扩展提供三种打开命令', ['openPanel', 'openWindow', 'openInBrowser'].every((c) => extPkgRaw.includes(`stepfunMonitor.${c}`)));
  assert('扩展有底边栏视图容器', extPkgRaw.includes('viewsContainers') && extPkgRaw.includes('"panel"'));
  const extJs = exists('ide-extension/extension.js') ? R('ide-extension/extension.js') : '';
  assert('扩展注册底边栏 WebviewView', extJs.includes('registerWebviewViewProvider'));
  assert('扩展小窗用 createWebviewPanel', extJs.includes('createWebviewPanel'));
  assert('扩展浏览器模式用 env.openExternal', extJs.includes('env.openExternal'));
  assert('扩展 iframe 指向 layout=panel / layout=window', extJs.includes('layout=panel') && extJs.includes('layout=window'));
  assert('扩展含状态栏今日 tokens', extJs.includes('createStatusBarItem'));
  assert('VSIX 已构建且非空', exists('ide-extension/dist/stepfun-monitor-1.5.0.vsix') &&
    fs.statSync(path.join(ROOT, 'ide-extension/dist/stepfun-monitor-1.5.0.vsix')).size > 1000,
    exists('ide-extension/dist/stepfun-monitor-1.5.0.vsix') ? fs.statSync(path.join(ROOT, 'ide-extension/dist/stepfun-monitor-1.5.0.vsix')).size + 'B' : 'missing');
  assert('VSIX 构建器存在（零依赖）', exists('test/build-vsix.mjs'));

  /* ===== 6. 运行时：?layout= 由服务端原样下发（同一 HTML，前端内联脚本分流） ===== */
  const PORT = 8793;
  const dataTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfm-v15-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataTmp }, stdio: 'ignore',
  });
  let health = null, htmlPanel = '', htmlFull = '';
  for (let i = 0; i < 40 && !health; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { health = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json(); } catch { /* retry */ }
  }
  assert('运行时 /healthz version=1.5.0', !!health && health.version === '1.5.0');
  if (health) {
    htmlPanel = await (await fetch(`http://127.0.0.1:${PORT}/?layout=panel`)).text();
    htmlFull = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  }
  assert('?layout=panel 返回同一仪表盘 HTML', htmlPanel.includes('URLSearchParams(location.search)') && htmlPanel === htmlFull);
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(dataTmp, { recursive: true, force: true }); } catch { /* ignore */ }

  OUT.push('');
  OUT.push(`静态+运行时断言：${checks.filter(([, ok]) => ok).length}/${checks.length} 通过`);
  if (checks.some(([, ok]) => !ok)) OUT.push('FAILED: ' + checks.filter(([, ok]) => !ok).map(([n]) => n).join(' / '));
  OUT.push('RESULT: ' + (checks.every(([, ok]) => ok) ? 'ALL-PASS' : 'FAIL'));
} catch (e) {
  OUT.push('EXCEPTION: ' + ((e && e.stack) || e));
  OUT.push('RESULT: FAIL');
}
fs.writeFileSync(path.join(__dirname, 'v15-check.txt'), OUT.join('\n') + '\n');
