#!/usr/bin/env node
/**
 * 端到端测试：启动 mock 上游 + 被测代理（子进程），
 * 发送非流式/流式/失败请求，校验 usage 解析与统计接口，
 * 结果逐条写入 test/e2e-result.txt（适配无 stdout 环境）。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const MOCK_PORT = 18791, PROXY_PORT = 18780;
const DATA_DIR = path.join(__dirname, 'e2e-data');
const RESULT = path.join(__dirname, 'e2e-result.txt');
const OUT = [];
const flush = () => { try { fs.writeFileSync(RESULT, OUT.join('\n') + '\n'); } catch { /* ignore */ } };
const log = (s) => { OUT.push(s); flush(); }; // 每条即时落盘

process.on('uncaughtException', (e) => { log('UNCAUGHT: ' + (e.stack || e.message)); process.exit(1); });
process.on('unhandledRejection', (e) => { log('UNHANDLED: ' + ((e && e.stack) || String(e))); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(port, urlPath, bodyObj, ua, stream) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(bodyObj));
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ua, authorization: 'Bearer test-key-not-logged', 'content-length': body.length },
    }, (res) => {
      if (stream) {
        let raw = '', usage = null, done = false, buf = '';
        res.on('data', (c) => {
          raw += c.toString();
          buf += c.toString();
          let i;
          while ((i = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line.startsWith('data:')) {
              const p = line.slice(5).trim();
              if (p && p !== '[DONE]') { try { const o = JSON.parse(p); if (o.usage) usage = o.usage; } catch { /* skip */ } }
            }
          }
        });
        res.on('end', () => { done = true; resolve({ status: res.statusCode, raw, usage }); });
        setTimeout(() => { if (!done) reject(new Error('stream timeout')); }, 15000);
      } else {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), raw: '' }));
      }
    });
    req.on('error', reject);
    req.end(body);
  });
}

const getJson = (port, p) => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }));
  }).on('error', reject);
});

(async () => {
  log('== e2e start ==');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const mock = spawn(NODE, [path.join(__dirname, 'mock-upstream.mjs')], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });
  mock.on('error', (e) => log('MOCK SPAWN ERROR: ' + e.message));
  mock.stderr.on('data', (d) => OUT.push('MOCK-STDERR: ' + d.toString().trim()));
  mock.stdout.on('data', (d) => OUT.push('MOCK-STDOUT: ' + d.toString().trim()));
  await sleep(800);
  log('mock spawned');

  const proxy = spawn(NODE, [path.join(ROOT, 'proxy.mjs')], {
    env: { ...process.env, PORT: String(PROXY_PORT), TARGET_URL: `http://127.0.0.1:${MOCK_PORT}`, DATA_DIR },
  });
  proxy.on('error', (e) => log('PROXY SPAWN ERROR: ' + e.message));
  proxy.stderr.on('data', (d) => OUT.push('PROXY-STDERR: ' + d.toString().trim()));
  proxy.stdout.on('data', (d) => OUT.push('PROXY-STDOUT: ' + d.toString().trim()));
  await sleep(1000);
  log('proxy spawned');

  try {
    // 1. 非流式请求（UA=ZCode）
    const r1 = await post(PROXY_PORT, '/v1/chat/completions', { model: 'step-2-16k', messages: [{ role: 'user', content: 'hi' }] }, 'zcode-cli/1.0', false);
    log(`[1] 非流式 ZCode: status=${r1.status} usage-in-response=${r1.body.includes('"total_tokens":200')}`);

    // 2. 流式请求（UA=Claude，验证自动注入 stream_options + SSE usage 解析）
    log('before r2');
    const r2 = await post(PROXY_PORT, '/v1/chat/completions', { model: 'step-2-mini', stream: true, messages: [{ role: 'user', content: 'hi' }] }, 'claude-cli/2.0.0', true);
    log('after r2');
    log(`[2] 流式 Claude: status=${r2.status} stream_options-received=${fs.readFileSync(path.join(__dirname, 'mock-log.txt'), 'utf8').includes('include_usage')} sse-usage-parsed=${JSON.stringify(r2.usage)}`);

    // 3. 流式请求（UA=未知客户端，模型 step-1v-8k）
    const r3 = await post(PROXY_PORT, '/v1/chat/completions', { model: 'step-1v-8k', stream: true, messages: [{ role: 'user', content: 'v' }] }, 'SomeAgent/9.9', true);
    log(`[3] 流式 未知客户端: status=${r3.status} usage=${JSON.stringify(r3.usage)}`);

    // 4. 上游 404（失败请求也应被记录）
    const r4 = await post(PROXY_PORT, '/v1/not-exist', { model: 'x' }, 'curl/8.0', false);
    log(`[4] 上游404: status=${r4.status}`);

    // 5. 上游拒绝 stream_options → 代理应自动回退重发并正常返回流式响应
    const r5 = await post(PROXY_PORT, '/v1/chat/completions', { model: 'no-so-support', stream: true, messages: [{ role: 'user', content: 'x' }] }, 'Cline/3.0', true);
    const mockLog = fs.readFileSync(path.join(__dirname, 'mock-log.txt'), 'utf8');
    log(`[5] 回退测试 no-so-support: status=${r5.status} usage=${JSON.stringify(r5.usage)} 二次请求已去掉stream_options=${/model=no-so-support stream=true stream_options=null/.test(mockLog)}`);

    await sleep(600);
    // 5. 统计接口校验
    const stats = await getJson(PROXY_PORT, '/api/stats?days=30');
    const t = stats.json.total;
    log(`[5] 统计: requests=${t.requests} prompt=${t.prompt} completion=${t.completion} total=${t.total} errors=${t.errors}`);
    log(`    byAgent=${JSON.stringify(stats.json.byAgent.map((a) => `${a.name}:${a.requests}/${a.total}`))}`);
    log(`    byModel=${JSON.stringify(stats.json.byModel.map((m) => `${m.name}:${m.total}`))}`);

    // 断言
    const assert = (cond, msg) => log(`${cond ? 'PASS' : 'FAIL'} - ${msg}`);
    assert(r1.status === 200 && r1.body.includes('"total_tokens":200'), '非流式响应透传完整且 usage 已入库');
    assert(fs.readFileSync(path.join(__dirname, 'mock-log.txt'), 'utf8').includes('"include_usage":true'), '流式请求已自动注入 stream_options.include_usage');
    assert(!!(r2.usage) && r2.usage.total_tokens === 166 + 'step-2-mini'.length, 'SSE 流式 usage 已解析');
    assert(!!(r3.usage) && r3.usage.total_tokens === 166 + 'step-1v-8k'.length, '未知客户端流式 usage 解析正常');
    assert(r5.status === 200 && /model=no-so-support stream=true stream_options=null/.test(mockLog), '上游拒绝 stream_options 时代理自动回退重发成功');
    assert(t.requests === 5 && t.errors === 1, '请求数/失败数统计正确');
    assert(t.total === 200 + (166 + 'step-2-mini'.length) + (166 + 'step-1v-8k'.length) + (166 + 'no-so-support'.length), 'Token 总数汇总正确');
    const zc = stats.json.byAgent.find((a) => a.name.includes('ZCode'));
    assert(!!zc && zc.total === 200, '客户端识别（ZCode）正确');

    const jsonl = fs.readFileSync(path.join(DATA_DIR, 'usage.jsonl'), 'utf8').trim().split('\n');
    log(`[6] 本地 JSONL 行数=${jsonl.length}`);
    log(`    首行=${jsonl[0]}`);
    assert(!jsonl.join('').includes('test-key-not-logged'), 'API Key 未被写入本地数据');
  } catch (e) {
    log('EXCEPTION: ' + (e.stack || e.message));
  } finally {
    try { mock.kill(); } catch { /* ignore */ }
    try { proxy.kill(); } catch { /* ignore */ }
  }
  log('== e2e end ==');
  flush();
  process.exit(0);
})();
