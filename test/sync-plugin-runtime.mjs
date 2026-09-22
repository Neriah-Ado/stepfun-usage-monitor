#!/usr/bin/env node
/**
 * 同步插件 runtime：把仓库运行文件复制到 plugins/stepfun-usage-monitor/runtime/，
 * 使 ZCode 插件安装后自包含（安装布局只含插件目录本身，不含仓库根文件）。
 * 用法：node test/sync-plugin-runtime.mjs
 * 同步清单（相对仓库根 → runtime/ 内保持相对结构）：
 *   bin/cli.mjs, lib/*.mjs, proxy.mjs, mcp-server.mjs, stats.mjs, dashboard.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'stepfun-usage-monitor');
const RUNTIME = path.join(PLUGIN, 'runtime');

const FILES = [
  'bin/cli.mjs',
  'proxy.mjs',
  'mcp-server.mjs',
  'stats.mjs',
  'dashboard.html',
  'package.json',
];
const DIRS = ['lib'];

let copied = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  const dst = path.join(RUNTIME, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  const dst = path.join(RUNTIME, d);
  fs.cpSync(src, dst, { recursive: true });
  const n = fs.readdirSync(dst).length;
  copied += n;
}
// 生成标记文件（便于核验同步状态）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(RUNTIME, 'RUNTIME-INFO.txt'),
  `runtime 同步自仓库根（版本 ${pkg.version}）\n同步脚本：test/sync-plugin-runtime.mjs\n勿手改本目录，改仓库根对应文件后重跑同步脚本。\n`, 'utf8');

// 核验：runtime 内文件与仓库根逐字节一致
let mismatch = 0;
for (const f of FILES) {
  const a = fs.readFileSync(path.join(ROOT, f));
  const b = fs.readFileSync(path.join(RUNTIME, f));
  if (!a.equals(b)) { mismatch++; console.log('MISMATCH ' + f); }
}
for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) {
  const a = fs.readFileSync(path.join(ROOT, 'lib', f));
  const b = fs.readFileSync(path.join(RUNTIME, 'lib', f));
  if (!a.equals(b)) { mismatch++; console.log('MISMATCH lib/' + f); }
}
console.log(`SYNC-OK files=${copied} mismatch=${mismatch} version=${pkg.version}`);
// runtime cli 可执行性快检（--version 不走网络）
try {
  const v = execFileSync(process.execPath, [path.join(RUNTIME, 'bin', 'cli.mjs'), '--version'], { encoding: 'utf8' }).trim();
  console.log('runtime cli --version => ' + v);
} catch (e) {
  console.log('runtime cli --version ERR: ' + e.message);
  process.exitCode = 1;
}
