#!/usr/bin/env node
/**
 * v1.4.0 真实浏览器运行时校验（零依赖，直接用 CDP 驱动本机 Chrome/Edge）
 *   1) 启动代理（demo-data）
 *   2) 无头浏览器打开仪表盘，采集 JS 异常 / console error
 *   3) 断言：默认(进阶)渲染成功 → 切轻量(图表退化/动画全关/精简载荷) → 切极致(动效开启)
 *   4) 点击「提示」按钮验证乐观 UI 反馈
 *   5) 三档各截图一张（输出到 repo 之外，供人工核对）
 * v1.5.11：版本断言随版本升级（健康检查 / 页脚）。
 * v1.5.10：底栏（吸附弹窗）新增「⤢ 全量显示」按钮与窗口标题断言；小窗/完整页的入口可见性补测
 * 结果写入 test/browser-smoke.txt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT = 8801;
const CDP_PORT = 9333;
const SHOT_DIR = path.join(ROOT, 'test', 'shots');
const OUT = [];
const log = (s) => { OUT.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

let proxy = null, chrome = null, ws = null;
const cleanup = () => {
  try { ws && ws.close(); } catch { /* ignore */ }
  if (chrome) {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore' }); }
    catch { try { chrome.kill(); } catch { /* ignore */ } }
  }
  try { proxy && proxy.kill(); } catch { /* ignore */ }
};

/* ---------------- 极简 CDP 客户端 ---------------- */
function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const waiters = [];
    sock.addEventListener('open', () => resolve(api));
    sock.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || 'unknown'))));
    sock.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].method === msg.method) { waiters[i].res(msg.params); waiters.splice(i, 1); }
        }
        if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params);
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') logErrors.push(msg.params.entry.text);
      }
    });
    const exceptions = [], consoleErrors = [], logErrors = [];
    const api = {
      exceptions, consoleErrors, logErrors,
      send(method, params) {
        return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params: params || {} })); });
      },
      waitEvent(method, timeout = 10000) {
        return new Promise((res, rej) => {
          const w = { method, res };
          waiters.push(w);
          setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting ' + method)); } }, timeout);
        });
      },
      async eval(expr) {
        const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        return r.result && r.result.value;
      },
    };
  });
}

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(150);
  }
  return null;
}

/* ---------------- 主流程 ---------------- */
const checks = [];
const assert = (name, ok, extra) => { checks.push([name, !!ok, extra]); log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`); };

try {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  log('浏览器: ' + CHROME);

  // v1.5.5：清理可能残留的服务商切换状态，保证默认激活 stepfun（demo-data 已被 gitignore）
  try { fs.rmSync(path.join(ROOT, 'demo-data', 'providers.json'), { force: true }); } catch { /* ignore */ }

  proxy = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(ROOT, 'demo-data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const z = await waitHttp(`http://127.0.0.1:${PORT}/healthz`);
  assert('代理就绪且版本 1.5.11', z && z.version === '1.5.11', z ? 'version=' + z.version : 'no response');
  if (!z) throw new Error('代理未就绪');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prof-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1600', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', (d) => { chromeLog += d.toString(); });

  const ver = await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
  if (!ver) throw new Error('CDP 未就绪: ' + chromeLog.slice(0, 300));
  log('浏览器: ' + ver.Browser);

  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('无可用页面目标');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1500, deviceScaleFactor: 1, mobile: false });

  const goto = async (url) => {
    const loaded = cdp.waitEvent('Page.loadEventFired', 15000).catch(() => null);
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(700);                                    // 让 fetch + rAF 渲染跑完
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  };

  /* ===== 1. 默认档位（进阶） ===== */
  await goto(`http://127.0.0.1:${PORT}/`);
  assert('默认档位 = 进阶', (await cdp.eval('document.documentElement.dataset.perf')) === 'balanced');
  const kTotal = await cdp.eval("document.querySelector('#k-total').textContent");
  assert('KPI 已渲染真实数值（非占位符）', /^[\d,]+$/.test(kTotal), 'k-total=' + kTotal);
  const kErr = await cdp.eval("document.querySelector('#k-err').textContent");
  assert('请求数/失败 副值独立渲染（未被覆盖）', /^\/ [\d,]+$/.test(kErr), 'k-err=' + kErr);
  assert('骨架 loading 已移除', !(await cdp.eval("document.querySelector('#app').classList.contains('loading')")));
  assert('图表 SVG 已绘制', (await cdp.eval("document.querySelector('#chart-svg').children.length")) > 10);
  assert('模型排行有数据行', (await cdp.eval("document.querySelectorAll('#tb-model tr').length")) > 0);
  assert('最近请求有数据行', (await cdp.eval("document.querySelectorAll('#tb-recent tr').length")) > 0);
  const sub91 = await cdp.eval("document.querySelector('#sub').textContent");
  assert('页脚显示 v1.5.11 与轮询间隔', sub91.includes('v1.5.11') && sub91.includes('30s'), sub91.slice(0, 90));
  const s1 = await shot('shot-balanced.png');
  log('截图: ' + s1);

  /* ===== 1b. v1.5.5 服务商切换器 ===== */
  assert('服务商切换器可见且默认激活 StepFun',
    (await cdp.eval("getComputedStyle(document.querySelector('#prov-bar')).display")) !== 'none'
    && (await cdp.eval("document.querySelector('#prov-current').textContent")).includes('StepFun'));
  const provItems = await cdp.eval("document.querySelectorAll('#prov-menu .prov-item').length");
  assert('服务商菜单含全部内置服务商（≥7）', provItems >= 7, 'items=' + provItems);
  await cdp.eval("document.querySelector('#prov-current').click()");
  assert('点击展开服务商菜单', !(await cdp.eval("document.querySelector('#prov-menu').hasAttribute('hidden')")));
  await cdp.eval("document.querySelector('#prov-menu .prov-item[data-key=\"deepseek\"]').click()");
  await sleep(900);
  const curAfter = await cdp.eval("document.querySelector('#prov-current').textContent");
  assert('一键切换服务商生效（DeepSeek）', curAfter.includes('DeepSeek'), curAfter);
  const subProv = await cdp.eval("document.querySelector('#sub').textContent");
  assert('页脚同步显示当前服务商', subProv.includes('DeepSeek'), subProv.slice(0, 120));
  const bpRows = await cdp.eval("document.querySelectorAll('#tb-provider tr').length");
  assert('服务商用量表已渲染', bpRows > 0, 'rows=' + bpRows);
  // 切回 stepfun，避免影响后续段落的默认态断言
  await cdp.eval("document.querySelector('#prov-current').click(), document.querySelector('#prov-menu .prov-item[data-key=\"stepfun\"]').click()");
  await sleep(900);

  /* ===== 2. 签名短路：重复刷新不应重建 DOM ===== */
  await cdp.eval("document.querySelector('#k-total').dataset.mark='1'");
  await cdp.eval("document.querySelector('#btn-refresh').click()");
  await sleep(900);
  assert('数据未变化时零 DOM 写入（节点标记未被重建销毁）',
    (await cdp.eval("document.querySelector('#k-total').dataset.mark")) === '1');

  /* ===== 3. 轻量档 ===== */
  await cdp.eval("localStorage.setItem('sfm:perf','lite')");
  await goto(`http://127.0.0.1:${PORT}/`);
  assert('轻量档已生效', (await cdp.eval('document.documentElement.dataset.perf')) === 'lite');
  assert('轻量档不绘制 SVG 图表', (await cdp.eval("document.querySelector('#chart-svg').hasAttribute('hidden') && document.querySelector('#chart-svg').children.length===0")));
  assert('轻量档显示文字摘要', (await cdp.eval("!document.querySelector('#chart-text').hidden && document.querySelector('#chart-text').textContent.includes('轻量模式')")));
  assert('轻量档图例已真正隐藏（[hidden] 未被组件样式覆盖）',
    (await cdp.eval("getComputedStyle(document.querySelector('#chart-legend')).display")) === 'none');
  assert('轻量档 SVG 已真正隐藏', (await cdp.eval("getComputedStyle(document.querySelector('#chart-svg')).display")) === 'none');
  assert('轻量档摘要面板不留大片空白（高度 < 200px）',
    (await cdp.eval("document.querySelector('#p-chart').offsetHeight")) < 200,
    'panelHeight=' + (await cdp.eval("document.querySelector('#p-chart').offsetHeight")));
  assert('轻量档进度条 display:none',
    (await cdp.eval("getComputedStyle(document.querySelector('#progress')).display")) === 'none');
  assert('轻量档过渡已关闭（transition-duration=0s）',
    (await cdp.eval("getComputedStyle(document.querySelector('.card')).transitionDuration")) === '0s');
  assert('轻量档动画已关闭（.v 无 shimmer 帧动画）',
    (await cdp.eval("getComputedStyle(document.querySelector('.card .v')).animationName")) === 'none');
  assert('轻量档阴影已关闭',
    (await cdp.eval("getComputedStyle(document.querySelector('.card')).boxShadow")) === 'none');
  assert('轻量档排行榜 ≤ 5 行', (await cdp.eval("document.querySelectorAll('#tb-model tr').length")) <= 5);
  const liteMeta = await cdp.eval("fetch('/api/stats?days=14&lite=1').then(r=>r.json()).then(d=>d.meta.mode)");
  assert('轻量档走 lite=1 精简载荷', liteMeta === 'lite', 'meta.mode=' + liteMeta);
  const subLite = await cdp.eval("document.querySelector('#sub').textContent");
  assert('页脚提示轻量轮询 120s', subLite.includes('120s'), subLite.slice(0, 90));
  assert('轻量档按钮高亮正确', (await cdp.eval("document.querySelector('button[data-perf=\"lite\"]').getAttribute('aria-pressed')")) === 'true');
  const s2 = await shot('shot-lite.png');
  log('截图: ' + s2);

  /* ===== 4. 极致档 ===== */
  await cdp.eval("localStorage.setItem('sfm:perf','ultra')");
  await goto(`http://127.0.0.1:${PORT}/`);
  assert('极致档已生效', (await cdp.eval('document.documentElement.dataset.perf')) === 'ultra');
  assert('极致档图表已绘制', (await cdp.eval("document.querySelector('#chart-svg').children.length")) > 10);
  const animName = await cdp.eval("getComputedStyle(document.querySelector('.cards .card')).animationName");
  assert('极致档入场动效已启用', animName === 'rise', 'animation-name=' + animName);
  assert('极致档数字滚动已启用（MODES 中 countUp=true）',
    (await cdp.eval("MODES && MODES.ultra.countUp === true")) === true);
  const subUltra = await cdp.eval("document.querySelector('#sub').textContent");
  assert('页脚提示极致轮询 10s', subUltra.includes('10s'), subUltra.slice(0, 90));
  const s3 = await shot('shot-ultra.png');
  log('截图: ' + s3);

  /* ===== 4b. v1.5.0 嵌入布局：底栏 / 小窗 / 完整页 ===== */
  // 底栏（吸附弹窗）：只留 KPI 横条，性能档位栏隐藏，走 lite 载荷，标题栏提供「全量显示」
  await goto(`http://127.0.0.1:${PORT}/?layout=panel`);
  assert('底栏模式 data-layout=panel', (await cdp.eval('document.documentElement.dataset.layout')) === 'panel');
  assert('底栏 KPI 已渲染', /^[\d,]+$/.test(await cdp.eval("document.querySelector('#k-total').textContent")));
  assert('底栏性能档位栏已隐藏', (await cdp.eval("getComputedStyle(document.querySelector('#perf-bar')).display")) === 'none');
  assert('底栏长表格区已隐藏', (await cdp.eval("document.querySelector('#p-recent').offsetHeight")) === 0);
  assert('底栏隐藏服务商切换器', (await cdp.eval("getComputedStyle(document.querySelector('#prov-bar')).display")) === 'none');
  assert('底栏模式自身切换链接隐藏', (await cdp.eval("getComputedStyle(document.querySelector('#lnk-panel')).display")) === 'none');
  // v1.5.10：旧入口 btn-open 位于已隐藏的档位栏内（父隐藏 → 实际不可见），改由标题栏 btn-full 承担
  assert('底栏「全量显示」按钮可见（吸附弹窗独立页入口）',
    (await cdp.eval("getComputedStyle(document.querySelector('#btn-full')).display")) !== 'none');
  assert('底栏「全量显示」指向完整页并新窗打开',
    (await cdp.eval("document.querySelector('#btn-full').getAttribute('href') + '|' + document.querySelector('#btn-full').getAttribute('target')")) === '/|_blank');
  assert('底栏窗口标题含「吸附弹窗」', (await cdp.eval('document.title')).includes('吸附弹窗'), await cdp.eval('document.title'));
  assert('底栏档位栏内的旧浏览器入口实际不可见（父级隐藏）',
    (await cdp.eval("getComputedStyle(document.querySelector('#btn-open')).display")) !== 'none'
    && (await cdp.eval("getComputedStyle(document.querySelector('#perf-bar')).display")) === 'none');
  assert('底栏走 lite=1 精简载荷',
    (await cdp.eval("performance.getEntriesByType('resource').some(e=>e.name.includes('lite=1'))")) === true);
  const panelH = await cdp.eval('document.body.scrollHeight');
  assert('底栏整页高度紧凑（< 320px）', panelH < 320, 'scrollHeight=' + panelH);
  const s4 = await shot('shot-panel.png');
  log('截图: ' + s4);

  // 小窗：KPI + 图表保留，长表格隐藏
  await goto(`http://127.0.0.1:${PORT}/?layout=window`);
  assert('小窗模式 data-layout=window', (await cdp.eval('document.documentElement.dataset.layout')) === 'window');
  assert('小窗图表已绘制', (await cdp.eval("document.querySelector('#chart-svg').children.length")) > 10);
  assert('小窗隐藏模型排行', (await cdp.eval("getComputedStyle(document.querySelector('#p-models')).display")) === 'none');
  assert('小窗隐藏客户端排行', (await cdp.eval("getComputedStyle(document.querySelector('#p-agents')).display")) === 'none');
  assert('小窗隐藏最近请求', (await cdp.eval("getComputedStyle(document.querySelector('#p-recent')).display")) === 'none');
  assert('小窗隐藏提示面板', (await cdp.eval("getComputedStyle(document.querySelector('#hint-panel')).display")) === 'none');
  assert('小窗隐藏服务商用量表', (await cdp.eval("getComputedStyle(document.querySelector('#p-providers')).display")) === 'none');
  assert('小窗保留「↗ 浏览器页」独立入口', (await cdp.eval("getComputedStyle(document.querySelector('#btn-open')).display")) !== 'none');
  assert('小窗隐藏「全量显示」按钮（仅底栏需要）', (await cdp.eval("getComputedStyle(document.querySelector('#btn-full')).display")) === 'none');
  assert('小窗窗口标题含「小窗」', (await cdp.eval('document.title')).includes('小窗'), await cdp.eval('document.title'));
  const winH = await cdp.eval('document.body.scrollHeight');
  assert('小窗整页高度紧凑（< 760px）', winH < 760, 'scrollHeight=' + winH);
  const s5 = await shot('shot-window.png');
  log('截图: ' + s5);

  // 完整页：独立浏览器入口隐藏，两个嵌入入口可见
  await goto(`http://127.0.0.1:${PORT}/`);
  assert('完整页隐藏独立浏览器入口', (await cdp.eval("getComputedStyle(document.querySelector('#btn-open')).display")) === 'none');
  assert('完整页隐藏「全量显示」按钮', (await cdp.eval("getComputedStyle(document.querySelector('#btn-full')).display")) === 'none');
  assert('完整页提供小窗/底栏入口',
    (await cdp.eval("getComputedStyle(document.querySelector('#lnk-window')).display !== 'none' && getComputedStyle(document.querySelector('#lnk-panel')).display !== 'none'")) === true);
  assert('完整页显示服务商用量表面板',
    (await cdp.eval("getComputedStyle(document.querySelector('#p-providers')).display")) !== 'none');

  /* ===== 5. 点击即时反馈（乐观 UI） ===== */
  const stubClipboard = async (source) => {
    const r = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await goto(`http://127.0.0.1:${PORT}/`);
    return r.identifier;
  };

  // 5a. 成功路径：剪贴板可用 → 点击瞬间即应显示「已复制」并变绿
  let sid = await stubClipboard("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.resolve()}});");
  const t0 = Date.now();
  await cdp.eval("document.getElementById('hint-btn').click()");
  const okToastCls = await cdp.eval("document.querySelector('#toast').className");
  const okToastTxt = await cdp.eval("document.querySelector('#toast').textContent");
  const dt = Date.now() - t0;
  assert('复制成功路径：点击后立即出现「已复制」Toast（乐观 UI）',
    okToastCls.includes('show') && okToastTxt.includes('已复制'), `${dt}ms · ${okToastTxt}`);
  assert('点击后按钮同步变绿', (await cdp.eval("document.getElementById('hint-btn').classList.contains('ok')")) === true);
  assert('提示词芯片也可触发复制',
    (await cdp.eval("document.getElementById('hint-chip').click(), document.querySelector('#toast').textContent.includes('已复制')")) === true);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid });

  // 5b. 失败路径：剪贴板被拒且 execCommand 不可用 → 必须回滚为错误 Toast，不得静默失败
  sid = await stubClipboard("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});document.execCommand=()=>false;");
  await cdp.eval("document.getElementById('hint-btn').click()");
  await sleep(300);
  const badCls = await cdp.eval("document.querySelector('#toast').className");
  const badTxt = await cdp.eval("document.querySelector('#toast').textContent");
  assert('复制失败路径：回滚为错误 Toast（不静默失败）', badCls.includes('err') && badTxt.includes('复制失败'), badTxt);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid });

  /* ===== 6. 运行期无 JS 异常 ===== */
  const exCount = cdp.exceptions.length + cdp.logErrors.length;
  assert('运行期无未捕获异常 / 控制台错误', exCount === 0,
    cdp.exceptions.map((e) => (e.exception && e.exception.description || e.text) || '').join(' | ').slice(0, 300)
    + cdp.logErrors.join(' | ').slice(0, 200));

  log('');
  const passed = checks.filter(([, ok]) => ok).length;
  log(`运行时断言：${passed}/${checks.length} 通过`);
  if (passed !== checks.length) log('FAILED: ' + checks.filter(([, ok]) => !ok).map(([n]) => n).join(' / '));
} catch (e) {
  log('EXCEPTION: ' + ((e && e.stack) || e));
} finally {
  cleanup();
  fs.writeFileSync(path.join(__dirname, 'browser-smoke.txt'), OUT.join('\n') + '\n');
  await sleep(300);
  process.exit(0);
}
