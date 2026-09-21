#!/usr/bin/env node
// 仪表盘内联 JS 语法校验 + 静态断言（结果写 test/ui-feature.txt）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = [];
const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

// 1. 提取内联 <script> 并写临时文件做 node --check（写入系统临时目录，不污染仓库）
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { OUT.push('FAIL 未找到内联 script'); }
else {
  const jsFile = path.join(os.tmpdir(), `dash-inline-${process.pid}.js`);
  fs.writeFileSync(jsFile, m[1]);
  try {
    execFileSync(process.execPath, ['--check', jsFile], { stdio: 'ignore', timeout: 20000 });
    OUT.push('PASS 内联 JS 语法校验通过');
  } catch (e) {
    OUT.push('FAIL 内联 JS 语法错误: ' + (e.stderr || e.message).toString().trim().split('\n').slice(0, 6).join('\n'));
  } finally {
    try { fs.rmSync(jsFile, { force: true }); } catch { /* ignore */ }
  }
}

// 2. 静态断言
const checks = [
  ['提示按钮存在', /id="hint-btn"/.test(html)],
  ['提示文本（芯片）存在且内容为鹈鹕测试提示词', /id="hint-chip"[^>]*>画一只骑自行车的鹈鹕</.test(html)],
  ['鹈鹕提示词常量定义', html.includes("const PELICAN_PROMPT = '画一只骑自行车的鹈鹕'")],
  ['两个元素都绑定了复制处理', /getElementById\('hint-btn'\)\.addEventListener\('click', copyPelicanPrompt\)/.test(html) && /getElementById\('hint-chip'\)\.addEventListener\('click', copyPelicanPrompt\)/.test(html)],
  ['成功 Toast（已复制）', /showToast\('已复制：' \+ PELICAN_PROMPT, 'ok'\)/.test(html)],
  ['失败 Toast（复制失败）', /showToast\('复制失败：'/ .test(html)],
  ['Toast 容器存在且带 aria-live', /id="toast" role="status" aria-live="polite"/.test(html)],
  ['现代剪贴板 API（安全上下文判断）', /navigator\.clipboard && navigator\.clipboard\.writeText && window\.isSecureContext/.test(html)],
  ['execCommand 回退实现', /document\.execCommand\('copy'\)/.test(html) && /setSelectionRange\(0, text\.length\)/.test(html)],
  ['选区还原（不干扰页面）', /sel\.removeAllRanges\(\); sel\.addRange\(prev\)/.test(html)],
  ['提示面板位于 #app 之外（自动刷新不重建）', html.indexOf('id="hint-panel"') < html.indexOf('id="app"') && !/id="app"[\s\S]*id="hint-panel"/.test(html)],
  ['移动端适配（≥40px 触控目标 + touch-action + tap-highlight）', /min-height:40px/.test(html) && /touch-action:manipulation/.test(html) && /-webkit-tap-highlight-color:transparent/.test(html)],
  ['user-select:none 防长按选中', /user-select:none/.test(html)],
  ['自动刷新逻辑未被改动', /setInterval\(load, 30000\)/.test(html)],
];
for (const [name, ok] of checks) OUT.push(`${ok ? 'PASS' : 'FAIL'} - ${name}`);

fs.writeFileSync(path.join(__dirname, 'ui-feature.txt'), OUT.join('\n') + '\n');
