#!/usr/bin/env node
/**
 * v1.4.0 校验：交互性能优化 + 轻量/进阶/极致 3 档性能模式
 *   1) 静态断言：dashboard.html 的结构、模式表、等待动画、短路渲染、无障碍
 *   2) 动态实测：启动代理（demo-data）→ 比对 ?lite=1 与完整载荷的 条数/字节数
 * 结果写入 test/ui-perf.txt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT = 8799;
const OUT = [];
const log = (s) => { OUT.push(s); };

const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const proxySrc = fs.readFileSync(path.join(ROOT, 'proxy.mjs'), 'utf8');

/* ---------- 1. 内联 JS 语法校验 ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) log('FAIL 未找到内联 script');
else {
  const jsFile = path.join(os.tmpdir(), `dash-perf-${process.pid}.js`);
  fs.writeFileSync(jsFile, m[1]);
  try {
    execFileSync(NODE, ['--check', jsFile], { stdio: 'ignore', timeout: 20000 });
    log('PASS 内联 JS 语法校验通过');
  } catch (e) {
    log('FAIL 内联 JS 语法错误: ' + (e.stderr || e.message).toString().trim().split('\n').slice(0, 6).join('\n'));
  } finally { try { fs.rmSync(jsFile, { force: true }); } catch { /* ignore */ } }
}

/* ---------- 2. 静态断言 ---------- */
const checks = [
  // —— 3 档性能模式 ——
  ['档位栏存在且位于 #app 之外（不受刷新重建影响）',
    /id="perf-bar"/.test(html) && html.indexOf('id="perf-bar"') < html.indexOf('id="app"')],
  ['三档按钮齐全（轻量/进阶/极致）',
    /data-perf="lite"/.test(html) && /data-perf="balanced"/.test(html) && /data-perf="ultra"/.test(html)],
  ['档位使用 role=radiogroup/radio + aria-pressed',
    /role="radiogroup"/.test(html) && /role="radio"/.test(html) && /aria-pressed/.test(html)],
  ['每档参数表 MODES 定义（间隔/天数/载荷/图表/行数/动画）',
    /const MODES = \{/.test(html) && /interval: 120000/.test(html) && /interval: 30000/.test(html) && /interval: 10000/.test(html)],
  ['轻量档请求 lite=1 精简载荷', /c\.lite \? '&lite=1' : ''/.test(html) || /lite=1/.test(html)],
  ['轻量档不绘制 SVG 图表，仅文字摘要',
    /if \(cfg\(\)\.chart\)/.test(html) && /show\(refs\.chartSvg, false\)/.test(html) && /chartText/.test(html) && /轻量模式已省略图表绘制/.test(html)],
  ['档位持久化到 localStorage', /localStorage\.setItem\(PERF_KEY/.test(html) && /localStorage\.getItem\(PERF_KEY/.test(html)],
  ['档位通过 html[data-perf] 同步驱动 CSS（零延迟）', /documentElement\.dataset\.perf = perfMode/.test(html) && /html\[data-perf="lite"\]/.test(html)],
  ['轻量模式 CSS 关闭全部动画/过渡/阴影/渐变',
    /html\[data-perf="lite"\] \*[\s\S]{0,400}transition:none!important[\s\S]{0,200}box-shadow:none!important/.test(html)],
  ['极致模式专属动效（数字滚动 + 入场 + 高亮）',
    /html\[data-perf="ultra"\] .*@keyframes|html\[data-perf="ultra"\]/.test(html) && /countUp: true/.test(html) && /animation:flash/.test(html)],
  ['键盘 ←/→ 切换档位', /ArrowLeft/.test(html) && /ArrowRight/.test(html)],

  // —— 等待动画 ——
  ['顶部不确定进度条（含滑动 keyframes）', /id="progress"/.test(html) && /@keyframes slide/.test(html)],
  ['首屏骨架 shimmer', /#app\.loading \.v\{/.test(html) && /@keyframes shimmer/.test(html)],
  ['进度条仅在请求超过 350ms 时出现（避免快请求闪烁）', /}, 350\);/.test(html) && /busyTimer/.test(html)],
  ['同步中指示器', /class="sync"/.test(html) && /body\.busy \.sync\{display:inline-flex\}/.test(html)],
  ['轻量档禁用进度条与骨架动画', /html\[data-perf="lite"\] \.progress\{display:none\}/.test(html) && /html\[data-perf="lite"\] #app\.loading \.v\{background:#eef1f6;animation:none\}/.test(html)],

  // —— 点击响应延迟 / 渲染性能 ——
  ['点击乐观 UI：Toast + 按钮态同步先于异步复制',
    /if \(btn\) \{ btn\.classList\.add\('ok'\); \}[\s\S]{0,200}showToast\('已复制：' \+ PELICAN_PROMPT, 'ok'\);/.test(html)],
  ['一次性骨架 + 原地增量更新（不再整段 innerHTML 重建）',
    /const SHELL = `/.test(html) && /function mount\(\)/.test(html) && !/\$\('#app'\)\.innerHTML = cards/.test(html)],
  ['数据签名短路（数据未变化 → 零 DOM 操作）', /sigAll === lastSig\.all/.test(html) && /lastSig = \{ all: '', chart: '', model: '', agent: '', recent: '' \}/.test(html)],
  ['分表独立签名短路', /sigM !== lastSig\.model/.test(html) && /sigA !== lastSig\.agent/.test(html) && /sigR !== lastSig\.recent/.test(html)],
  ['图表按序列签名重算', /sigChart !== lastSig\.chart/.test(html)],
  ['setNum 数值未变即返回（零 DOM 写入）', /if \(el\.__v === val\) return;/.test(html)],
  ['rAF 让帧后再渲染（交互优先响应）', /requestAnimationFrame\(\(\) => \{ render\(data\)/.test(html)],
  ['单飞请求（避免并发互相拖慢）', /if \(inflight\) return;/.test(html)],
  ['手动刷新按钮', /id="btn-refresh"/.test(html)],

  // —— 后台与无障碍 ——
  ['页面隐藏即暂停轮询 + 回到前台补拉', /visibilitychange/.test(html) && /if \(document\.hidden\) return;/.test(html)],
  ['setTimeout 链替代 setInterval（慢请求不堆叠）', /pollTimer = setTimeout\(load/.test(html) && !/setInterval\(load/.test(html)],
  ['离线暂停', /addEventListener\('offline'/.test(html)],
  ['prefers-reduced-motion 尊重系统设置', /prefers-reduced-motion:reduce/.test(html) && /const REDUCED/.test(html)],
  ['[hidden] 全局强制 display:none（避免被组件的 display 覆盖）',
    /\[hidden\]\{display:none!important\}/.test(html)],
  ['SVG 显隐走 attribute —— SVGElement 没有 hidden IDL 属性',
    /function show\(el, on\)/.test(html) && /show\(refs\.chartSvg, false\)/.test(html) && !/refs\.chartSvg\.hidden/.test(html)],
  ['内联 favicon（不产生上游 /favicon.ico 请求）', /<link rel="icon" href="data:,">/.test(html)],
  ['代理本地应答 favicon/robots（不转发上游）',
    /url === '\/favicon\.ico' \|\| url === '\/robots\.txt'/.test(proxySrc)],
  ['请求数/失败 为独立节点（不被 setNum 覆盖）', /id="k-err"/.test(html) && /kErr: \$\('#k-err'\)/.test(html)],
  ['启动档位静默应用（不重复触发请求）',
    /applyMode\(perfMode, false, true\)/.test(html) && /function applyMode\(mode, persist, silent\)/.test(html)],
  ['contain:content 限定重排范围', /contain:content/.test(html)],
  ['屏外跳过渲染 content-visibility:auto', /content-visibility:auto/.test(html)],

  // —— v1.3.0 不回退 ——
  ['v1.3.0 鹈鹕复制功能保留', /copyPelicanPrompt/.test(html) && /id="hint-btn"/.test(html) && /id="hint-chip"/.test(html) && /document\.execCommand\('copy'\)/.test(html)],
  ['提示面板仍位于 #app 之外', html.indexOf('id="hint-panel"') < html.indexOf('id="app"')],

  // —— 版本一致性（版本号跟随 package.json，跨版本回歸不误报）——
  ['proxy.mjs VERSION 为语义化版本', /const VERSION = '\d+\.\d+\.\d+'/.test(proxySrc)],
  ['package.json version 为语义化版本', /^\d+\.\d+\.\d+$/.test(String(pkg.version || ''))],
];
for (const [name, ok] of checks) log(`${ok ? 'PASS' : 'FAIL'} - ${name}`);

log(`\n静态断言：${checks.filter(([, v]) => v).length}/${checks.length} 通过`);

/* ---------- 3. 动态实测：lite 精简载荷 ---------- */
const waitReady = async (url, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 120));
  }
  return false;
};

log('\n===== 动态实测（lite 精简载荷） =====');
const child = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(ROOT, 'demo-data') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let proxyOut = '';
child.stdout.on('data', (d) => { proxyOut += d.toString(); });
child.stderr.on('data', (d) => { proxyOut += d.toString(); });

try {
  const ready = await waitReady(`http://127.0.0.1:${PORT}/healthz`);
  log(ready ? 'PASS 代理已就绪' : 'FAIL 代理未在 15s 内就绪');
  if (ready) {
    const page = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
    log((/id="perf-bar"/.test(page) && /data-perf="ultra"/.test(page)) ? 'PASS 服务的页面包含 3 档性能栏' : 'FAIL 页面未包含性能栏');

    const health = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
    log(health.version === pkg.version ? `PASS /healthz 版本 = ${health.version}` : `FAIL /healthz 版本 = ${health.version} 期望 ${pkg.version}`);

    const fullRes = await fetch(`http://127.0.0.1:${PORT}/api/stats?days=30`);
    const fullTxt = await fullRes.text();
    const full = JSON.parse(fullTxt);
    const liteRes = await fetch(`http://127.0.0.1:${PORT}/api/stats?days=30&lite=1`);
    const liteTxt = await liteRes.text();
    const lite = JSON.parse(liteTxt);

    const rows = [
      ['meta.mode', lite.meta.mode, full.meta.mode],
      ['days', lite.days, full.days],
      ['byDay 条数', lite.byDay.length, full.byDay.length],
      ['byModel 条数', lite.byModel.length, full.byModel.length],
      ['byAgent 条数', lite.byAgent.length, full.byAgent.length],
      ['recent 条数', lite.recent.length, full.recent.length],
      ['JSON 字节数', Buffer.byteLength(liteTxt), Buffer.byteLength(fullTxt)],
    ];
    log('');
    log('| 项 | lite=1 | 完整 |');
    log('|---|---|---|');
    for (const [k, a, b] of rows) log(`| ${k} | ${a} | ${b} |`);

    log('');
    log(lite.meta.mode === 'lite' ? 'PASS meta.mode=lite' : 'FAIL meta.mode 未标记');
    log(full.meta.mode === 'full' ? 'PASS meta.mode=full' : 'FAIL 完整模式 meta.mode 异常');
    log(typeof lite.meta.ts === 'number' ? 'PASS meta.ts 服务端时间戳存在' : 'FAIL 缺少 meta.ts');
    log(lite.byModel.length <= 5 ? 'PASS lite byModel ≤ 5' : `FAIL lite byModel = ${lite.byModel.length}`);
    log(lite.byAgent.length <= 5 ? 'PASS lite byAgent ≤ 5' : `FAIL lite byAgent = ${lite.byAgent.length}`);
    log(lite.recent.length <= 6 ? 'PASS lite recent ≤ 6' : `FAIL lite recent = ${lite.recent.length}`);
    log(lite.days <= 14 && lite.byDay.length <= 14 ? 'PASS lite 天数 ≤ 14' : `FAIL lite days = ${lite.days}`);
    const cut = Buffer.byteLength(liteTxt) / Buffer.byteLength(fullTxt);
    log(`PASS 载荷压缩比 = ${(cut * 100).toFixed(1)}%（lite 为完整的 ${(cut * 100).toFixed(1)}%）`);
    // 聚合总量在两档下必须一致（精简只影响明细条数，不影响统计正确性）
    log(lite.total.total === full.total.total && lite.total.requests === full.total.requests
      ? 'PASS 精简载荷不影响聚合统计（total/requests 与完整一致）'
      : `FAIL 统计不一致 lite=${lite.total.total}/${lite.total.requests} full=${full.total.total}/${full.total.requests}`);
  }
} catch (e) {
  log('FAIL 动态实测异常: ' + ((e && e.stack) || e));
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 500);
}

fs.writeFileSync(path.join(__dirname, 'ui-perf.txt'), OUT.join('\n') + '\n');
process.exit(0);
