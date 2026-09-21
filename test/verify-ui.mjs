#!/usr/bin/env node
// 校验：仪表盘页面可访问、CLI 报表可用（结果写入 test/ui-result.txt）
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = [];

const get = (p) => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: 8787, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
  }).on('error', reject);
});

try {
  const dash = await get('/');
  OUT.push(`GET / -> status=${dash.status} 长度=${dash.body.length} 含标题=${dash.body.includes('StepFun API Token 用量监控')} 含外部CDN=${/https?:\/\/(cdn|unpkg|jsdelivr)/.test(dash.body)}`);
  const health = await get('/healthz');
  OUT.push(`GET /healthz -> ${health.body}`);
  const logs = await get('/api/logs?days=30&limit=5');
  const parsed = JSON.parse(logs.body);
  OUT.push(`GET /api/logs -> count=${parsed.count} 首条=${JSON.stringify(parsed.rows[0])}`);
} catch (e) {
  OUT.push('HTTP 校验失败: ' + e.message + '（代理可能未运行，请先执行 start.cmd）');
}

try {
  const stats = execFileSync(process.execPath, [path.join(ROOT, 'stats.mjs'), '30'], {
    env: { ...process.env, DATA_DIR: path.join(ROOT, 'demo-data') }, encoding: 'utf8', timeout: 15000,
  });
  OUT.push('--- CLI 报表 (node stats.mjs 30) ---');
  OUT.push(stats.split('\n').slice(0, 26).join('\n'));
} catch (e) {
  OUT.push('CLI 报表失败: ' + e.message + '\n' + (e.stdout || '').slice(0, 400));
}

fs.writeFileSync(path.join(__dirname, 'ui-result.txt'), OUT.join('\n') + '\n');
