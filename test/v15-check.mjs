#!/usr/bin/env node
/**
 * v1.5.10 静态 + 运行时断言：多服务商 / GitHub URL 直载 / 三种嵌入布局 / VSIX 扩展 /
 * 统一数据目录 / ZCode 官方插件结构 / 吸附弹窗与全量显示按钮 / 插件安装后自包含 runtime
 * 结果写入 test/v15-check.txt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const OUT = [];
const checks = [];
const assert = (name, cond, extra) => { checks.push([name, !!cond]); OUT.push(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NODE = process.execPath;

try {
  const pkg = JSON.parse(R('package.json'));
  const cli = R('bin/cli.mjs');
  const pathsMjs = R('lib/paths.mjs');
  const proxy = R('proxy.mjs');
  const mcp = R('mcp-server.mjs');
  const stats = R('stats.mjs');
  const dash = R('dashboard.html');
  const openPanel = R('lib/open-panel.mjs');
  const providers = exists('lib/providers.mjs') ? R('lib/providers.mjs') : '';
  const worker = exists('lib/replay-worker.mjs') ? R('lib/replay-worker.mjs') : '';

  /* ===== 0. 多服务商（v1.5.5）静态断言 ===== */
  assert('lib/providers.mjs 存在且导出注册表 API',
    /export const BUILTIN_PROVIDERS/.test(providers) && /export function loadProviderState/.test(providers) && /export function providerKeyFor/.test(providers));
  assert('内置服务商覆盖 GLM/DeepSeek/Kimi/MiniMax/Qwen/Yi',
    ['glm', 'deepseek', 'kimi', 'minimax', 'qwen', 'yi'].every((k) => providers.includes(`key: '${k}'`)));
  assert('路由优先级实现（/p/<key> 前缀 > X-Provider 头 > 模型名前缀 > 激活默认）',
    /PATH_PREFIX_RE/.test(providers) && /x-provider/.test(providers) && /modelPrefixes/.test(providers) && /activeProvider/.test(providers));
  assert('proxy.mjs 接入多服务商注册表', /loadProviderState/.test(proxy) && /from '\.\/lib\/providers\.mjs'/.test(proxy) && /providerKeyFor/.test(proxy));
  assert('proxy.mjs 转发按服务商路由（opts.target / forwardPath）',
    /opts\.target/.test(proxy) && /forwardPath/.test(proxy) && /route\.error/.test(proxy));
  assert('proxy.mjs 未知服务商返回 400 + 合法列表', /unknown_provider/.test(proxy) && /valid_providers/.test(proxy));
  assert('proxy.mjs 使用记录含 provider 字段', /provider: opts\.providerKey/.test(proxy));
  assert('proxy.mjs 统计含 byProvider 与 /api/providers、/api/provider',
    /byProvider/.test(proxy) && /pn === '\/api\/providers'/.test(proxy) && /pn === '\/api\/provider'/.test(proxy));
  assert('proxy.mjs 密钥按服务商注入（文件 apiKey > 环境变量）', /providerKeyFor\(provider\)/.test(proxy));
  assert('replay-worker.mjs 并行回放按服务商聚合', /byProvider/.test(worker) && /rec\.provider \|\| 'stepfun'/.test(worker));
  assert('mcp-server.mjs 支持 group=provider', /group === 'provider'/.test(mcp) && /enum: \['day', 'model', 'agent', 'provider'\]/.test(mcp));
  assert('仪表盘含服务商切换器（prov-bar/prov-current/prov-menu）',
    /id="prov-bar"/.test(dash) && /id="prov-current"/.test(dash) && /id="prov-menu"/.test(dash));
  assert('仪表盘一键切换逻辑（乐观 UI + POST /api/provider + 失败回滚）',
    /async function switchProvider/.test(dash) && /fetch\('\/api\/provider'/.test(dash) && /provState\.active = prev/.test(dash));
  assert('仪表盘含服务商用量表面板', /id="p-providers"/.test(dash) && /id="tb-provider"/.test(dash) && /byProvider/.test(dash));
  assert('底栏布局隐藏切换器、小窗隐藏服务商表',
    /html\[data-layout="panel"\] #prov-bar\{display:none\}/.test(dash) && /html\[data-layout="window"\] #p-providers\{display:none!important\}/.test(dash));

  /* ===== 0b. ZCode 官方插件结构（v1.5.10） ===== */
  const mktRaw = exists('marketplace.json') ? R('marketplace.json') : '';
  let mkt = {}; try { mkt = JSON.parse(mktRaw); } catch { /* parse fail */ }
  assert('marketplace.json 存在且含 plugins[]', Array.isArray(mkt.plugins) && mkt.plugins.length > 0);
  assert('marketplace.json 条目指向 ./plugins/stepfun-usage-monitor 且 version=1.5.10',
    mkt.plugins.some((p) => p.name === 'stepfun-usage-monitor' && p.source === './plugins/stepfun-usage-monitor' && p.version === '1.5.10'));
  const pluginJsonPath = 'plugins/stepfun-usage-monitor/.zcode-plugin/plugin.json';
  const pluginJsonRaw = exists(pluginJsonPath) ? R(pluginJsonPath) : '';
  let pluginJson = {}; try { pluginJson = JSON.parse(pluginJsonRaw); } catch { /* parse fail */ }
  assert('plugin.json 存在且 name 合法（^[a-z0-9][a-z0-9._-]{0,127}$）', /^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginJson.name || ''), pluginJson.name);
  assert('plugin.json version=1.5.10 且声明 commands/mcpServers',
    pluginJson.version === '1.5.10' && pluginJson.commands === 'commands' && pluginJson.mcpServers === '.mcp.json');
  assert('plugin.json 含 description_i18n（en/zh-CN，对齐官方字段）',
    !!(pluginJson.description_i18n && pluginJson.description_i18n.en && pluginJson.description_i18n['zh-CN']));
  const cmdPath = 'plugins/stepfun-usage-monitor/commands/sfm.md';
  assert('标准命令 commands/sfm.md 存在且带 frontmatter description',
    exists(cmdPath) && /^---\n[\s\S]*?description:/.test(exists(cmdPath) ? R(cmdPath) : ''));
  assert('commands/sfm.md 驱动 open_monitor_panel 与 query_stepfun_usage',
    exists(cmdPath) && R(cmdPath).includes('open_monitor_panel') && R(cmdPath).includes('query_stepfun_usage'));
  const mcpJsonPath = 'plugins/stepfun-usage-monitor/.mcp.json';
  const mcpJsonRaw = exists(mcpJsonPath) ? R(mcpJsonPath) : '';
  let mcpJson = {}; try { mcpJson = JSON.parse(mcpJsonRaw); } catch { /* parse fail */ }
  assert('.mcp.json 配置 stdio MCP 服务器（command + args）',
    !!(mcpJson.mcpServers && mcpJson.mcpServers['stepfun-usage'] && mcpJson.mcpServers['stepfun-usage'].command && Array.isArray(mcpJson.mcpServers['stepfun-usage'].args)));
  assert('.mcp.json 使用 ${CLAUDE_PLUGIN_ROOT} 模板变量指向插件内 runtime 入口',
    mcpJsonRaw.includes('${CLAUDE_PLUGIN_ROOT}') && mcpJsonRaw.includes('${CLAUDE_PLUGIN_ROOT}/runtime/bin/cli.mjs') && mcpJsonRaw.includes('--mcp'));
  assert('旧非标准 zcode/command-sfm.md 已移除', !exists('zcode/command-sfm.md'));

  /* ===== 0c. ZCode 插件自包含 runtime（v1.5.10：安装后 .mcp.json 路径不断裂） ===== */
  // 背景：ZCode 安装插件 zip 时只解压插件目录本身（不含仓库根文件），
  // 因此全部运行文件必须内置在插件目录内（runtime/），${CLAUDE_PLUGIN_ROOT}/runtime/... 安装后才可解析。
  const rtBase = 'plugins/stepfun-usage-monitor/runtime';
  const rtFiles = ['bin/cli.mjs', 'proxy.mjs', 'mcp-server.mjs', 'stats.mjs', 'dashboard.html', 'package.json',
    'lib/open-panel.mjs', 'lib/paths.mjs', 'lib/providers.mjs', 'lib/replay-worker.mjs'];
  const rtMissing = rtFiles.filter((f) => !exists(`${rtBase}/${f}`));
  assert('runtime/ 自包含目录含全部 10 个运行文件', rtMissing.length === 0, rtMissing.join(',') || 'ok');
  const rtDiff = rtFiles.filter((f) => exists(`${rtBase}/${f}`) && R(`${rtBase}/${f}`) !== R(f));
  assert('runtime/ 与仓库根逐字节一致（根文件更新后必须重新同步）', rtDiff.length === 0, rtDiff.join(',') || 'ok');
  assert('同步脚本 test/sync-plugin-runtime.mjs 存在', exists('test/sync-plugin-runtime.mjs'));

  /* ===== 1. GitHub URL 直载（npx bin） ===== */
  assert('bin/cli.mjs 带 shebang', cli.startsWith('#!/usr/bin/env node'));
  assert('bin/cli.mjs 支持 --mcp 分发', /--mcp/.test(cli) && /mcp-server\.mjs/.test(cli));
  assert('bin/cli.mjs 支持 --port / --data-dir', /--port/.test(cli) && /--data-dir/.test(cli));
  assert('bin/cli.mjs 帮助含 npx 直载示例', cli.includes('npx -y github:Neriah-Ado/stepfun-usage-monitor'));
  assert('package.json version=1.5.10', pkg.version === '1.5.10');
  assert('package.json bin 指向 cli', pkg.bin && pkg.bin['stepfun-usage-monitor'] === 'bin/cli.mjs');
  assert('package.json files 含 bin/lib/plugins/marketplace.json 且不含 zcode',
    ['bin/', 'lib/', 'plugins/', 'marketplace.json'].every((f) => (pkg.files || []).includes(f)) && !(pkg.files || []).includes('zcode/'));
  assert('package.json repository 指向 GitHub', /github\.com\/Neriah-Ado\/stepfun-usage-monitor/.test(JSON.stringify(pkg.repository || {})));
  assert('lib/paths.mjs 四级解析（env/home/legacy/home）',
    /DATA_DIR/.test(pathsMjs) && /HOME_DATA_DIR/.test(pathsMjs) && /usage\.jsonl/.test(pathsMjs) && /export function resolveDataDir/.test(pathsMjs));
  assert('proxy.mjs 接入统一数据目录', /resolveDataDir/.test(proxy) && /from '\.\/lib\/paths\.mjs'/.test(proxy));
  assert('mcp-server.mjs 接入统一数据目录', /resolveDataDir/.test(mcp) && /from '\.\/lib\/paths\.mjs'/.test(mcp));
  assert('mcp-server.mjs 配置示例含 npx 直载', mcp.includes('"args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]'));
  assert('stats.mjs 接入统一数据目录', /resolveDataDir/.test(stats));

  /* ===== 2. 版本一致性 ===== */
  assert('proxy.mjs VERSION=1.5.10', /const VERSION = '1\.5\.10'/.test(proxy));
  assert('mcp-server.mjs serverInfo 1.5.10', /version: '1\.5\.10'/.test(mcp));
  assert('proxy.mjs 头部含 v1.5.10 说明', proxy.includes('v1.5.10'));
  assert('ide-extension manifest version=1.5.10', /"version": "1\.5\.10"/.test(R('ide-extension/package.json')));

  /* ===== 3. 三种嵌入布局 + 底栏全量显示按钮 ===== */
  assert('仪表盘 LAYOUT 常量', /const LAYOUT = document\.documentElement\.dataset\.layout \|\| 'full'/.test(dash));
  assert('防 FOUC 内联脚本（head 内先于样式写 data-layout）',
    /URLSearchParams\(location\.search\)/.test(dash) && dash.indexOf('URLSearchParams(location.search)') < dash.indexOf('<style>'));
  assert('布局切换链接（完整页/小窗/底栏）', ['lnk-full', 'lnk-window', 'lnk-panel'].every((id) => dash.includes(`id="${id}"`)));
  assert('独立浏览器入口 btn-open', /id="btn-open" href="\/" target="_blank"/.test(dash));
  assert('底栏「全量显示」按钮（btn-full → / target=_blank）', /id="btn-full" href="\/" target="_blank"/.test(dash));
  assert('全量显示按钮仅底栏显示（默认隐藏 + panel 布局显示）',
    /#btn-full\{display:none\}/.test(dash) && /html\[data-layout="panel"\] #btn-full\{display:inline-flex\}/.test(dash));
  assert('底栏窗口标题改写为「吸附弹窗」', /document\.title/.test(dash) && /吸附弹窗/.test(dash) && /小窗/.test(dash));
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

  /* ===== 4. 小窗 / 底栏启动器 / 吸附弹窗拉起器 / MCP 工具 ===== */
  assert('open-window.cmd 存在且用 --app 无边框窗口', exists('open-window.cmd') && /--app=|window-size|app=/.test(exists('open-window.cmd') ? R('open-window.cmd') : ''));
  assert('open-panel.cmd 存在（底部横条窗口）', exists('open-panel.cmd') && /layout=panel/.test(exists('open-panel.cmd') ? R('open-panel.cmd') : ''));
  assert('lib/open-panel.mjs 存在且导出 openMonitorPanel / findBrowser / ensureProxy',
    exists('lib/open-panel.mjs') && /export async function openMonitorPanel/.test(openPanel)
    && /export function findBrowser/.test(openPanel) && /export async function ensureProxy/.test(openPanel));
  assert('lib/open-panel.mjs 用 --app + window-size + window-position 停靠底部',
    /--app=/.test(openPanel) && /--window-size=/.test(openPanel) && /--window-position=/.test(openPanel));
  assert('lib/open-panel.mjs 支持 dryRun 与 mode=full', /opts\.dryRun/.test(openPanel) && /'full'/.test(openPanel));
  assert('bin/cli.mjs 支持 --panel [panel|full]', /--panel/.test(cli) && /openMonitorPanel/.test(cli));
  assert('MCP 暴露 open_monitor_panel 工具（panel/full + dryRun）',
    /name: 'open_monitor_panel'/.test(mcp) && /enum: \['panel', 'full'\]/.test(mcp) && /dryRun/.test(mcp) && /openMonitorPanel/.test(mcp));
  assert('MCP open_monitor_panel 异步分发（Promise 分支写响应）', /typeof result\.then === 'function'/.test(mcp));

  /* ===== 5. VS Code 系 IDE 扩展 ===== */
  const extPkgRaw = exists('ide-extension/package.json') ? R('ide-extension/package.json') : '';
  let extPkg = {};
  try { extPkg = JSON.parse(extPkgRaw); } catch { /* parse fail */ }
  assert('扩展 manifest version=1.5.10', extPkg.version === '1.5.10');
  assert('扩展提供三种打开命令', ['openPanel', 'openWindow', 'openInBrowser'].every((c) => extPkgRaw.includes(`stepfunMonitor.${c}`)));
  assert('扩展有底边栏视图容器', extPkgRaw.includes('viewsContainers') && extPkgRaw.includes('"panel"'));
  const extJs = exists('ide-extension/extension.js') ? R('ide-extension/extension.js') : '';
  assert('扩展注册底边栏 WebviewView', extJs.includes('registerWebviewViewProvider'));
  assert('扩展小窗用 createWebviewPanel', extJs.includes('createWebviewPanel'));
  assert('扩展浏览器模式用 env.openExternal', extJs.includes('env.openExternal'));
  assert('扩展 iframe 指向 layout=panel / layout=window', extJs.includes('layout=panel') && extJs.includes('layout=window'));
  assert('扩展含状态栏今日 tokens', extJs.includes('createStatusBarItem'));
  const vsixPath = path.join(ROOT, 'ide-extension/dist/stepfun-monitor-1.5.10.vsix');
  assert('VSIX 已构建且非空（1.5.10）', exists('ide-extension/dist/stepfun-monitor-1.5.10.vsix') &&
    fs.statSync(vsixPath).size > 1000,
    exists('ide-extension/dist/stepfun-monitor-1.5.10.vsix') ? fs.statSync(vsixPath).size + 'B' : 'missing');
  assert('VSIX 构建器存在（零依赖）', exists('test/build-vsix.mjs'));

  /* ===== 6. 运行时：?layout= 由服务端原样下发（同一 HTML，前端内联脚本分流） ===== */
  const PORT = 8793;
  const dataTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfm-v15-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataTmp }, stdio: 'ignore',
  });
  let health = null, htmlPanel = '', htmlFull = '';
  for (let i = 0; i < 40 && !health; i++) {
    await sleep(250);
    try { health = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json(); } catch { /* retry */ }
  }
  assert('运行时 /healthz version=1.5.10', !!health && health.version === '1.5.10');
  if (health) {
    htmlPanel = await (await fetch(`http://127.0.0.1:${PORT}/?layout=panel`)).text();
    htmlFull = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  }
  assert('?layout=panel 返回同一仪表盘 HTML', htmlPanel.includes('URLSearchParams(location.search)') && htmlPanel === htmlFull);
  try { child.kill('SIGKILL'); } catch { /* ignore */ }

  /* ===== 7. 运行时：多服务商路由 / 切换 / byProvider 统计 ===== */
  const MA = 18901, MB = 18902, PP = 8794;
  const dataTmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sfm-pv-'));
  fs.writeFileSync(path.join(dataTmp2, 'providers.json'), JSON.stringify({
    active: 'stepfun',
    providers: [
      { key: 'mockb', name: 'Mock B', baseUrl: `http://127.0.0.1:${MB}`, apiKey: 'sk-v15-test', modelPrefixes: ['mockb-'] },
      { key: 'deepseek', baseUrl: `http://127.0.0.1:${MB}` },
    ],
  }, null, 2));
  const cleanEnv = { ...process.env };
  for (const k of ['STEPFUN_API_KEY', 'GLM_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY', 'MINIMAX_API_KEY', 'DASHSCOPE_API_KEY', 'YI_API_KEY']) delete cleanEnv[k];
  const mockA = spawn(NODE, [path.join(ROOT, 'test', 'mock-upstream.mjs')], {
    env: { ...cleanEnv, MOCK_PORT: String(MA), MOCK_LOG: path.join(dataTmp2, 'mockA.log') }, stdio: 'ignore',
  });
  const mockB = spawn(NODE, [path.join(ROOT, 'test', 'mock-upstream.mjs')], {
    env: { ...cleanEnv, MOCK_PORT: String(MB), MOCK_LOG: path.join(dataTmp2, 'mockB.log') }, stdio: 'ignore',
  });
  const proxy2 = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...cleanEnv, PORT: String(PP), TARGET_URL: `http://127.0.0.1:${MA}`, DATA_DIR: dataTmp2 }, stdio: 'ignore',
  });
  try {
    let h2 = null;
    for (let i = 0; i < 60 && !h2; i++) { await sleep(250); try { h2 = await (await fetch(`http://127.0.0.1:${PP}/healthz`)).json(); } catch { /* retry */ } }
    assert('多服务商代理就绪', !!h2 && h2.version === '1.5.10' && h2.provider === 'stepfun');

    const post = async (p, body, headers) => {
      const r = await fetch(`http://127.0.0.1:${PP}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    const readLog = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
    const lastRecord = () => {
      const lines = readLog(path.join(dataTmp2, 'usage.jsonl')).trim().split('\n').filter(Boolean);
      return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    };
    const recordCount = () => readLog(path.join(dataTmp2, 'usage.jsonl')).trim().split('\n').filter(Boolean).length;
    // 记录落盘是异步的（setImmediate + appendFile）：轮询等待本次请求的记录出现并满足条件，消除竞态
    const waitForRecord = async (pred, minCount, timeoutMs = 5000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const lines = readLog(path.join(dataTmp2, 'usage.jsonl')).trim().split('\n').filter(Boolean);
        if (lines.length > minCount) {
          try { const rec = JSON.parse(lines[lines.length - 1]); if (pred(rec)) return rec; } catch { /* 半行：下次重试 */ }
        }
        await sleep(50);
      }
      return null;
    };

    // 1) 列表
    const listRes = await (await fetch(`http://127.0.0.1:${PP}/api/providers`)).json();
    assert('/api/providers 返回全部服务商且激活 stepfun',
      listRes.active === 'stepfun' && ['stepfun', 'glm', 'deepseek', 'kimi', 'minimax', 'qwen', 'yi', 'mockb'].every((k) => listRes.providers.some((p) => p.key === k)));
    assert('providers.json 覆盖 deepseek baseUrl 生效',
      listRes.providers.find((p) => p.key === 'deepseek').baseUrl === `http://127.0.0.1:${MB}`);
    assert('/api/providers 不泄露 apiKey', !JSON.stringify(listRes).includes('sk-v15-test'));

    // 2) 默认路由 → mock A（stepfun）
    const n1 = recordCount();
    const r1 = await post('/v1/chat/completions', { model: 'step-2-16k', messages: [] });
    assert('默认路由转发到激活服务商（mock A）', r1.status === 200 && readLog(path.join(dataTmp2, 'mockA.log')).includes('POST /v1/chat/completions'));
    assert('记录 provider=stepfun', (await waitForRecord((r) => r.provider === 'stepfun', n1)) !== null);
    assert('无密钥配置时不注入 Authorization', readLog(path.join(dataTmp2, 'mockA.log')).includes('auth=no'));

    // 3) 路径前缀 /p/mockb/v1 → mock B（前缀剥除）
    const n2 = recordCount();
    const r2 = await post('/p/mockb/v1/chat/completions', { model: 'anything', messages: [] });
    assert('/p/<key>/ 路径前缀路由并剥除前缀', r2.status === 200 && readLog(path.join(dataTmp2, 'mockB.log')).includes('POST /v1/chat/completions'));
    assert('providers.json apiKey 注入上游', readLog(path.join(dataTmp2, 'mockB.log')).includes('auth=yes'));
    assert('记录 provider=mockb（路径）', (await waitForRecord((r) => r.provider === 'mockb', n2)) !== null);

    // 4) X-Provider 头路由
    const n3 = recordCount();
    const r3 = await post('/v1/chat/completions', { model: 'anything', messages: [] }, { 'X-Provider': 'mockb' });
    assert('X-Provider 头路由生效', r3.status === 200 && (await waitForRecord((r) => r.provider === 'mockb', n3)) !== null);

    // 5) 模型名前缀路由（deepseek 被覆盖到 mock B）
    const n4 = recordCount();
    const r4 = await post('/v1/chat/completions', { model: 'deepseek-chat', messages: [] });
    assert('模型名前缀路由生效（deepseek-chat → deepseek）', r4.status === 200 && (await waitForRecord((r) => r.provider === 'deepseek', n4)) !== null);

    // 6) 未知服务商 → 400
    const r5 = await post('/p/zzz/v1/chat/completions', { model: 'x', messages: [] });
    const r6 = await post('/v1/chat/completions', { model: 'x', messages: [] }, { 'X-Provider': 'zzz' });
    assert('未知路径前缀返回 400 + 合法列表', r5.status === 400 && Array.isArray(r5.json.valid_providers) && r5.json.valid_providers.includes('mockb'));
    assert('未知 X-Provider 返回 400', r6.status === 400);

    // 7) 一键切换激活服务商
    const sw = await (await fetch(`http://127.0.0.1:${PP}/api/provider`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'mockb' }) })).json();
    assert('POST /api/provider 切换激活服务商', sw.ok === true && sw.active === 'mockb');
    // 注意：必须用不命中任何 modelPrefixes 的中性模型名，才能验证「激活默认」这一级路由
    // （若用 step-2-16k，模型名前缀 step- 会按既定优先级压过激活默认而路由到 stepfun）
    const r7 = await post('/v1/chat/completions', { model: 'test-active-model', messages: [] });
    assert('切换后默认请求走新激活服务商（mock B）', r7.status === 200 && readLog(path.join(dataTmp2, 'mockB.log')).split('\n').filter((l) => l.includes('model=test-active-model')).length >= 1);
    assert('切换已持久化到 providers.json', JSON.parse(fs.readFileSync(path.join(dataTmp2, 'providers.json'), 'utf8')).active === 'mockb');
    const bad = await (await fetch(`http://127.0.0.1:${PP}/api/provider`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'nope' }) })).status;
    assert('切换到未知服务商返回 400', bad === 400);

    // 8) byProvider 统计
    const st = await (await fetch(`http://127.0.0.1:${PP}/api/stats?days=30`)).json();
    const bp = Object.fromEntries((st.byProvider || []).map((r) => [r.name, r.requests]));
    assert('byProvider 统计正确（stepfun=1, mockb=3, deepseek=1）',
      bp.stepfun === 1 && bp.mockb === 3 && bp.deepseek === 1, JSON.stringify(bp));
    assert('byProvider token 汇总与总计一致',
      (st.byProvider || []).reduce((s, r) => s + r.total, 0) === st.total.total, `providers=${(st.byProvider || []).reduce((s, r) => s + r.total, 0)} total=${st.total.total}`);
    assert('stats.meta 含激活服务商信息', st.meta.provider === 'mockb' && st.meta.providerName === 'Mock B' && Array.isArray(st.meta.providers));
  } catch (e) {
    assert('多服务商运行时段无异常', false, (e && e.message) || String(e));
  } finally {
    for (const c of [mockA, mockB, proxy2]) { try { c.kill('SIGKILL'); } catch { /* ignore */ } }
    try { fs.rmSync(dataTmp, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(dataTmp2, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  /* ===== 8. 运行时：吸附弹窗拉起器（v1.5.10；dryRun 不真正开窗，ensureProxy 用后即杀） ===== */
  try {
    const op = await import(pathToFileURL(path.join(ROOT, 'lib', 'open-panel.mjs')).href);
    const dPanel = await op.openMonitorPanel({ mode: 'panel', dryRun: true, port: 8798 });
    assert('openMonitorPanel dryRun(panel) 返回吸附弹窗 URL',
      dPanel.ok === true && dPanel.mode === 'panel' && dPanel.url === 'http://127.0.0.1:8798/?layout=panel', dPanel.url);
    const dFull = await op.openMonitorPanel({ mode: 'full', dryRun: true, port: 8798 });
    assert('openMonitorPanel dryRun(full) 返回完整页 URL',
      dFull.ok === true && dFull.mode === 'full' && dFull.url === 'http://127.0.0.1:8798/', dFull.url);
    const ss = op.screenSize();
    assert('screenSize 返回 null 或正尺寸', ss === null || (ss.width > 0 && ss.height > 0), ss ? `${ss.width}x${ss.height}` : 'null');
    assert('findBrowser 探测到本机 Edge/Chrome', !!dPanel.browser, dPanel.browser || 'none');
    const up = await op.ensureProxy(8799, 15000);
    assert('ensureProxy 在空闲端口自动拉起代理', up.started === true, JSON.stringify({ started: up.started, err: up.error || '' }));
    try { up.child && up.child.kill('SIGKILL'); } catch { /* ignore */ }
  } catch (e) {
    assert('open-panel 运行时段无异常', false, (e && e.message) || String(e));
  }

  OUT.push('');
  OUT.push(`静态+运行时断言：${checks.filter(([, ok]) => ok).length}/${checks.length} 通过`);
  if (checks.some(([, ok]) => !ok)) OUT.push('FAILED: ' + checks.filter(([, ok]) => !ok).map(([n]) => n).join(' / '));
  OUT.push('RESULT: ' + (checks.every(([, ok]) => ok) ? 'ALL-PASS' : 'FAIL'));
} catch (e) {
  OUT.push('EXCEPTION: ' + ((e && e.stack) || e));
  OUT.push('RESULT: FAIL');
}
fs.writeFileSync(path.join(__dirname, 'v15-check.txt'), OUT.join('\n') + '\n');
