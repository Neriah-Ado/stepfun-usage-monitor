#!/usr/bin/env node
/**
 * 并行回放正确性校验：同一数据集分别以「顺序回放」与「worker 并行回放」加载，
 * 比对 totals / byDay / byModel / byAgent / recent 是否完全一致。
 * 结果写入 test/replay-parity.txt
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const OUT = [];
const flush = () => { try { fs.writeFileSync(path.join(__dirname, 'replay-parity.txt'), OUT.join('\n') + '\n'); } catch { /* ignore */ } };
const log = (s) => { OUT.push(s); flush(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const get = (port, p) => new Promise((resolve) => {
  const req = http.get({ hostname: '127.0.0.1', port, path: p, timeout: 60000 }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});

const run = async (label, port, dataDir, workers) => {
  const child = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, REPLAY_WORKERS: String(workers), TARGET_URL: 'http://127.0.0.1:1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 600; i++) {
    const s = await get(port, '/api/stats?days=365');
    if (s && s.meta && s.meta.loading === false) { child.kill(); await sleep(300); return { label, workers, stats: s }; }
    await sleep(50);
  }
  child.kill();
  await sleep(300);
  return { label, workers, stats: null };
};

const norm = (s) => JSON.stringify({
  total: s.total,
  byDay: s.byDay.map((d) => [d.day, d.requests, d.prompt, d.completion, d.total]),
  byModel: [...s.byModel].sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.name, m.requests, m.total]),
  byAgent: [...s.byAgent].sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.name, m.requests, m.total]),
  recent: s.recent.map((r) => [r.ts, r.agent, r.model, r.total_tokens]),
});

(async () => {
  const BASE = path.join(__dirname, 'bench-base.jsonl');
  if (!fs.existsSync(BASE)) { log('缺少 bench-base.jsonl，请先运行 test/bench.mjs'); flush(); process.exit(1); }
  const sizeMB = (fs.statSync(BASE).size / 1048576).toFixed(1);
  log(`数据集：200,000 条 / ${sizeMB} MB`);

  const dirSerial = path.join(__dirname, 'parity-serial');
  const dirParallel = path.join(__dirname, 'parity-parallel');
  for (const d of [dirSerial, dirParallel]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(BASE, path.join(d, 'usage.jsonl')); }

  log('\n[1/2] 顺序回放（REPLAY_WORKERS=0）…');
  const t0 = Date.now();
  const serial = await run('顺序', 18971, dirSerial, 0);
  log(`  完成，用时 ${Date.now() - t0} ms`);

  log('[2/2] 并行回放（REPLAY_WORKERS=4）…');
  const t1 = Date.now();
  const parallel = await run('并行', 18972, dirParallel, 4);
  log(`  完成，用时 ${Date.now() - t1} ms`);

  if (!serial.stats || !parallel.stats) { log('FAIL - 有实例未在时限内完成加载'); flush(); process.exit(1); }

  const a = norm(serial.stats), b = norm(parallel.stats);
  log(`\n顺序聚合：请求 ${serial.stats.total.requests} · tokens ${serial.stats.total.total} · 模型 ${serial.stats.byModel.length} 种 · 客户端 ${serial.stats.byAgent.length} 个`);
  log(`并行聚合：请求 ${parallel.stats.total.requests} · tokens ${parallel.stats.total.total} · 模型 ${parallel.stats.byModel.length} 种 · 客户端 ${parallel.stats.byAgent.length} 个`);
  log(`逐字段比对（totals/byDay/byModel/byAgent/recent）：${a === b ? 'PASS 完全一致' : 'FAIL 不一致'}`);
  if (a !== b) {
    fs.writeFileSync(path.join(__dirname, 'parity-serial.json'), a);
    fs.writeFileSync(path.join(__dirname, 'parity-parallel.json'), b);
    log('  差异明细已写入 parity-serial.json / parity-parallel.json');
  }
  flush();
  process.exit(a === b ? 0 : 2);
})();
