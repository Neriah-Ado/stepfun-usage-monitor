#!/usr/bin/env node
/**
 * 历史回放 worker（worker_threads）：在独立线程内聚合 [start, end) 字节区间。
 * 由 proxy.mjs 调用；每个 worker 返回可加和的局部聚合结果，由主线程合并。
 * 区间边界由主线程按 '\n' 对齐，因此本 worker 只处理完整行。
 */
import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

const { file: FILE, start, end, recentMax } = workerData;

const totals = { requests: 0, errors: 0, prompt: 0, completion: 0, total: 0 };
const byDay = new Map(), byModel = new Map(), byAgent = new Map();
const recents = new Array(recentMax);
let head = 0, count = 0;

const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
const dayCache = new Map();
function dayKeyOf(tsStr, tsMs) {
  const k = tsStr.slice(0, 16);
  let v = dayCache.get(k);
  if (v === undefined) { if (dayCache.size > 5000) dayCache.clear(); v = dayKey(tsMs); dayCache.set(k, v); }
  return v;
}
function bump(map, key, p, c, t) {
  let b = map.get(key);
  if (b === undefined) { b = { name: key, requests: 0, prompt: 0, completion: 0, total: 0 }; map.set(key, b); }
  b.requests++; b.prompt += p; b.completion += c; b.total += t;
}

(async () => {
  const stream = fs.createReadStream(FILE, { start, end: Math.max(start, end - 1), encoding: 'utf8' });
  let rest = '';
  for await (const chunk of stream) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (line.length <= 1) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const p = rec.prompt_tokens || 0, c = rec.completion_tokens || 0, t = rec.total_tokens || (p + c);
      totals.requests++;
      if ((rec.status || 0) >= 400) totals.errors++;
      totals.prompt += p; totals.completion += c; totals.total += t;
      const ts = Date.parse(rec.ts);
      if (ts) bump(byDay, dayKeyOf(String(rec.ts || ''), ts), p, c, t);
      if (rec.model) bump(byModel, rec.model, p, c, t);
      bump(byAgent, rec.agent || '未知客户端', p, c, t);

      if (count < recentMax) { recents[(head + count) % recentMax] = rec; count++; }
      else { recents[head] = rec; head = (head + 1) % recentMax; }
    }
  }
  const ordered = [];
  for (let i = 0; i < count; i++) ordered.push(recents[(head + i) % recentMax]);
  parentPort.postMessage({
    ok: true, start, end,
    totals, byDay: [...byDay], byModel: [...byModel], byAgent: [...byAgent], recents: ordered,
  });
})().catch((e) => parentPort.postMessage({ ok: false, start, end, error: String((e && e.message) || e) }));
