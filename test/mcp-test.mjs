#!/usr/bin/env node
/**
 * MCP Server 协议测试：把 JSON-RPC 报文一次性写入 stdin（EOF 后服务端退出），
 * 同步收集全部 stdout 响应并校验。结果写入 test/mcp-result.txt
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = [];
const log = (s) => OUT.push(s);

const lines = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query_stepfun_usage', arguments: { days: 30, group: 'agent' } } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'query_stepfun_usage', arguments: { days: 7, group: 'model' } } },
  { jsonrpc: '2.0', id: 5, method: 'ping' },
  { jsonrpc: '2.0', id: 6, method: 'not/a/method' },
].map((o) => JSON.stringify(o)).join('\n') + '\n';

let stdout = '';
try {
  stdout = execFileSync(process.execPath, [path.join(ROOT, 'mcp-server.mjs')], {
    input: lines,
    env: { ...process.env, DATA_DIR: path.join(ROOT, 'demo-data') },
    encoding: 'utf8',
    timeout: 20000,
  });
} catch (e) {
  log('SPAWN ERROR: ' + e.message);
  log('stdout so far: ' + (e.stdout || '').slice(0, 500));
}

const responses = stdout.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return { parseError: l.slice(0, 100) }; } });
const byId = new Map(responses.map((r) => [r.id, r]));
log(`收到响应 ${responses.length} 条（预期 6 条：id 1,2,3,4,5,6）`);

const assert = (cond, msg) => log(`${cond ? 'PASS' : 'FAIL'} - ${msg}`);

const r1 = byId.get(1);
assert(!!r1 && r1.result && r1.result.serverInfo && r1.result.serverInfo.name === 'stepfun-usage-monitor', 'initialize 返回 serverInfo');
assert(r1 && r1.result.protocolVersion === '2024-11-05', '协议版本协商正确');

const r2 = byId.get(2);
assert(!!r2 && r2.result.tools.some((t) => t.name === 'query_stepfun_usage'), 'tools/list 暴露 query_stepfun_usage');
assert(r2 && !!r2.result.tools[0].inputSchema, '工具带 inputSchema');

const r3 = byId.get(3);
const t3 = r3 && r3.result.content[0].text;
log('--- tools/call (group=agent, days=30) ---');
log(t3 ? t3.split('\n').slice(0, 6).join('\n') : '(空)');
assert(!!t3 && /总计：请求 \d+ 次/.test(t3) && t3.includes('ZCode'), '按客户端分组的用量查询返回正确摘要');

const r4 = byId.get(4);
const t4 = r4 && r4.result.content[0].text;
assert(!!t4 && t4.includes('step-2-16k'), '按模型分组查询正常');

assert(!!byId.get(5) && byId.get(5).result !== undefined, 'ping 有响应');

const r6 = byId.get(6);
assert(!!r6 && !!r6.error && r6.error.code === -32601, '未知方法返回 -32601 错误');

fs.writeFileSync(path.join(__dirname, 'mcp-result.txt'), OUT.join('\n') + '\n');
