#!/usr/bin/env node
/**
 * 模拟 StepFun 上游（仅测试用）：支持非流式 JSON 与流式 SSE 两种响应，
 * 并把收到的请求要点记录到 test/mock-log.txt 供验证。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT || 18791);
const DELAY = Number(process.env.MOCK_DELAY || 0);   // 模拟上游推理延迟（压测用）
const logLines = [];
const noLog = process.env.MOCK_NOLOG === '1';        // 压测时关闭日志写入

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    let obj = {};
    try { obj = JSON.parse(body); } catch { /* ignore */ }
    const model = obj.model || 'step-2-16k';
    if (!noLog) {
      logLines.push(`${new Date().toISOString()} ${req.method} ${req.url} model=${model} stream=${!!obj.stream} stream_options=${JSON.stringify(obj.stream_options || null)}`);
      fs.writeFileSync(path.join(__dirname, 'mock-log.txt'), logLines.join('\n') + '\n');
    }

    if (req.url.includes('chat/completions') && obj.stream === true) {
      // 模拟"上游不认 stream_options"的场景，用于验证代理的自动回退逻辑
      if (obj.stream_options && model === 'no-so-support') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'unsupported stream_options' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      // 立即写首帧：确保响应头立刻发出（只有 writeHead 而无 write 时，Node 不会真正发送响应头）
      res.write(`data: ${JSON.stringify({ id: 'mock', model, choices: [{ delta: { content: 'hi' } }] })}\n\n`);
      let i = 1;
      const timer = setInterval(() => {
        if (i < 3) {
          res.write(`data: ${JSON.stringify({ id: 'mock', model, choices: [{ delta: { content: 'hi' } }] })}\n\n`);
          i++;
        } else {
          clearInterval(timer);
          res.write(`data: ${JSON.stringify({ id: 'mock', model, choices: [], usage: { prompt_tokens: 100 + model.length, completion_tokens: 66, total_tokens: 166 + model.length } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 15);
      // 仅在连接真正关闭时清理定时器（req 的 close 在请求体读完即触发，会误杀定时器）
      res.on('close', () => clearInterval(timer));
    } else if (req.url.includes('not-exist')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    } else {
      const send = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'mock', object: 'chat.completion', model,
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
        }));
      };
      if (DELAY > 0) setTimeout(send, DELAY); else send();
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock upstream on 127.0.0.1:${PORT}`));
