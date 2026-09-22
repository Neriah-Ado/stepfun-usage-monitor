#!/usr/bin/env node
/**
 * stepfun-usage-monitor — StepFun API Token 用量本地监控代理
 * v1.4.0 — 交互性能优化 + 轻量 / 进阶 / 极致 3 档性能模式
 *
 * 架构：Agent → http://127.0.0.1:<PORT>/v1/... → 本地代理 → https://api.stepfun.com/v1/...
 *
 * 性能设计要点：
 *   [冷启动] ① 先 listen 再后台增量加载历史；② 聚合快照 aggregate.json（含字节偏移），
 *            重启只读快照 + 回放尾部增量，不再全量重放；③ 加载分片让出事件循环。
 *   [内存]   ① 增量聚合（Map 桶）替代全量记录数组；② 最近请求用定长环形缓冲；
 *            ③ 大请求体（>MAX_INJECT_BYTES）直接流式透传不落内存；④ SSE 扫描缓冲 8KB 上限；
 *            ⑤ 日志写入背压队列定长（极端积压时丢弃最旧日志行，聚合统计不受影响）。
 *   [并发]   ① 上游 keepAlive 连接池 + maxSockets 限流；② /api/stats 读内存聚合，O(桶数)；
 *            ③ 消除 Array.shift 等 O(n) 操作；④ 非 JSON 响应直接 pipe；
 *            ⑤ 仅在疑似含 usage 的 SSE 帧上做 JSON.parse；⑥ 非流式请求跳过请求体解析。
 *   [交互]   v1.4.0：/api/stats?lite=1 精简载荷（模型/客户端各 5 条、最近 6 条、至多 14 天），
 *            供仪表盘「轻量」档位使用，减少 JSON 序列化、传输与前端解析开销。
 *
 * 环境变量：PORT / TARGET_URL / DATA_DIR / STEPFUN_API_KEY / DISABLE_USAGE_INJECT
 *          SNAPSHOT_MS(20000) / DISABLE_SNAPSHOT / RECENT_MAX(200) / MAX_SOCKETS(256)
 *          MAX_INJECT_BYTES(1048576) / MEMORY_SOFT_LIMIT_MB(384)
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ==================== 配置 ==================== */
const PORT = Number(process.env.PORT || 8787);
const TARGET = new URL(process.env.TARGET_URL || 'https://api.stepfun.com');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'usage.jsonl');
const SNAP_FILE = path.join(DATA_DIR, 'aggregate.json');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');

const INJECT_USAGE = process.env.DISABLE_USAGE_INJECT !== '1';
const PASSTHROUGH_KEY = process.env.STEPFUN_API_KEY || '';

const SNAPSHOT_MS = Math.max(Number(process.env.SNAPSHOT_MS || 20000), 1000);
const SNAPSHOT_OFF = process.env.DISABLE_SNAPSHOT === '1';
const RECENT_MAX = Math.max(Number(process.env.RECENT_MAX || 200), 20);
const MAX_SOCKETS = Math.max(Number(process.env.MAX_SOCKETS || 256), 8);
const MAX_INJECT_BYTES = Math.max(Number(process.env.MAX_INJECT_BYTES || 1048576), 4096);
const MEMORY_SOFT_LIMIT = Math.max(Number(process.env.MEMORY_SOFT_LIMIT_MB || 384), 64) * 1024 * 1024;
const REPLAY_WORKERS = process.env.REPLAY_WORKERS != null
  ? Math.max(Number(process.env.REPLAY_WORKERS) || 0, 0)
  : Math.max(Math.min(os.cpus().length - 1, 4), 0);          // 并行回放线程数（0 = 关闭）
const PARALLEL_MIN_BYTES = 4 * 1024 * 1024;                  // 小于 4MB 时并行不划算
const SSE_BUF_LIMIT = 8192;
const PENDING_MAX = 50000;
const DAY_KEEP_DAYS = 400;
const VERSION = '1.4.0';
const BOOT_T0 = Date.now();

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ==================== 上游连接池（并发优化） ==================== */
const HTTP_AGENT = new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS, maxFreeSockets: 64, scheduling: 'lifo', timeout: 90000 });
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS, maxFreeSockets: 64, scheduling: 'lifo', timeout: 120000 });

/* ==================== 增量聚合（内存优化核心） ==================== */
const totals = { requests: 0, errors: 0, prompt: 0, completion: 0, total: 0 };
const byDay = new Map();
const byModel = new Map();
const byAgent = new Map();

// 最近请求定长环形缓冲：内存恒定 O(RECENT_MAX)
const recent = new Array(RECENT_MAX);
let recentHead = 0, recentCount = 0;

function recentPush(rec) {
  if (recentCount < RECENT_MAX) { recent[(recentHead + recentCount) % RECENT_MAX] = rec; recentCount++; }
  else { recent[recentHead] = rec; recentHead = (recentHead + 1) % RECENT_MAX; }
}
function recentList(limit) {
  const out = [];
  const n = Math.min(limit, recentCount);
  for (let i = 0; i < n; i++) out.push(recent[(recentHead + recentCount - 1 - i) % RECENT_MAX]);
  return out;
}
function recentTrim(keep) { recentCount = Math.min(recentCount, keep); recentHead = 0; }

const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 日键记忆化：回放 20 万条时避免反复构造 Date（按 UTC 分钟缓存，对任意时区偏移均正确）
const dayCache = new Map();
function dayKeyOf(tsStr, tsMs) {
  const k = typeof tsStr === 'string' ? tsStr.slice(0, 16) : '';
  if (!k) return dayKey(tsMs);
  let v = dayCache.get(k);
  if (v === undefined) { if (dayCache.size > 5000) dayCache.clear(); v = dayKey(tsMs); dayCache.set(k, v); }
  return v;
}

function bump(map, key, p, c, t) {
  let b = map.get(key);
  if (b === undefined) { b = { name: key, requests: 0, prompt: 0, completion: 0, total: 0 }; map.set(key, b); }
  b.requests++; b.prompt += p; b.completion += c; b.total += t;
}

/** 单条记录 → 聚合（O(1)，不保留原始对象） */
function applyRecord(rec) {
  const p = rec.prompt_tokens || 0, c = rec.completion_tokens || 0;
  const t = rec.total_tokens || (p + c);
  totals.requests++;
  if ((rec.status || 0) >= 400) totals.errors++;
  totals.prompt += p; totals.completion += c; totals.total += t;

  const ts = Date.parse(rec.ts);
  if (ts) bump(byDay, dayKeyOf(rec.ts, ts), p, c, t);
  if (rec.model) bump(byModel, rec.model, p, c, t);
  bump(byAgent, rec.agent || '未知客户端', p, c, t);
  recentPush(rec);
}

function cloneAgg() {
  return {
    total: { ...totals },
    byDay: new Map([...byDay].map(([k, v]) => [k, { ...v }])),
    byModel: new Map([...byModel].map(([k, v]) => [k, { ...v }])),
    byAgent: new Map([...byAgent].map(([k, v]) => [k, { ...v }])),
    recent: recentList(RECENT_MAX),
  };
}
function restoreAgg(s) {
  Object.assign(totals, s.total || {});
  byDay.clear(); byModel.clear(); byAgent.clear();
  for (const [k, v] of s.byDay || []) byDay.set(k, v);
  for (const [k, v] of s.byModel || []) byModel.set(k, v);
  for (const [k, v] of s.byAgent || []) byAgent.set(k, v);
  recentCount = 0; recentHead = 0;
  for (const r of s.recent || []) recentPush(r);
}

/* ==================== 日志写入（背压队列 + 快照基准） ==================== */
let fileBase = 0;          // 启动时日志文件大小
let writtenBytes = 0;      // 本进程已写入字节
let snapBase = null;       // 队列排空瞬间的聚合快照
let snapBaseBytes = 0;     // 与 snapBase 对应的文件偏移（两者强一致）
let snapDirty = false;
let droppedLines = 0;
let loading = true;
let lastSnapAt = 0;
const pending = [];
let flushing = false;

function saveRecord(rec) {
  applyRecord(rec);                       // 聚合先行：统计不依赖磁盘
  pending.push(JSON.stringify(rec) + '\n');
  if (pending.length > PENDING_MAX) {     // 极端积压下丢弃最旧日志行（聚合已计入，仪表盘不失真）
    pending.splice(0, pending.length - PENDING_MAX);
    droppedLines++;
  }
  if (!flushing) { flushing = true; setImmediate(flushLoop); }
}

async function flushLoop() {
  try {
    while (pending.length) {
      const batch = pending.splice(0, pending.length).join('');
      await fs.promises.appendFile(LOG_FILE, batch, 'utf8');
      writtenBytes += Buffer.byteLength(batch);
    }
    // 此刻 pending 为空且无 await 间隙：聚合状态与文件内容严格一致 → 可作为快照基准
    snapBase = cloneAgg();
    snapBaseBytes = fileBase + writtenBytes;
    snapDirty = true;
    // 节流落盘（≥3s）：即使进程被强杀或断电，冷启动也只需回放极短尾部
    if (Date.now() - lastSnapAt > 3000) writeSnapshot();
  } catch (e) {
    console.error('[log] 写入失败:', e.message);
  } finally {
    flushing = false;
    if (pending.length) { flushing = true; setImmediate(flushLoop); }
  }
}
async function flushNow() {
  while (flushing || pending.length) await new Promise((r) => setTimeout(r, 20));
}

async function writeSnapshot(force = false) {
  if (SNAPSHOT_OFF || !snapBase || (!snapDirty && !force)) return;
  const tmp = SNAP_FILE + '.tmp';
  try {
    lastSnapAt = Date.now();
    // 清理过期日桶，保证快照体积恒定
    const cutoff = dayKey(Date.now() - DAY_KEEP_DAYS * 86400000);
    for (const k of byDay.keys()) if (k < cutoff) byDay.delete(k);
    const payload = {
      v: 2, ts: new Date().toISOString(), consumedBytes: snapBaseBytes, droppedLines,
      total: snapBase.total,
      byDay: [...snapBase.byDay], byModel: [...snapBase.byModel], byAgent: [...snapBase.byAgent],
      recent: snapBase.recent.slice(-RECENT_MAX),
    };
    await fs.promises.writeFile(tmp, JSON.stringify(payload));
    await fs.promises.rename(tmp, SNAP_FILE);
    snapDirty = false;
  } catch (e) {
    console.error('[snapshot] 写入失败:', e.message);
  }
}

/* ==================== 历史加载（冷启动优化） ==================== */
function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }

function readSnapshotSync() {
  try {
    const s = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
    return s && typeof s.consumedBytes === 'number' ? s : null;
  } catch { return null; }
}

/** 分片回放 [start, end)：按字符串切行（避免逐行 Buffer→String 转换）、每 2048 行让出事件循环 */
async function replay(start, end) {
  if (end <= start) return;
  const stream = fs.createReadStream(LOG_FILE, { start, end: end - 1, encoding: 'utf8' });
  let rest = '';
  let n = 0;
  for await (const chunk of stream) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (line.length > 1) { try { applyRecord(JSON.parse(line)); } catch { /* 跳过损坏行 */ } }
      if (((++n) & 2047) === 0) await new Promise((r) => setImmediate(r));  // 让出，保证在途请求不被饿死
    }
  }
  if (rest.trim().length > 1) { try { applyRecord(JSON.parse(rest)); } catch { /* ignore */ } }
}

/* ---------- 并行回放（worker_threads，冷启动加速） ---------- */
/** 把 [start,end) 切成 k 段，并让每段边界对齐到行首（'\n' 之后） */
function findBoundaries(start, end, k) {
  const bounds = [start];
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(65536);
  try {
    for (let i = 1; i < k; i++) {
      let target = Math.floor(start + (end - start) * i / k);
      let pos = target;
      let found = -1;
      while (pos < end && found < 0) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos);
        if (n <= 0) break;
        const idx = buf.subarray(0, n).indexOf(10);
        if (idx !== -1) found = pos + idx + 1;
        pos += n;
      }
      if (found > 0 && found < end) bounds.push(found);
    }
  } finally { fs.closeSync(fd); }
  bounds.push(end);
  return bounds;
}

function runReplayWorker(start, end) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const w = new Worker(new URL('./lib/replay-worker.mjs', import.meta.url), {
        workerData: { file: LOG_FILE, start, end, recentMax: RECENT_MAX },
      });
      const timer = setTimeout(() => { done(null); w.terminate().catch(() => {}); }, 120000);
      w.once('message', (msg) => { clearTimeout(timer); w.terminate().catch(() => {}); done(msg && msg.ok ? msg : null); });
      w.once('error', () => { clearTimeout(timer); done(null); });
    } catch { done(null); }
  });
}

/** 合并 worker 局部聚合（可加和）；recents 按区间顺序拼接后取最新 RECENT_MAX 条 */
function mergePartial(parts) {
  const ordered = parts.slice().sort((a, b) => a.start - b.start);
  let dropped = 0;
  const merged = [];
  for (const p of ordered) {
    totals.requests += p.totals.requests; totals.errors += p.totals.errors;
    totals.prompt += p.totals.prompt; totals.completion += p.totals.completion; totals.total += p.totals.total;
    for (const [k, v] of p.byDay) { const b = byDay.get(k); if (b) { b.requests += v.requests; b.prompt += v.prompt; b.completion += v.completion; b.total += v.total; } else byDay.set(k, v); }
    for (const [k, v] of p.byModel) { const b = byModel.get(k); if (b) { b.requests += v.requests; b.prompt += v.prompt; b.completion += v.completion; b.total += v.total; } else byModel.set(k, v); }
    for (const [k, v] of p.byAgent) { const b = byAgent.get(k); if (b) { b.requests += v.requests; b.prompt += v.prompt; b.completion += v.completion; b.total += v.total; } else byAgent.set(k, v); }
    merged.push(...p.recents);
    if (merged.length > RECENT_MAX * 2) merged.splice(0, merged.length - RECENT_MAX);
    dropped += p.error ? 1 : 0;
  }
  recentCount = 0; recentHead = 0;
  for (const r of merged.slice(-RECENT_MAX)) recentPush(r);
  return dropped;
}

/** 并行回放：任一线程失败即回退到单线程顺序回放，保证正确性优先 */
async function replayParallel(start, end) {
  const k = Math.min(REPLAY_WORKERS, Math.max(2, (end - start) / (1024 * 1024) | 0));
  const bounds = findBoundaries(start, end, k);
  const tasks = [];
  for (let i = 0; i < bounds.length - 1; i++) tasks.push(runReplayWorker(bounds[i], bounds[i + 1]));
  const parts = (await Promise.all(tasks)).filter(Boolean);
  if (parts.length !== bounds.length - 1) {
    console.warn(`[history] 并行回放不完整（${parts.length}/${bounds.length - 1}），回退单线程重建`);
    totals.requests = totals.errors = totals.prompt = totals.completion = totals.total = 0;
    byDay.clear(); byModel.clear(); byAgent.clear(); recentCount = 0; recentHead = 0;
    await replay(start, end);
    return 1;
  }
  mergePartial(parts);
  return parts.length;
}

async function loadHistory() {
  const sizeAtStart = fileSize(LOG_FILE);
  fileBase = sizeAtStart;
  writtenBytes = 0;
  let offset = 0;
  const snap = readSnapshotSync();
  if (snap && snap.consumedBytes <= sizeAtStart) {
    restoreAgg(snap);
    offset = snap.consumedBytes;
    droppedLines = snap.droppedLines || 0;
  } else if (snap) {
    console.warn('[history] 快照偏移超出文件大小（日志被截断/清空），改为全量重建');
  }
  const pendingBytes = Math.max(sizeAtStart - offset, 0);
  const t0 = Date.now();
  let mode = '顺序';
  if (REPLAY_WORKERS > 1 && pendingBytes >= PARALLEL_MIN_BYTES) {
    const n = await replayParallel(offset, sizeAtStart);
    mode = n > 1 ? `并行×${n}` : '顺序(回退)';
  } else {
    await replay(offset, sizeAtStart);
  }
  loading = false;
  snapBase = cloneAgg(); snapBaseBytes = fileBase + writtenBytes; snapDirty = true;
  await writeSnapshot(true);   // 立即落盘：下次启动直接命中快照（冷启动关键）
  console.log(`[history] 历史就绪：${totals.requests} 条，回放 ${pendingBytes} 字节，模式 ${mode}，耗时 ${Date.now() - t0}ms（进程启动至今 ${Date.now() - BOOT_T0}ms）`);
}

/* ==================== 客户端识别 ==================== */
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

/* ==================== SSE usage 扫描（并发优化：仅解析疑似帧） ==================== */
function sseScanner(onUsage) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length < 6 || line.charCodeAt(0) !== 100 /* d */ || line.charCodeAt(1) !== 97 /* a */) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload.length < 8 || payload.charCodeAt(0) !== 123 /* { */) continue;
      // 快路径：仅当该帧可能包含 usage/model 时才做 JSON.parse（终帧之外全部跳过）
      if (payload.indexOf('"usage"') === -1 && payload.indexOf('"model"') === -1) continue;
      try {
        const obj = JSON.parse(payload);
        if (obj && obj.usage && typeof obj.usage === 'object') onUsage(obj.usage, obj.model);
        else if (obj && obj.model) onUsage(null, obj.model);
      } catch { /* 非法帧忽略 */ }
    }
    if (buf.length > SSE_BUF_LIMIT) buf = buf.slice(-1024);
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

/* ==================== 转发核心 ==================== */
const STREAM_TRUE_RE = /"stream"\s*:\s*true/;
const MODEL_RE = /"model"\s*:\s*"([^"\\]{0,64})"/;

function upstreamHeaders(srcHeaders, contentLength) {
  const h = { ...srcHeaders };
  h.host = TARGET.host;
  h['accept-encoding'] = 'identity';       // 明文便于解析 usage
  delete h['transfer-encoding'];
  if (contentLength != null) h['content-length'] = String(contentLength);
  else delete h['content-length'];
  if (PASSTHROUGH_KEY && !h.authorization) h.authorization = `Bearer ${PASSTHROUGH_KEY}`;
  return h;
}

function buildRequest(opts, headers, onResponse) {
  return (TARGET.protocol === 'https:' ? https : http).request({
    protocol: TARGET.protocol,
    hostname: TARGET.hostname,
    port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
    path: opts.path,
    method: opts.method,
    headers,
    agent: TARGET.protocol === 'https:' ? HTTPS_AGENT : HTTP_AGENT,
    timeout: 600000,
  }, onResponse);
}

/** 请求结束时记录一次统计（聚合 + 入队，各一次） */
function finalize(opts, status, usage) {
  saveRecord({
    ts: new Date().toISOString(),
    agent: opts.agent,
    path: opts.path.split('?')[0],
    model: (usage && usage.model) || opts.model || '',
    status,
    prompt_tokens: usage ? (usage.prompt_tokens ?? null) : null,
    completion_tokens: usage ? (usage.completion_tokens ?? null) : null,
    total_tokens: usage ? (usage.total_tokens ?? null) : null,
    latency_ms: Date.now() - opts.start,
  });
}

function proxyError(clientRes, opts, err) {
  if (!clientRes.headersSent) {
    clientRes.writeHead(502, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({ error: { message: `代理无法连接上游: ${err.message}`, type: 'proxy_upstream_error' } }));
  } else clientRes.end();
  finalize(opts, 502, null);
}

function handleUpstreamResponse(upRes, clientReq, clientRes, opts) {
  const status = upRes.statusCode;
  const ct = String(upRes.headers['content-type'] || '');
  const isJson = ct.includes('json');
  const isSSE = ct.includes('text/event-stream');

  // 上游拒绝 stream_options → 用原始请求体回退重发一次
  if (opts.injected && status === 400 && isJson) {
    upRes.resume();
    console.log('[fallback] 上游拒绝 stream_options，已回退为原始请求重发');
    const headers = upstreamHeaders(opts.headers, opts.originalBody.length);
    const upReq = buildRequest(opts, headers, (r2) => handleUpstreamResponse(r2, clientReq, clientRes, { ...opts, injected: false }));
    upReq.on('error', (err) => proxyError(clientRes, opts, err));
    clientRes.on('close', () => { if (!clientRes.writableEnded) upReq.destroy(); });
    upReq.end(opts.originalBody);
    return;
  }

  if (isSSE) {
    let usage = null;
    const scan = sseScanner((u, m) => {
      if (u) usage = normalizeUsage(u, m || opts.model);
      else if (m) opts.model = m;
    });
    clientRes.writeHead(status, upRes.headers);
    upRes.on('data', (c) => { scan(c); clientRes.write(c); });   // 旁路扫描 + 逐块直通，不缓冲
    upRes.on('end', () => { clientRes.end(); finalize(opts, status, usage); });
    upRes.on('error', () => { clientRes.end(); finalize(opts, status, usage); });
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
      } catch { /* 非 JSON 体 */ }
      const out = { ...upRes.headers };
      delete out['content-length'];
      clientRes.writeHead(status, out);
      clientRes.end(buf);
      finalize(opts, status, usage);
    });
    upRes.on('error', () => { clientRes.end(); finalize(opts, status, null); });
    return;
  }

  // 其他类型（二进制/文本）：零拷贝直通
  clientRes.writeHead(status, upRes.headers);
  upRes.pipe(clientRes);
  upRes.on('end', () => finalize(opts, status, null));
  upRes.on('error', () => { clientRes.end(); finalize(opts, status, null); });
}

/** 小请求体：可注入 stream_options、解析 model、解析响应 usage */
function forwardBuffered(clientReq, clientRes, body, opts) {
  const headers = upstreamHeaders(opts.headers, body.length);
  const upReq = buildRequest(opts, headers, (upRes) => handleUpstreamResponse(upRes, clientReq, clientRes, opts));
  upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')));
  upReq.on('error', (err) => proxyError(clientRes, opts, err));
  clientRes.on('close', () => { if (!clientRes.writableEnded) upReq.destroy(); });
  upReq.end(body);
}

/** 大请求体：直接流式透传（不占内存、不注入、不解析请求体），响应侧仍统计 usage */
function forwardStreamed(clientReq, clientRes, opts) {
  const headers = upstreamHeaders(opts.headers, null);   // 走 chunked，不做长度改写
  const upReq = buildRequest(opts, headers, (upRes) => handleUpstreamResponse(upRes, clientReq, clientRes, opts));
  upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')));
  upReq.on('error', (err) => proxyError(clientRes, opts, err));
  clientRes.on('close', () => { if (!clientRes.writableEnded) upReq.destroy(); });
  clientReq.pipe(upReq);
}

/* ==================== 统计查询（O(桶数)，不遍历历史） ==================== */
function statsFor(days, lite) {
  const since = Date.now() - (days - 1) * 86400000;
  const cutoff = dayKey(since);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(Date.now() - i * 86400000);
    const b = byDay.get(key);
    series.push(b ? { day: key, ...b } : { day: key, name: key, requests: 0, prompt: 0, completion: 0, total: 0 });
  }
  const sortDesc = (m) => [...m.values()].sort((x, y) => y.total - x.total);
  const windowTotal = series.reduce((s, d) => s + d.total, 0);
  // v1.4.0：lite=1 精简载荷（前端「轻量」档位使用）——减少 JSON.stringify 与前端解析成本
  const topN = lite ? 5 : 50;
  const recentN = lite ? 6 : 50;
  return {
    days,
    total: {
      requests: totals.requests, errors: totals.errors, prompt: totals.prompt,
      completion: totals.completion, total: totals.total, windowTotal,
    },
    byDay: series.filter((d) => d.day >= cutoff),
    byModel: sortDesc(byModel).slice(0, topN),
    byAgent: sortDesc(byAgent).slice(0, topN),
    recent: recentList(recentN),
    meta: {
      target: TARGET.origin, port: PORT, version: VERSION,
      requests: totals.requests, file: LOG_FILE,
      loading, snapshot: !SNAPSHOT_OFF,
      droppedLines, recentMax: RECENT_MAX, maxSockets: MAX_SOCKETS,
      mode: lite ? 'lite' : 'full', ts: Date.now(),
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      uptimeSec: Math.round(process.uptime()),
      sockets: (HTTPS_AGENT.sockets ? Object.keys(HTTPS_AGENT.sockets).length : 0) + (HTTP_AGENT.sockets ? Object.keys(HTTP_AGENT.sockets).length : 0),
    },
  };
}

/* ==================== HTTP 服务 ==================== */
function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

let dashCache = null;
function getDashboard() {
  try {
    const st = fs.statSync(DASHBOARD_FILE);
    if (!dashCache || dashCache.mtime !== st.mtimeMs) dashCache = { mtime: st.mtimeMs, buf: fs.readFileSync(DASHBOARD_FILE) };
    return dashCache.buf;
  } catch { return Buffer.from('<h1>dashboard.html 缺失</h1>'); }
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const start = Date.now();

  if (url === '/' || url === '/dashboard') {
    const buf = getDashboard();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(buf);
  }
  if (url === '/healthz') return sendJson(res, 200, { ok: true, version: VERSION, loading, records: totals.requests });
  // 浏览器自动请求的图标：本地应答，绝不转发到上游（避免无谓的上游请求与 404 噪声）
  if (url === '/favicon.ico' || url === '/robots.txt') { res.writeHead(204); return res.end(); }
  if (url.startsWith('/api/stats')) {
    const q = new URL(url, 'http://x').searchParams;
    const days = Math.min(Math.max(parseInt(q.get('days') || '30', 10) || 30, 1), 365);
    const lite = q.get('lite') === '1';                // v1.4.0：精简载荷
    return sendJson(res, 200, statsFor(lite ? Math.min(days, 14) : days, lite));
  }
  if (url.startsWith('/api/logs')) {
    const q = new URL(url, 'http://x').searchParams;
    const limit = Math.min(Math.max(parseInt(q.get('limit') || '500', 10) || 500, 1), 5000);
    const rows = recentList(Math.min(limit, RECENT_MAX));
    return sendJson(res, 200, { count: rows.length, rows, note: `仅保留最近 ${RECENT_MAX} 条（环形缓冲，内存恒定）` });
  }
  if (url === '/api/clear' && req.method === 'POST') {
    totals.requests = totals.errors = totals.prompt = totals.completion = totals.total = 0;
    byDay.clear(); byModel.clear(); byAgent.clear();
    recentCount = 0; recentHead = 0;
    try { fs.writeFileSync(LOG_FILE, ''); fs.rmSync(SNAP_FILE, { force: true }); } catch { /* ignore */ }
    fileBase = 0; writtenBytes = 0; snapBase = cloneAgg(); snapBaseBytes = 0; snapDirty = true;
    console.log('[admin] 本地用量数据已清空');
    return sendJson(res, 200, { ok: true });
  }
  if (url === '/api/snapshot' && req.method === 'POST') {
    try { await flushNow(); await writeSnapshot(true); } catch { /* ignore */ }
    return sendJson(res, 200, { ok: true, consumedBytes: snapBaseBytes });
  }
  if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

  /* ---- 业务请求转发 ---- */
  const agent = detectAgent(req);
  const isChat = /\/(chat\/completions|completions|responses)(\?|$)/.test(url);
  const len = Number(req.headers['content-length'] || 0);
  const opts = { headers: req.headers, path: url, method: req.method, agent, model: '', start, injected: false, originalBody: null };

  // 快速路径：大请求体直接流式透传（内存与并发双优化）
  if (len > MAX_INJECT_BYTES) return forwardStreamed(req, res, opts);

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    const raw = body.length ? body.toString('utf8') : '';

    // 只在疑似流式请求时才整体解析（非流式请求跳过 JSON.parse）
    if (INJECT_USAGE && isChat && raw.length && STREAM_TRUE_RE.test(raw)) {
      try {
        const obj = JSON.parse(raw);
        if (obj.stream === true && !(obj.stream_options && obj.stream_options.include_usage === true)) {
          if (typeof obj.model === 'string') opts.model = obj.model;
          obj.stream_options = { ...(obj.stream_options || {}), include_usage: true };
          opts.originalBody = body;
          body = Buffer.from(JSON.stringify(obj), 'utf8');
          opts.injected = true;
        }
      } catch { /* 非 JSON 体，原样转发 */ }
    }
    if (!opts.model && raw.length) {
      const m = MODEL_RE.exec(raw);
      if (m) opts.model = m[1];
    }
    forwardBuffered(req, res, body, opts);
  });
  req.on('error', () => { if (!res.headersSent) res.writeHead(400); res.end(); });
});

// 长流式响应友好：不因空闲中断连接
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0;
server.maxRequestsPerSocket = 0;

/* ==================== 内存软阈值保护 ==================== */
let memTrimCount = 0;
setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > MEMORY_SOFT_LIMIT) {
    recentTrim(50);
    memTrimCount++;
    console.warn(`[memory] RSS ${Math.round(rss / 1048576)}MB 超过软阈值，已裁剪最近请求缓冲（第 ${memTrimCount} 次）`);
    writeSnapshot(true);
    if (global.gc) { try { global.gc(); } catch { /* ignore */ } }
  }
}, 15000).unref();

if (!SNAPSHOT_OFF) setInterval(() => writeSnapshot(), SNAPSHOT_MS).unref();

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] 收到 ${sig}，正在落盘…`);
  try { await flushNow(); await writeSnapshot(true); } catch { /* ignore */ }
  console.log('[shutdown] 完成');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));

/* ==================== 启动：先可服务，再后台加载历史（冷启动优化） ==================== */
server.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================================');
  console.log(`  StepFun API Token 用量监控代理  v${VERSION}  (零依赖 · 数据全本地)`);
  console.log(`  监听就绪   : ${Date.now() - BOOT_T0} ms（模块加载→监听，不含 Node 自身启动）`);
  console.log(`  监听地址   : http://127.0.0.1:${PORT}`);
  console.log(`  上游目标   : ${TARGET.origin}`);
  console.log(`  仪表盘     : http://127.0.0.1:${PORT}/`);
  console.log(`  数据文件   : ${LOG_FILE}`);
  console.log(`  性能参数   : 连接池 ${MAX_SOCKETS} · 环形缓冲 ${RECENT_MAX} · 快照 ${SNAPSHOT_OFF ? '关闭' : SNAPSHOT_MS + 'ms'} · 大体积直通 >${Math.round(MAX_INJECT_BYTES / 1024)}KB`);
  console.log('  历史加载   : 后台进行中（服务已可用）');
  console.log('==============================================================');
});
loadHistory().catch((e) => { console.error('[history] 加载异常:', e.message); loading = false; });
