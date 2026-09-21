#!/usr/bin/env node
/**
 * CLI 统计：node stats.mjs [天数，默认7]
 * 直接读取本地 data/usage.jsonl，输出终端汇总表
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const days = Math.max(parseInt(process.argv[2] || '7', 10) || 7, 1);
const file = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'usage.jsonl') : path.join(__dirname, 'data', 'usage.jsonl');

const records = [];
try {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim()) { try { records.push(JSON.parse(line)); } catch { /* skip */ } }
  }
} catch {
  console.log('未找到数据文件: ' + file + '\n请先运行代理 (start.cmd 或 node proxy.mjs)。');
  process.exit(0);
}

const pad = (n) => String(n).padStart(2, '0');
const since = Date.now() - days * 86400000;
const fmtN = (n) => Number(n || 0).toLocaleString('zh-CN');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

let req = 0, err = 0, p = 0, c = 0, tt = 0;
const model = new Map(), agent = new Map(), day = new Map();
const touch = (m, k) => { if (!m.has(k)) m.set(k, { r: 0, p: 0, c: 0, t: 0 }); return m.get(k); };

for (const r of records) {
  const t = Date.parse(r.ts);
  if (!(t >= since)) continue;
  const pp = r.prompt_tokens || 0, cc = r.completion_tokens || 0, ttt = r.total_tokens || (pp + cc);
  req++; if ((r.status || 0) >= 400) err++;
  p += pp; c += cc; tt += ttt;
  const d = touch(day, dayKey(t)); d.r++; d.p += pp; d.c += cc; d.t += ttt;
  if (r.model) { const m = touch(model, r.model); m.r++; m.p += pp; m.c += cc; m.t += ttt; }
  const a = touch(agent, r.agent || '未知'); a.r++; a.p += pp; a.c += cc; a.t += ttt;
}

const LINE = 74;
const line = (s = '-') => console.log(s.repeat(LINE));
// 五列固定宽度（中文按 2 字符宽度近似对齐：名称列 18，其余右对齐 12）
const w = (s, n) => { const str = String(s ?? ''); let len = 0; for (const ch of str) len += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1; return str + ' '.repeat(Math.max(0, n - len)); };
const wr = (s, n) => { const str = String(s ?? ''); let len = 0; for (const ch of str) len += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1; return ' '.repeat(Math.max(0, n - len)) + str; };
const row = (name, r, p2, c2, t2) => console.log(w(name, 18) + wr(r, 10) + wr(p2, 14) + wr(c2, 14) + wr(t2, 14));
const header = () => { row('名称', '请求', '输入', '输出', '合计'); line(); };

console.log(`\nStepFun API Token 用量（最近 ${days} 天）  数据源: ${file}`);
line();
row('合计', String(req), fmtN(p), fmtN(c), fmtN(tt));
if (err) console.log(`  其中失败请求: ${err} 次`);
line();

const table = (title, entries) => {
  console.log(`\n【${title}】`);
  header();
  entries.slice(0, 15).forEach((v) => row(v.name, String(v.r), fmtN(v.p), fmtN(v.c), fmtN(v.t)));
};

table('按天', [...day.entries()].map(([k, v]) => ({ name: k, ...v })));
table('按模型', [...model.entries()].map(([k, v]) => ({ name: k, ...v })).sort((x, y) => y.t - x.t));
table('按客户端', [...agent.entries()].map(([k, v]) => ({ name: k, ...v })).sort((x, y) => y.t - x.t));
console.log('');
