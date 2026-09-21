#!/usr/bin/env node
/**
 * 第一轮优化基准（旧版 v1.0.1 vs 新版 v1.1.0）—— 结果写入 test/bench-result.txt
 *
 *  A1. 空数据冷启动（纯启动开销，各跑 2 次取快值）
 *  A2. 20 万条历史首次启动：监听就绪 / 历史就绪 / 常驻内存
 *  C.  /api/stats 延迟（旧版存活时测：20 次串行 + 50 并发）
 *  A3. 二次启动（命中聚合快照）
 *  D.  并发转发：300 并发非流式（上游 30ms 延迟）+ 60 并发流式
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const MOCK_PORT = 18991, PORT_OLD = 18981, PORT_NEW = 18982;
const LOGDIR = path.join(__dirname, 'bench-logs');
fs.mkdirSync(LOGDIR, { recursive: true });

const OUT = [];
const flush = () => { try { fs.writeFileSync(path.join(__dirname, 'bench-result.txt'), OUT.join('\n') + '\n'); } catch { /* ignore */ } };
const log = (s) => { OUT.push(s); flush(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (b) => Math.round((b || 0) / 1048576);
const pct = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function rssOf(pid) {
  for (let i = 0; i < 4; i++) {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.WorkingSet64}`], { encoding: 'utf8', timeout: 20000 });
      const v = parseInt(out.trim(), 10);
      if (Number.isFinite(v) && v > 0) return v;
    } catch { /* retry */ }
    try { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},150)'], { timeout: 5000, stdio: 'ignore' }); } catch { /* ignore */ }
  }
  return 0;
}

function get(port, p, timeout = 60000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: p, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
const postJson = (port, p) => new Promise((resolve) => {
  const req = http.request({ hostname: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-length': 0 } }, (res) => { res.resume(); res.on('end', resolve); });
  req.on('error', () => resolve(null));
  req.end();
});
function post(port, payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    const t0 = Date.now();
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'bench/1.0', 'content-length': body.length },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve({ ms: Date.now() - t0, status: res.statusCode }));
      res.on('error', () => resolve({ ms: Date.now() - t0, status: 0 }));
    });
    req.on('error', () => resolve({ ms: Date.now() - t0, status: 0 }));
    req.end(body);
  });
}

function startProxy(script, label, port, dataDir, extraEnv = {}) {
  const logFile = path.join(LOGDIR, `${label}.log`);
  const stream = fs.createWriteStream(logFile);
  const child = spawn(NODE, [script], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, TARGET_URL: `http://127.0.0.1:${MOCK_PORT}`, SNAPSHOT_MS: '20000', MOCK_NOLOG: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  return { child, logFile };
}
const childLog = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const grab = (f, re) => { const m = childLog(f).match(re); return m ? m[0] : '(无)'; };

const waitListen = async (port, timeoutMs = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await get(port, '/healthz');
    if (h && h.ok) return Date.now() - t0;
    await sleep(10);
  }
  return -1;
};
const waitLoaded = async (port, timeoutMs = 300000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await get(port, '/api/stats?days=30');
    if (s && s.meta && s.meta.loading === false) return Date.now() - t0;
    await sleep(20);
  }
  return -1;
};
const stop = async (child) => { try { child.kill(); } catch { /* ignore */ } await sleep(500); };

(async () => {
  log('========== stepfun-usage-monitor 第一轮优化基准（v1.0.1 → v1.1.0） ==========');
  log(`运行环境：Node ${process.version} · ${process.platform} · 本机回环 mock 上游`);

  /* ---- 数据集 ---- */
  const BASE = path.join(__dirname, 'bench-base.jsonl');
  if (!fs.existsSync(BASE) || fs.statSync(BASE).size < 5 * 1024 * 1024) {
    log('生成基准数据集（20 万条）…');
    let seed = 20260922;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const AGENTS = ['ZCode/智谱', 'Cline', 'Claude', 'Cherry Studio', 'Continue'];
    const MODELS = ['step-2-16k', 'step-2-mini', 'step-1v-8k', 'step-2-32k'];
    const chunks = [];
    const now = Date.now();
    for (let i = 0; i < 200000; i++) {
      const p = 200 + Math.floor(rnd() * 9000), c = 50 + Math.floor(rnd() * 2000);
      chunks.push(JSON.stringify({ ts: new Date(now - Math.floor(rnd() * 30 * 86400000)).toISOString(), agent: AGENTS[Math.floor(rnd() * 5)], path: '/v1/chat/completions', model: MODELS[Math.floor(rnd() * 4)], status: rnd() < 0.02 ? 429 : 200, prompt_tokens: p, completion_tokens: c, total_tokens: p + c, latency_ms: 200 }));
      if (chunks.length === 5000) { fs.appendFileSync(BASE, chunks.join('\n') + '\n'); chunks.length = 0; }
    }
    if (chunks.length) fs.appendFileSync(BASE, chunks.join('\n') + '\n');
  }
  log(`基准数据集：200,000 条 / ${(fs.statSync(BASE).size / 1048576).toFixed(1)} MB`);

  const OLD = path.join(__dirname, 'bench-old-proxy.mjs');
  fs.writeFileSync(OLD, execFileSync('git', ['show', 'HEAD:proxy.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));

  const dirOld = path.join(__dirname, 'bench-old'), dirNew = path.join(__dirname, 'bench-new');
  const dirOldEmpty = path.join(__dirname, 'bench-old-empty'), dirNewEmpty = path.join(__dirname, 'bench-new-empty');
  for (const d of [dirOld, dirNew]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(BASE, path.join(d, 'usage.jsonl')); }
  for (const d of [dirOldEmpty, dirNewEmpty]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

  const mock = spawn(NODE, [path.join(__dirname, 'mock-upstream.mjs')], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_NOLOG: '1' }, stdio: 'ignore' });
  await sleep(700);

  /* ============ A1. 空数据冷启动（纯启动开销） ============ */
  log('\n---------- A1. 空数据冷启动（不含历史加载，各 2 次取快值） ----------');
  const bootOnly = async (script, port, dir, label) => {
    const times = [];
    for (let i = 0; i < 2; i++) {
      const p = startProxy(script, `${label}-boot${i}`, port, dir);
      times.push(await waitListen(port));
      await stop(p.child);
    }
    return Math.min(...times);
  };
  const bootOld = await bootOnly(OLD, PORT_OLD, dirOldEmpty, 'old');
  const bootNew = await bootOnly(path.join(ROOT, 'proxy.mjs'), PORT_NEW, dirNewEmpty, 'new');
  log(`[旧版] 空数据监听就绪 ${bootOld} ms   [新版] ${bootNew} ms（差异来自 Node 启动抖动与模块规模）`);

  /* ============ A2. 20 万条历史首次启动 ============ */
  log('\n---------- A2. 20 万条历史·首次启动（无快照） ----------');
  const o1 = startProxy(OLD, 'old-run1', PORT_OLD, dirOld);
  const oListen = await waitListen(PORT_OLD);
  const oRss = rssOf(o1.child.pid);
  const oStats = await get(PORT_OLD, '/api/stats?days=30');
  log(`[旧版 v1.0.1] 可服务（含同步全量加载）${oListen} ms · RSS ${mb(oRss)} MB · 聚合 ${oStats ? oStats.total.requests : '?'} 条`);

  // 旧版存活期间测统计接口（关键：必须在其存活时测）
  const statsBench = async (label, port, times) => {
    const serial = [];
    for (let i = 0; i < times; i++) { const t0 = Date.now(); const r = await get(port, '/api/stats?days=30'); serial.push(r ? Date.now() - t0 : -1); }
    const t1 = Date.now();
    await Promise.all(Array.from({ length: 50 }, () => get(port, '/api/stats?days=30')));
    const concWall = Date.now() - t1;
    const okSerial = serial.filter((x) => x >= 0);
    log(`[${label}] /api/stats 串行 ${times} 次：平均 ${avg(okSerial).toFixed(2)} ms · p95 ${pct(okSerial, 0.95)} ms · 最大 ${Math.max(...okSerial)} ms；50 并发总耗时 ${concWall} ms`);
    return { avg: avg(okSerial), p95: pct(okSerial, 0.95), conc: concWall };
  };
  const sOld = await statsBench('旧版 v1.0.1', PORT_OLD, 20);
  await stop(o1.child);

  const n1 = startProxy(path.join(ROOT, 'proxy.mjs'), 'new-run1', PORT_NEW, dirNew);
  const nListen = await waitListen(PORT_NEW);
  const nLoaded = await waitLoaded(PORT_NEW);
  await sleep(500);   // 等内部日志落盘
  const nStats = await get(PORT_NEW, '/api/stats?days=30');
  const nRss = nStats.meta.memoryMB * 1048576;
  log(`[新版 v1.1.0] 监听就绪 ${nListen} ms（先可服务）· 历史就绪 +${nLoaded} ms（总计 ${nListen + nLoaded} ms）· RSS ${mb(nRss)} MB · 聚合 ${nStats.total.requests} 条`);
  log(`            内部日志：${grab(n1.logFile, /监听就绪[^\n]*/)}`);
  log(`            内部日志：${grab(n1.logFile, /\[history\][^\n]*/)}`);
  const sNew = await statsBench('新版 v1.1.0', PORT_NEW, 20);

  log('\n  ⇒ 冷启动：可服务 ${old} → ${new}'.replace('${old}', String(oListen)).replace('${new}', String(nListen)));
  log(`  ⇒ 全量就绪耗时：${oListen} ms → ${nListen + nLoaded} ms`);
  log(`  ⇒ 常驻内存：${mb(oRss)} MB → ${mb(nRss)} MB（↓${(100 - nRss / Math.max(oRss, 1) * 100).toFixed(0)}%）`);
  log(`  ⇒ /api/stats 平均延迟：${sOld.avg.toFixed(2)} ms → ${sNew.avg.toFixed(2)} ms（↓${(100 - sNew.avg / Math.max(sOld.avg, 0.01) * 100).toFixed(0)}%）；p95 ${sOld.p95} → ${sNew.p95} ms`);
  log(`  ⇒ /api/stats 50 并发总耗时：${sOld.conc} ms → ${sNew.conc} ms`);

  /* ============ A3. 二次启动（命中快照） ============ */
  log('\n---------- A3. 二次启动（命中聚合快照） ----------');
  await postJson(PORT_NEW, '/api/snapshot');   // 触发一次落盘（模拟正常关机/定时快照）
  await sleep(200);
  await stop(n1.child);
  const snapPath = path.join(dirNew, 'aggregate.json');
  const snapSize = fs.existsSync(snapPath) ? fs.statSync(snapPath).size : 0;
  log(`聚合快照：${snapSize ? (snapSize / 1024).toFixed(1) + ' KB' : '未生成（异常）'}`);

  const n2 = startProxy(path.join(ROOT, 'proxy.mjs'), 'new-run2', PORT_NEW, dirNew);
  const n2Listen = await waitListen(PORT_NEW);
  const n2Loaded = await waitLoaded(PORT_NEW);
  await sleep(500);
  const n2Stats = await get(PORT_NEW, '/api/stats?days=30');
  log(`[新版 v1.1.0 二次启动] 监听就绪 ${n2Listen} ms · 历史就绪 +${n2Loaded} ms（总计 ${n2Listen + n2Loaded} ms）· RSS ${n2Stats.meta.memoryMB} MB`);
  log(`            内部日志：${grab(n2.logFile, /\[history\][^\n]*/)}`);
  log(`            一致性校验：聚合 ${n2Stats.total.requests} 条（首次 ${nStats.total.requests} 条）→ ${n2Stats.total.requests === nStats.total.requests ? 'PASS' : 'FAIL'}`);
  await stop(n2.child);

  /* ============ D. 并发转发 ============ */
  log('\n---------- D. 并发转发（mock 上游，30ms 模拟推理延迟） ----------');
  try { mock.kill(); } catch { /* ignore */ }
  await sleep(300);
  const mockDelay = spawn(NODE, [path.join(__dirname, 'mock-upstream.mjs')], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_DELAY: '30', MOCK_NOLOG: '1' }, stdio: 'ignore' });
  await sleep(700);

  const concTest = async (label, script, port, dataDir, tag) => {
    const p = startProxy(script, tag, port, dataDir);
    await waitListen(port);
    await waitLoaded(port);
    await sleep(500);
    const N = 300;
    const t0 = Date.now();
    const res = await Promise.all(Array.from({ length: N }, () => post(port, { model: 'step-2-16k', messages: [{ role: 'user', content: 'x'.repeat(200) }] })));
    const wall = Date.now() - t0;
    const lat = res.map((r) => r.ms);
    const ok = res.filter((r) => r.status === 200).length;
    const st = await get(port, '/api/stats?days=30');
    const mem = st && st.meta && st.meta.memoryMB ? st.meta.memoryMB * 1048576 : rssOf(p.child.pid);

    const M = 60;
    const t1 = Date.now();
    await Promise.all(Array.from({ length: M }, () => post(port, { model: 'step-2-mini', stream: true, messages: [{ role: 'user', content: 'y' }] })));
    const wallS = Date.now() - t1;
    const st2 = await get(port, '/api/stats?days=30');
    const mem2 = st2 && st2.meta && st2.meta.memoryMB ? st2.meta.memoryMB * 1048576 : rssOf(p.child.pid);
    log(`[${label}] 非流式 300 并发：${wall} ms · ${(N / wall * 1000).toFixed(0)} req/s · p50 ${pct(lat, 0.5)} ms · p95 ${pct(lat, 0.95)} ms · 最大 ${Math.max(...lat)} ms · 成功 ${ok}/${N} · RSS ${mb(mem)} MB`);
    log(`[${label}] 流式 60 并发：${wallS} ms · 平均 ${(wallS / M).toFixed(1)} ms/req · RSS ${mb(mem2)} MB`);
    await stop(p.child);
    return { wall, p95: pct(lat, 0.95), mem2 };
  };

  const dOld = await concTest('旧版 v1.0.1', OLD, PORT_OLD, dirOld, 'old-conc');
  await sleep(400);
  const dNew = await concTest('新版 v1.1.0', path.join(ROOT, 'proxy.mjs'), PORT_NEW, dirNew, 'new-conc');

  /* ============ 汇总 ============ */
  log('\n========== 汇总（旧版 v1.0.1 → 新版 v1.1.0） ==========');
  log(`冷启动可服务        : ${oListen} ms → ${nListen} ms（↓${(100 - nListen / Math.max(oListen, 1) * 100).toFixed(0)}%）`);
  log(`全量历史就绪        : ${oListen} ms → ${nListen + nLoaded} ms；命中快照后 ${n2Listen + n2Loaded} ms`);
  log(`加载后常驻内存      : ${mb(oRss)} MB → ${mb(nRss)} MB（↓${(100 - nRss / Math.max(oRss, 1) * 100).toFixed(0)}%）`);
  log(`/api/stats 平均延迟 : ${sOld.avg.toFixed(2)} ms → ${sNew.avg.toFixed(2)} ms`);
  log(`300 并发吞吐        : ${(300 / dOld.wall * 1000).toFixed(0)} → ${(300 / dNew.wall * 1000).toFixed(0)} req/s`);
  log(`300 并发 p95        : ${dOld.p95} ms → ${dNew.p95} ms`);
  log(`并发压测后内存      : ${mb(dOld.mem2)} MB → ${mb(dNew.mem2)} MB`);
  try { mockDelay.kill(); } catch { /* ignore */ }
  flush();
  process.exit(0);
})();
