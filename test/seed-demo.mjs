#!/usr/bin/env node
/**
 * 生成演示数据（仅用于预览仪表盘效果，与真实用量数据分离）。
 * 用法: node test/seed-demo.mjs [输出目录，默认 demo-data]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'demo-data');
const FILE = path.join(OUT_DIR, 'usage.jsonl');

const AGENTS = ['ZCode/智谱', 'ZCode/智谱', 'ZCode/智谱', 'Cline', 'Claude', 'Cherry Studio', 'Continue', 'curl'];
const MODELS = ['step-2-16k', 'step-2-16k', 'step-2-mini', 'step-1v-8k', 'step-2-32k'];

// 简单可复现伪随机
let seed = 20260922;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const rows = [];
const now = Date.now();
for (let d = 29; d >= 0; d--) {
  const dayStart = now - d * 86400000;
  const count = d === 0 ? int(3, 9) : int(2, 14);
  for (let i = 0; i < count; i++) {
    const t = new Date(dayStart - int(0, 10) * 3600000 + i * int(3, 40) * 60000);
    if (t.getTime() > now) continue;
    const agent = pick(AGENTS);
    const model = pick(MODELS);
    const prompt = int(400, 12000);
    const completion = int(80, 2600);
    const failed = rnd() < 0.03;
    rows.push({
      ts: t.toISOString(),
      agent,
      path: '/v1/chat/completions',
      model,
      status: failed ? 429 : 200,
      prompt_tokens: failed ? null : prompt,
      completion_tokens: failed ? null : completion,
      total_tokens: failed ? null : prompt + completion,
      latency_ms: int(300, 9000),
    });
  }
}
rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`已生成 ${rows.length} 条演示记录 → ${FILE}`);
