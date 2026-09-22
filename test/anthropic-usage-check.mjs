#!/usr/bin/env node
/**
 * Anthropic 协议用量解析 + 服务商 baseUrl 路径前缀回归测试。
 *
 * 覆盖两个 v1.5.11 修复：
 *   A. 服务商 baseUrl 自带路径前缀（如 GLM 的 /api/anthropic）时，转发必须拼在请求路径前，
 *      不能只取 origin —— 否则客户端 /p/glm/v1/messages 会打到上游 /v1/messages（nginx 405）。
 *   B. Anthropic 流式把 usage 拆在多帧（input_tokens 在 message_start 的 message 内、
 *      output_tokens 终值在 message_delta 顶层）—— 需嵌套读取 + 逐帧合并，否则输入 tokens 丢失。
 *
 * 全本地 mock 上游，不访问外网、不消耗任何额度。结果写入 test/anthropic-result.txt（适配无 stdout 环境）。
 * 用法：node test/anthropic-usage-check.mjs
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const MOCK_PORT = 18891, PROXY_PORT = 18880;
const DATA_DIR = path.join(__dirname, 'anthropic-data');
const LOG = path.join(__dirname, 'anthropic-mock-log.txt');
const RESULT = path.join(__dirname, 'anthropic-result.txt');

const OUT = [];
const flush = () => { try { fs.writeFileSync(RESULT, OUT.join('\n') + '\n'); } catch { /* ignore */ } };
const log = (s) => { OUT.push(s); flush(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== mock 上游：Anthropic 兼容端点 ==================== */
const ANTHROPIC_PATH = '/api/anthropic/v1/messages';       // 上游真实路径（含 baseUrl 前缀）
const SS_IN = 137, SS_OUT = 42, NS_IN = 21, NS_OUT = 7;    // 期望被记录的 token 数

function mockUpstream() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({ path: req.url, method: req.method, raw });
      try { fs.appendFileSync(LOG, `path=${req.url} stream=${/"stream"\s*:\s*true/.test(raw)} auth=${!!req.headers.authorization || !!req.headers['x-api-key']}\n`); } catch { /* ignore */ }

      if (req.method !== 'POST' || req.url !== ANTHROPIC_PATH) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'unknown path: ' + req.url, type: 'not_found' } }));
      }

      if (/"stream"\s*:\s*true/.test(raw)) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const frames = [
          ['message_start', { type: 'message_start', message: { id: 'msg_t', model: 'GLM-4.5air', usage: { input_tokens: SS_IN, output_tokens: 1 } } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: SS_OUT } }],
          ['message_stop', { type: 'message_stop' }],
        ];
        for (const [ev, data] of frames) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
        return res.end();
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_t2', type: 'message', model: 'GLM-4.5air', role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: NS_IN, output_tokens: NS_OUT },
      }));
    });
  });
  server.listen(MOCK_PORT, '127.0.0.1');
  return { server, received };
}

/* ==================== 客户端请求 ==================== */
function post(purl, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(bodyObj));
    const req = http.request({
      hostname: '127.0.0.1', port: PROXY_PORT, path: purl, method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'zcode-cli/1.9.9', 'x-api-key': 'sk-test-not-logged', 'content-length': body.length },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const getJson = (p) => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: PROXY_PORT, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
  }).on('error', reject);
});

(async () => {
  log('== anthropic usage check start ==');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.rmSync(LOG, { force: true });
  // 服务商 glm 的 baseUrl 自带路径前缀 —— 客户端只写 /p/glm，前缀由代理补足
  fs.writeFileSync(path.join(DATA_DIR, 'providers.json'), JSON.stringify({
    active: 'glm',
    providers: [{ key: 'glm', baseUrl: `http://127.0.0.1:${MOCK_PORT}/api/anthropic` }],
  }, null, 2));

  const { server, received } = mockUpstream();
  await sleep(300);
  log('mock upstream spawned');

  const proxy = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(PROXY_PORT), DATA_DIR },
  });
  proxy.on('error', (e) => log('PROXY SPAWN ERROR: ' + e.message));
  proxy.stderr.on('data', (d) => OUT.push('PROXY-STDERR: ' + d.toString().trim()));
  await sleep(1000);
  log('proxy spawned');

  let failures = 0;
  const assert = (cond, msg) => { if (!cond) failures++; log(`${cond ? 'PASS' : 'FAIL'} - ${msg}`); };

  try {
    // 1. 流式（Anthropic SSE）
    const r1 = await post('/p/glm/v1/messages', { model: 'GLM-4.5air', stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] });
    log(`[1] 流式: status=${r1.status} frames=${(r1.body.match(/^event: /gm) || []).length}`);
    const upPath1 = received[0] && received[0].path;

    // 2. 非流式
    const r2 = await post('/p/glm/v1/messages', { model: 'GLM-4.5air', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] });
    log(`[2] 非流式: status=${r2.status} body-has-usage=${r2.body.includes('"output_tokens"')}`);

    await sleep(700);
    const rows = fs.readFileSync(path.join(DATA_DIR, 'usage.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const msgRows = rows.filter((r) => r.path === '/v1/messages');
    const ss = msgRows[0];      // 先发的流式请求
    const ns = msgRows[1];      // 后发的非流式请求
    log('    记录行: ' + JSON.stringify(rows.map((r) => ({ p: r.path, prompt: r.prompt_tokens, completion: r.completion_tokens, total: r.total_tokens, status: r.status }))));

    const stats = await getJson('/api/stats?days=30');
    log(`    统计: requests=${stats.total.requests} prompt=${stats.total.prompt} completion=${stats.total.completion} total=${stats.total.total}`);

    // 断言 A：baseUrl 路径前缀被补足（修复前这里会是上游 404）
    assert(upPath1 === ANTHROPIC_PATH, `上游收到路径为 ${ANTHROPIC_PATH}（实际 ${upPath1}）`);
    assert(r1.status === 200, '流式请求经代理返回 200');

    // 断言 B：Anthropic 流式 usage 合并后完整记录
    assert(!!ss && ss.prompt_tokens === SS_IN && ss.completion_tokens === SS_OUT && ss.total_tokens === SS_IN + SS_OUT,
      `流式 usage 完整记录（prompt=${ss && ss.prompt_tokens} completion=${ss && ss.completion_tokens} total=${ss && ss.total_tokens}，期望 ${SS_IN}/${SS_OUT}/${SS_IN + SS_OUT}）`);

    // 断言 C：非流式 usage 记录
    assert(!!ns && ns.prompt_tokens === NS_IN && ns.completion_tokens === NS_OUT && ns.total_tokens === NS_IN + NS_OUT,
      `非流式 usage 记录（prompt=${ns && ns.prompt_tokens} completion=${ns && ns.completion_tokens} total=${ns && ns.total_tokens}，期望 ${NS_IN}/${NS_OUT}/${NS_IN + NS_OUT}）`);

    // 断言 D：SSE 帧原样透传
    assert((r1.body.match(/^event: /gm) || []).length === 4 && r1.body.includes('"output_tokens":1') && r1.body.includes('"output_tokens":42'),
      'SSE 帧原样透传（4 帧、message_start 与 message_delta 原始 usage 均在）');

    // 断言 E：统计汇总与记录一致
    assert(stats.total.requests === 2 && stats.total.prompt === SS_IN + NS_IN && stats.total.completion === SS_OUT + NS_OUT,
      `统计汇总正确（prompt=${stats.total.prompt} completion=${stats.total.completion}）`);

    // 断言 F：密钥不落盘
    const rawLog = fs.readFileSync(path.join(DATA_DIR, 'usage.jsonl'), 'utf8');
    assert(!/sk-test-not-logged/.test(rawLog), 'API Key 未被写入本地数据');
  } catch (e) {
    failures++;
    log('EXCEPTION: ' + (e.stack || e.message));
  } finally {
    proxy.kill();
    server.close();
    await sleep(200);
    log(`== anthropic usage check end: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'} ==`);
    flush();
    process.exit(failures === 0 ? 0 : 1);
  }
})();
