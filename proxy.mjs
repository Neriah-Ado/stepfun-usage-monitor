#!/usr/bin/env node
/**
 * stepfun-usage-monitor — StepFun API Token 用量本地监控代理
 *
 * 架构：Agent → http://127.0.0.1:<PORT>/v1/... → 本地代理 → https://api.stepfun.com/v1/...
 * 特性：
 *   1. 零 npm 依赖，仅用 Node 内置模块（性能开销极低，常驻内存 < 30MB）
 *   2. 流式(SSE)与非流式响应均可解析 usage；流式请求自动注入 stream_options.include_usage
 *   3. 用量数据逐条追加写入本地 data/usage.jsonl（不含任何密钥）
 *   4. 内置仪表盘 http://127.0.0.1:<PORT>/ 与统计 API /api/stats
 *   5. 兼容任意 OpenAI 兼容客户端：改一下 Base URL 即接入
 *
 * 环境变量：
 *   PORT                    监听端口（默认 8787）
 *   TARGET_URL              上游地址（默认 https://api.stepfun.com）
 *   DATA_DIR                数据目录（默认 ./data）
 *   STEPFUN_API_KEY         可选：客户端未带 Authorization 时自动注入
 *   DISABLE_USAGE_INJECT=1  关闭 stream_options 注入
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const TARGET = new URL(process.env.TARGET_URL || 'https://api.stepfun.com');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'usage.jsonl');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');
const INJECT_USAGE = process.env.DISABLE_USAGE_INJECT !== '1';
const PASSTHROUGH_KEY = process.env.STEPFUN_API_KEY || '';
const MAX_IN_MEMORY = 200000; // 内存上限，约可存数年个人用量

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- 本地存储（JSONL 追加写，崩溃安全） ---------------- */
const records = [];
try {
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* 忽略损坏行 */ }
  }
} catch { /* 首次运行无文件 */ }
if (records.length > MAX_IN_MEMORY) records.splice(0, records.length - MAX_IN_MEMORY);

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
function saveRecord(rec) {
  records.push(rec);
  if (records.length > MAX_IN_MEMORY) records.shift();
  logStream.write(JSON.stringify(rec) + '\n');
}

/* ---------------- 客户端识别 ---------------- */
const AGENT_PATTERNS = [
  [/zcode|z\.ai|zai|chatglm|bigmodel|codegeex/i, 'ZCode/智谱'],
  [/claude/i, 'Claude'],
  [/cline/i, 'Cline'],
  [/roo/i, 'Roo Code'],
  [/continue/i, 'Continue'],
  [/cursor/i, 'Cursor'],
  [/cherry/i, 'Cherry Studio'],
  [/chatbox/i, 'ChatBox'],
  [/lobe/i, 'LobeChat'],
  [/open-webui/i, 'Open WebUI'],
  [/dify/i, 'Dify'],
  [/langchain|langgraph/i, 'LangChain'],
  [/litellm/i, 'LiteLLM'],
  [/openai-node|openai\/|openai-python/i, 'OpenAI SDK'],
  [/python-requests|httpx|aiohttp/i, 'Python 客户端'],
  [/curl/i, 'curl'],
];
function detectAgent(req) {
  const custom = req.headers['x-agent'] || req.headers['x-agent-name'];
  if (custom) return String(custom).slice(0, 40);
  const ua = String(req.headers['user-agent'] || '');
  for (const [re, name] of AGENT_PATTERNS) if (re.test(ua)) return name;
  return ua ? ua.slice(0, 40) : '未知客户端';
}

/* ---------------- SSE usage 扫描（逐行、无缓冲堆积） ---------------- */
function sseUsageScanner(onUsage) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        if (obj && obj.usage && typeof obj.usage === 'object') onUsage(obj.usage, obj.model);
      } catch { /* 非终帧不含 usage，解析失败即跳过 */ }
    }
    if (buf.length > 65536) buf = buf.slice(-1024); // 防御异常流
  };
}

function normalizeUsage(u, model) {
  if (!u) return null;
  const out = { ...u };
  if (out.prompt_tokens == null && out.input_tokens != null) out.prompt_tokens = out.input_tokens;
  if (out.completion_tokens == null && out.output_tokens != null) out.completion_tokens = out.output_tokens;
  if (out.total_tokens == null && out.prompt_tokens != null && out.completion_tokens != null)
    out.total_tokens = out.prompt_tokens + out.completion_tokens;
  if (model && !out.model) out.model = model;
  return out;
}

/* ---------------- 转发核心 ---------------- */
function forward(clientRes, body, opts, onDone) {
  const headers = { ...opts.headers };
  headers.host = TARGET.host;
  headers['accept-encoding'] = 'identity'; // 明文传输以便解析 usage
  delete headers['transfer-encoding'];
  if (body.length) headers['content-length'] = String(body.length);
  else delete headers['content-length'];
  if (PASSTHROUGH_KEY && !headers.authorization) headers.authorization = `Bearer ${PASSTHROUGH_KEY}`;

  const upReq = (TARGET.protocol === 'https:' ? https : http).request({
    protocol: TARGET.protocol,
    hostname: TARGET.hostname,
    port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
    path: opts.path,
    method: opts.method,
    headers,
    timeout: 600000,
  }, (upRes) => {
    const status = upRes.statusCode;
    const ct = String(upRes.headers['content-type'] || '');
    const isJson = ct.includes('json');
    const isSSE = ct.includes('text/event-stream');

    // 注入 stream_options 后若上游返回 400（个别实现不认该字段），自动回退重发一次
    if (opts.injected && status === 400 && isJson) {
      const retryChunks = [];
      upRes.on('data', (c) => retryChunks.push(c));
      upRes.on('end', () => {
        console.log('[fallback] 上游拒绝 stream_options，已回退为原始请求重发');
        forward(clientRes, opts.originalBody, { ...opts, injected: false }, onDone);
      });
      return;
    }

    const rec = {
      ts: new Date().toISOString(),
      agent: opts.agent,
      path: opts.path.split('?')[0],
      model: opts.model || '',
      status,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      latency_ms: Date.now() - opts.start,
    };

    if (isSSE) {
      let lastUsage = null;
      const scan = sseUsageScanner((u, streamModel) => {
        lastUsage = normalizeUsage(u, streamModel || opts.model);
        rec.model = streamModel || rec.model; // 流式帧中的 model 最权威
        rec.prompt_tokens = lastUsage.prompt_tokens ?? null;
        rec.completion_tokens = lastUsage.completion_tokens ?? null;
        rec.total_tokens = lastUsage.total_tokens ?? null;
      });
      clientRes.writeHead(status, upRes.headers);
      upRes.on('data', (c) => { scan(c); clientRes.write(c); }); // 直通 + 旁路扫描，不缓冲
      upRes.on('end', () => {
        clientRes.end();
        rec.latency_ms = Date.now() - opts.start;
        saveRecord(rec);
        onDone();
      });
      upRes.on('error', () => { clientRes.end(); saveRecord(rec); onDone(); });
      return;
    }

    if (isJson) {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const buf = Buffer.concat(chunks);
        let usage = null;
        try {
          const obj = JSON.parse(buf.toString('utf8'));
          usage = normalizeUsage(obj.usage, obj.model || opts.model);
        } catch { /* 非 JSON 响应体 */ }
        if (usage) {
          rec.model = usage.model || rec.model;
          rec.prompt_tokens = usage.prompt_tokens ?? null;
          rec.completion_tokens = usage.completion_tokens ?? null;
          rec.total_tokens = usage.total_tokens ?? null;
        }
        saveRecord(rec);
        const outHeaders = { ...upRes.headers };
        delete outHeaders['content-length']; // 长度由 http 模块处理
        clientRes.writeHead(status, outHeaders);
        clientRes.end(buf);
        onDone();
      });
      upRes.on('error', () => { clientRes.end(); saveRecord(rec); onDone(); });
      return;
    }

    // 其他类型：纯直通
    clientRes.writeHead(status, upRes.headers);
    upRes.pipe(clientRes);
    upRes.on('end', () => { saveRecord(rec); onDone(); });
    upRes.on('error', () => { clientRes.end(); saveRecord(rec); onDone(); });
  });

  upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')));
  upReq.on('error', (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: { message: `代理无法连接上游: ${err.message}`, type: 'proxy_upstream_error' } }));
    } else {
      clientRes.end();
    }
    saveRecord({
      ts: new Date().toISOString(), agent: opts.agent, path: opts.path.split('?')[0],
      model: opts.model || '', status: 502, prompt_tokens: null, completion_tokens: null,
      total_tokens: null, latency_ms: Date.now() - opts.start,
    });
    onDone();
  });

  clientRes.on('close', () => { if (!clientRes.writableEnded) upReq.destroy(); });
  if (body.length) upReq.end(body); else upReq.end();
}

/* ---------------- 统计聚合 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function aggregate(days) {
  const since = Date.now() - days * 86400000;
  const byDay = new Map(), byModel = new Map(), byAgent = new Map();
  const total = { requests: 0, errors: 0, prompt: 0, completion: 0, total: 0 };
  for (let i = days - 1; i >= 0; i--) byDay.set(dayKey(Date.now() - i * 86400000), { day: dayKey(Date.now() - i * 86400000), requests: 0, prompt: 0, completion: 0, total: 0 });

  const touch = (map, key) => {
    if (!map.has(key)) map.set(key, { name: key, requests: 0, prompt: 0, completion: 0, total: 0 });
    return map.get(key);
  };

  for (const r of records) {
    const t = Date.parse(r.ts);
    if (!(t >= since)) continue;
    const p = r.prompt_tokens || 0, c = r.completion_tokens || 0, tt = r.total_tokens || (p + c);
    total.requests++;
    if ((r.status || 0) >= 400) total.errors++;
    total.prompt += p; total.completion += c; total.total += tt;
    const d = byDay.get(dayKey(t));
    if (d) { d.requests++; d.prompt += p; d.completion += c; d.total += tt; }
    if (r.model) { const m = touch(byModel, r.model); m.requests++; m.prompt += p; m.completion += c; m.total += tt; }
    const a = touch(byAgent, r.agent || '未知客户端'); a.requests++; a.prompt += p; a.completion += c; a.total += tt;
  }
  const sortDesc = (m) => [...m.values()].sort((x, y) => y.total - x.total);
  return {
    days,
    total,
    byDay: [...byDay.values()],
    byModel: sortDesc(byModel),
    byAgent: sortDesc(byAgent),
    recent: records.slice(-50).reverse(),
    meta: { target: TARGET.origin, port: PORT, recordCount: records.length, file: LOG_FILE },
  };
}

/* ---------------- HTTP 服务 ---------------- */
function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

let dashboardCache = null;
function getDashboard() {
  try {
    const st = fs.statSync(DASHBOARD_FILE);
    if (!dashboardCache || dashboardCache.mtime !== st.mtimeMs) {
      dashboardCache = { mtime: st.mtimeMs, buf: fs.readFileSync(DASHBOARD_FILE) };
    }
    return dashboardCache.buf;
  } catch { return Buffer.from('<h1>dashboard.html 缺失</h1>'); }
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();

  /* --- 本地 API（不转发） --- */
  if (req.url === '/' || req.url === '/dashboard') {
    const buf = getDashboard();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(buf);
  }
  if (req.url === '/healthz') return sendJson(res, 200, { ok: true, records: records.length });
  if (req.url.startsWith('/api/stats')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const days = Math.min(Math.max(parseInt(q.get('days') || '30', 10) || 30, 1), 365);
    return sendJson(res, 200, aggregate(days));
  }
  if (req.url.startsWith('/api/logs')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const days = Math.min(Math.max(parseInt(q.get('days') || '30', 10) || 30, 1), 3650);
    const limit = Math.min(parseInt(q.get('limit') || '500', 10) || 500, 5000);
    const since = Date.now() - days * 86400000;
    const rows = records.filter((r) => Date.parse(r.ts) >= since).slice(-limit).reverse();
    return sendJson(res, 200, { count: rows.length, rows });
  }
  if (req.url === '/api/clear' && req.method === 'POST') {
    records.length = 0;
    try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
    console.log('[admin] 本地用量数据已清空');
    return sendJson(res, 200, { ok: true });
  }
  if (req.url.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

  /* --- 业务请求：收集请求体后转发 --- */
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const originalBody = Buffer.concat(chunks);

  let model = '';
  let body = originalBody;
  let injected = false;
  const isChatEndpoint = /\/(chat\/completions|completions|responses)(\?|$)/.test(req.url);
  if (INJECT_USAGE && isChatEndpoint && originalBody.length) {
    try {
      const obj = JSON.parse(originalBody.toString('utf8'));
      model = typeof obj.model === 'string' ? obj.model : '';
      if (obj.stream === true && !(obj.stream_options && obj.stream_options.include_usage === true)) {
        obj.stream_options = { ...(obj.stream_options || {}), include_usage: true };
        body = Buffer.from(JSON.stringify(obj), 'utf8');
        injected = true;
      }
    } catch { /* 非 JSON 请求体，原样转发 */ }
  }

  const agent = detectAgent(req);
  forward(res, body, { headers: req.headers, path: req.url, method: req.method, agent, model, start, injected, originalBody }, () => {});
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================================');
  console.log('  StepFun API Token 用量监控代理  (数据全本地 · 零依赖)');
  console.log(`  监听地址   : http://127.0.0.1:${PORT}`);
  console.log(`  上游目标   : ${TARGET.origin}`);
  console.log(`  仪表盘     : http://127.0.0.1:${PORT}/`);
  console.log(`  数据文件   : ${LOG_FILE}`);
  console.log(`  历史记录   : ${records.length} 条`);
  console.log('  Agent 接入 : 将 OpenAI 兼容 Base URL 改为上面的监听地址 + /v1');
  console.log('==============================================================');
});
