#!/usr/bin/env node
/**
 * stepfun-usage-monitor MCP Server（stdio 传输，零依赖）
 *
 * 让 ZCode / Claude Code / Cline 等支持 MCP 的 Agent 直接对话查询本地 Token 用量。
 * 数据源与 proxy.mjs 相同（usage.jsonl），只读访问；数据目录解析规则见 lib/paths.mjs（v1.5.0 三入口统一）。
 * v1.5.5：query_stepfun_usage 支持 group="provider" 按服务商分组（多服务商统计）。
 *
 * ZCode / Claude Code 配置示例（推荐 npx 直载，无需 clone；v1.5.0 起）：
 * {
 *   "mcpServers": {
 *     "stepfun-usage": {
 *       "command": "npx",
 *       "args": ["-y", "github:Neriah-Ado/stepfun-usage-monitor", "--mcp"]
 *     }
 *   }
 * }
 * 手动安装等价写法："command": "node", "args": ["<本文件绝对路径>\\mcp-server.mjs"]
 *
 * 环境变量：DATA_DIR — 指定数据目录（默认按 lib/paths.mjs 解析：
 *          DATA_DIR > ~/.stepfun-usage-monitor/ > 包内 data/（历史数据兼容））
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolveDataDir(__dirname);   // v1.5.0：npx 直载时落 ~/.stepfun-usage-monitor/，与 proxy.mjs 完全一致
const LOG_FILE = path.join(DATA_DIR, 'usage.jsonl');

const pad = (n) => String(n).padStart(2, '0');
const fmtN = (n) => Number(n || 0).toLocaleString('zh-CN');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function loadRecords() {
  const out = [];
  try {
    for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
      if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* skip */ } }
    }
  } catch { /* 无数据文件 */ }
  return out;
}

function query({ days = 7, group = 'agent' } = {}) {
  const records = loadRecords();
  const since = Date.now() - Number(days) * 86400000;
  let req = 0, err = 0, p = 0, c = 0, tt = 0;
  const map = new Map();
  const touch = (k) => { if (!map.has(k)) map.set(k, { name: k, requests: 0, prompt: 0, completion: 0, total: 0 }); return map.get(k); };

  for (const r of records) {
    const t = Date.parse(r.ts);
    if (!(t >= since)) continue;
    const pp = r.prompt_tokens || 0, cc = r.completion_tokens || 0;
    req++; if ((r.status || 0) >= 400) err++;
    p += pp; c += cc; tt += (r.total_tokens || pp + cc);
    const key = group === 'day' ? dayKey(t)
      : group === 'model' ? (r.model || '未知模型')
      : group === 'provider' ? (r.provider || 'stepfun')   // v1.5.5：按服务商分组
      : (r.agent || '未知客户端');
    const g = touch(key); g.requests++; g.prompt += pp; g.completion += cc; g.total += (r.total_tokens || pp + cc);
  }

  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const groupName = group === 'day' ? '天' : group === 'model' ? '模型' : group === 'provider' ? '服务商' : '客户端';
  const lines = [
    `StepFun API Token 用量（最近 ${days} 天，按${groupName}分组）`,
    `总计：请求 ${req} 次（失败 ${err}），输入 ${fmtN(p)}，输出 ${fmtN(c)}，合计 ${fmtN(tt)} tokens。`,
    '',
    ...rows.map((r) => `${r.name}：请求 ${r.requests} 次，输入 ${fmtN(r.prompt)}，输出 ${fmtN(r.completion)}，合计 ${fmtN(r.total)} tokens`),
  ];
  if (!rows.length) lines.push('（该时间范围内没有请求记录）');
  return lines.join('\n');
}

const TOOLS = [
  {
    name: 'query_stepfun_usage',
    description: '查询本地记录的 StepFun API Token 用量统计（数据由 stepfun-usage-monitor 代理采集，全部存储在本地）',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近 N 天，默认 7，最大 3650' },
        group: { type: 'string', enum: ['day', 'model', 'agent', 'provider'], description: '分组方式：day=按天，model=按模型，agent=按客户端，provider=按服务商（v1.5.5），默认 agent' },
      },
    },
  },
];

function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return {
      protocolVersion: params && params.protocolVersion ? params.protocolVersion : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'stepfun-usage-monitor', version: '1.5.5' },
    };
  }
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call' && params && params.name === 'query_stepfun_usage') {
    try {
      const text = query(params.arguments || {});
      return { content: [{ type: 'text', text }], isError: false };
    } catch (e) {
      return { content: [{ type: 'text', text: '查询失败: ' + e.message }], isError: true };
    }
  }
  if (method === 'ping') return {};
  return undefined;
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg == null || typeof msg !== 'object') return;
  if (msg.id == null) return; // notification（如 notifications/initialized），无需响应
  const result = handleMessage(msg);
  if (result === undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
});
rl.on('close', () => process.exit(0));
