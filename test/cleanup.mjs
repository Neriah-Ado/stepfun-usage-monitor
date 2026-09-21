import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST = __dirname;
const ROOT = path.join(__dirname, '..');
const report = [];

const rm = (p) => {
  try {
    if (!fs.existsSync(p)) { report.push('SKIP(不存在) ' + p); return; }
    fs.rmSync(p, { recursive: true, force: true });
    report.push((fs.existsSync(p) ? 'FAIL ' : 'OK   ') + p);
  } catch (e) { report.push('ERR  ' + p + ' -> ' + e.message); }
};

['smoke.mjs', 'smoke.txt', 'stderr.txt', 'dirlist.txt', 'repro.mjs', 'repro-result.txt', 'seed-log.txt', 'repro-data', 'e2e-data'].forEach((f) => rm(path.join(TEST, f)));
['filelist.txt', 'filelist2.txt', 'nodeprocs.txt', 'preview-check.txt'].forEach((f) => rm(path.join(ROOT, '..', f)));

report.push('');
report.push('--- 最终目录结构 ---');
const walk = (dir, prefix = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    report.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
    if (e.isDirectory()) walk(path.join(dir, e.name), prefix + '  ');
  }
};
walk(ROOT);
fs.writeFileSync(path.join(TEST, 'cleanup-report.txt'), report.join('\n') + '\n');
