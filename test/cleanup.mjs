import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(TEST, '..');
const report = [];

const rm = (p) => {
  try {
    if (!fs.existsSync(p)) { report.push('SKIP ' + p); return; }
    const stat = fs.statSync(p);
    const size = stat.isFile() ? ` (${(stat.size / 1048576).toFixed(1)} MB)` : '';
    fs.rmSync(p, { recursive: true, force: true });
    report.push((fs.existsSync(p) ? 'FAIL ' : 'OK   ') + p + size);
  } catch (e) { report.push('ERR  ' + p + ' -> ' + e.message); }
};

// 基准 / 测试产物（可重新生成，且已被 .gitignore 覆盖）
['bench-base.jsonl', 'bench-old', 'bench-new', 'bench-old-empty', 'bench-new-empty', 'bench-logs',
  'bench-old-proxy.mjs', 'parity-serial', 'parity-parallel', 'e2e-data', 'smoke.mjs', 'smoke.txt',
  'syntax.txt', 'dirlist.txt', 'stderr.txt', 'repro.mjs', 'repro-data'].forEach((f) => rm(path.join(TEST, f)));

report.push('');
report.push('--- 仓库目录结构 ---');
const walk = (dir, prefix = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'bench-logs') continue;
    report.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
    if (e.isDirectory()) walk(path.join(dir, e.name), prefix + '  ');
  }
};
walk(ROOT);
fs.writeFileSync(path.join(TEST, 'cleanup-report.txt'), report.join('\n') + '\n');
