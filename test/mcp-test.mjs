#!/usr/bin/env node
/**
 * MCP Server 协议测试：把 JSON-RPC 报文一次性写入 stdin（EOF 后服务端退出），
 * 同步收集全部 stdout 响应并校验。结果写入 test/mcp-result.txt
 * v1.5.9：新增 open_monitor_panel 工具断言（tools/list + dryRun 调用，不真正开窗）。
 * v1.5.10：新增插件安装态 runtime MCP 断言（plugins/ 下 runtime/bin/cli.mjs --mcp，即 .mcp.json 实际入口）。
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
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'open_monitor_panel', arguments: { mode: 'panel', dryRun: true } } },
  { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'open_monitor_panel', arguments: { mode: 'full', dryRun: true } } },
].map((o) => JSON.stringify(o)).join('\n') + '\n';

let stdout = '';
try {
  stdout = execFileSync(process.execPath, [path.join(ROOT, 'mcp-server.mjs')], {
    input: lines,
    env: { ...process.env, DATA_DIR: path.join(ROOT, 'demo-data') },
    encoding: 'utf8',
    timeout: 30000,
  });
} catch (e) {
  log('SPAWN ERROR: ' + e.message);
  log('stdout so far: ' + (e.stdout || '').slice(0, 500));
}

const responses = stdout.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return { parseError: l.slice(0, 100) }; } });
const byId = new Map(responses.map((r) => [r.id, r]));
log(`收到响应 ${responses.length} 条（预期 8 条：id 1-8）`);

const assert = (cond, msg) => log(`${cond ? 'PASS' : 'FAIL'} - ${msg}`);

const r1 = byId.get(1);
assert(!!r1 && r1.result && r1.result.serverInfo && r1.result.serverInfo.name === 'stepfun-usage-monitor', 'initialize 返回 serverInfo');
assert(!!r1 && r1.result.serverInfo && r1.result.serverInfo.version === '1.5.10', 'serverInfo.version=1.5.10');
assert(r1 && r1.result.protocolVersion === '2024-11-05', '协议版本协商正确');

const r2 = byId.get(2);
assert(!!r2 && r2.result.tools.some((t) => t.name === 'query_stepfun_usage'), 'tools/list 暴露 query_stepfun_usage');
assert(!!r2 && !!r2.result.tools[0].inputSchema, '工具带 inputSchema');
const openTool = r2 && r2.result.tools.find((t) => t.name === 'open_monitor_panel');
assert(!!openTool, 'tools/list 暴露 open_monitor_panel（v1.5.10）');
assert(!!openTool && openTool.inputSchema && openTool.inputSchema.properties
  && openTool.inputSchema.properties.mode && openTool.inputSchema.properties.mode.enum.join(',') === 'panel,full',
  'open_monitor_panel 带 mode=panel|full 枚举');

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

const r7 = byId.get(7);
const t7 = r7 && r7.result && r7.result.content && r7.result.content[0] && r7.result.content[0].text;
log('--- tools/call open_monitor_panel (panel, dryRun) ---');
log(t7 || '(空)');
assert(!!r7 && r7.result && r7.result.isError === false && !!t7 && t7.includes('http://127.0.0.1:8787/?layout=panel'),
  'open_monitor_panel dryRun(panel) 返回吸附弹窗 URL');

const r8 = byId.get(8);
const t8 = r8 && r8.result && r8.result.content && r8.result.content[0] && r8.result.content[0].text;
assert(!!r8 && r8.result && r8.result.isError === false && !!t8 && t8.includes('http://127.0.0.1:8787/'),
  'open_monitor_panel dryRun(full) 返回完整页 URL');

/* ===== v1.5.10：插件安装态 runtime MCP（.mcp.json 中 ${CLAUDE_PLUGIN_ROOT}/runtime/bin/cli.mjs 实际入口） ===== */
try {
  const rtCli = path.join(ROOT, 'plugins', 'stepfun-usage-monitor', 'runtime', 'bin', 'cli.mjs');
  const rtOut = execFileSync(process.execPath, [rtCli, '--mcp'], {
    input: [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'zcode-plugin', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map((o) => JSON.stringify(o)).join('\n') + '\n',
    env: { ...process.env, DATA_DIR: path.join(ROOT, 'demo-data') },
    encoding: 'utf8',
    timeout: 30000,
  });
  const rtRes = rtOut.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rtInit = rtRes.find((r) => r.id === 1);
  const rtTools = rtRes.find((r) => r.id === 2);
  assert(!!rtInit && rtInit.result.serverInfo && rtInit.result.serverInfo.version === '1.5.10', 'runtime MCP initialize 版本 1.5.10');
  assert(!!rtTools && rtTools.result.tools.some((t) => t.name === 'query_stepfun_usage')
    && rtTools.result.tools.some((t) => t.name === 'open_monitor_panel'), 'runtime MCP 暴露全部工具');
} catch (e) {
  assert(false, 'runtime MCP 启动失败: ' + e.message);
}

fs.writeFileSync(path.join(__dirname, 'mcp-result.txt'), OUT.join('\n') + '\n');
