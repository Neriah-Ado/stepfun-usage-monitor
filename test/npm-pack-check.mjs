#!/usr/bin/env node
/**
 * v1.5.9 npx 直载链路验证：npm pack → tarball 内容 → tarball 安装 → bin 双模式运行 → 数据目录解析
 * 结果写入 test/pack-check.txt（本机 PowerShell 无 stdout，统一文件化输出）。
 */
import { execFileSync, spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = [];
const ok = (name, cond, detail = '') => OUT.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
const NPM = 'C:/Users/34660/.workbuddy/binaries/node/versions/22.22.2-3/npm.cmd';
const NODE = process.execPath;

let tmp;
try {
  /* ===== 1. npm pack ===== */
  execSync(`"${NPM}" pack --pack-destination "${ROOT}"`, { cwd: ROOT, stdio: 'pipe' });
  const tgz = path.join(ROOT, 'stepfun-usage-monitor-1.5.9.tgz');
  ok('npm pack 生成 tarball', fs.existsSync(tgz), fs.existsSync(tgz) ? fs.statSync(tgz).size + 'B' : 'missing');

  /* ===== 2. tarball 内容完整性 ===== */
  /* GNU tar 会把 "H:\..." 误判为远程主机，必须用系统自带 bsdtar 绝对路径 */
  const TAR = 'C:/Windows/System32/tar.exe';
  const listing = execSync(`"${TAR}" -tzf "${tgz}"`, { encoding: 'utf8' });
  const need = [
    'package/package.json', 'package/proxy.mjs', 'package/mcp-server.mjs', 'package/stats.mjs',
    'package/dashboard.html', 'package/bin/cli.mjs', 'package/lib/paths.mjs', 'package/lib/providers.mjs',
    'package/lib/replay-worker.mjs', 'package/lib/open-panel.mjs',
    'package/marketplace.json',
    'package/plugins/stepfun-usage-monitor/.zcode-plugin/plugin.json',
    'package/plugins/stepfun-usage-monitor/commands/sfm.md',
    'package/plugins/stepfun-usage-monitor/.mcp.json',
    'package/start.cmd', 'package/open-window.cmd', 'package/open-panel.cmd',
    'package/README.md', 'package/README.en.md', 'package/docs/releases/v1.5.9.md',
    'package/LICENSE', 'package/CHANGELOG.md',
  ];
  const missing = need.filter((f) => !listing.includes(f));
  ok('tarball 含全部运行文件（含 ZCode 插件结构）', missing.length === 0, missing.length ? '缺 ' + missing.join(',') : `${need.length} 个文件`);
  ok('tarball 不含测试/发布目录', !listing.includes('package/test/') && !listing.includes('package/ide-extension/dist'));
  ok('tarball 不含旧 zcode/ 目录', !listing.includes('package/zcode/'));

  /* ===== 3. tarball 安装到临时目录 ===== */
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfm-pack-'));
  execSync(`"${NPM}" init -y`, { cwd: tmp, stdio: 'pipe' });
  execSync(`"${NPM}" install "${tgz}" --no-audit --no-fund --loglevel=error`, { cwd: tmp, stdio: 'pipe' });
  const installed = path.join(tmp, 'node_modules', 'stepfun-usage-monitor');
  ok('tarball 可安装', fs.existsSync(path.join(installed, 'bin', 'cli.mjs')));
  ok('安装后 bin/cli.mjs 存在 shebang', fs.readFileSync(path.join(installed, 'bin', 'cli.mjs'), 'utf8').startsWith('#!/usr/bin/env node'));

  /* ===== 4. 数据目录解析（装进 npm 缓存式目录后应指向 ~/.stepfun-usage-monitor） ===== */
  const resScript = `
    import { resolveDataDir } from ${JSON.stringify(pathToFileURL(path.join(installed, 'lib', 'paths.mjs')).href)};
    process.stdout.write(JSON.stringify({ r: resolveDataDir(${JSON.stringify(installed)}) }));
  `;
  const resFile = path.join(tmp, 'res.mjs');
  fs.writeFileSync(resFile, resScript);
  const run = (env) => JSON.parse(execFileSync(NODE, [resFile], { encoding: 'utf8', env: { ...process.env, ...env } }));
  const res = run({ DATA_DIR: '' });
  ok('默认解析指向 ~/.stepfun-usage-monitor', res.r === path.join(os.homedir(), '.stepfun-usage-monitor'), res.r);
  const res2 = run({ DATA_DIR: path.join(tmp, 'mydata') });
  ok('DATA_DIR 环境变量最优先', res2.r === path.resolve(path.join(tmp, 'mydata')), res2.r);

  /* ===== 5. 装好后默认模式（proxy）真实运行 ===== */
  const dataTmp = path.join(tmp, 'data');
  const child = spawn(NODE, [path.join(installed, 'bin', 'cli.mjs'), '--port', '8792'], {
    env: { ...process.env, PORT: '8792', DATA_DIR: dataTmp }, stdio: 'ignore',
  });
  let health = null, html = '', lite = null, stats = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      health = JSON.parse(await (await fetch('http://127.0.0.1:8792/healthz')).text());
      break;
    } catch { /* 未就绪 */ }
  }
  ok('安装后 bin 默认模式可启动', !!health && health.ok === true, health ? 'v' + health.version : 'no response');
  ok('/healthz 版本 1.5.9', !!health && health.version === '1.5.9');
  if (health) {
    html = await (await fetch('http://127.0.0.1:8792/')).text();
    lite = await (await fetch('http://127.0.0.1:8792/api/stats?days=30&lite=1')).json();
    stats = await (await fetch('http://127.0.0.1:8792/api/stats?days=30')).json();
  }
  ok('仪表盘 HTML 含布局脚本', html.includes('URLSearchParams(location.search)') && html.includes('data-layout'));
  ok('仪表盘 HTML 含「全量显示」按钮（v1.5.9）', html.includes('id="btn-full"'));
  ok('lite 载荷 200 且结构正确', !!lite && Array.isArray(lite.byDay) && !!lite.meta);
  ok('完整载荷 200 且 meta.version=1.5.9', !!stats && stats.meta && stats.meta.version === '1.5.9');
  ok('数据目录落 DATA_DIR（启动即创建；usage.jsonl 首条记录时追加）',
    fs.existsSync(dataTmp), fs.existsSync(dataTmp) ? 'dir ok' : 'dir missing');
  try { child.kill('SIGKILL'); } catch { /* 已退出 */ }

  /* ===== 6. 安装后 --mcp 模式（stdio JSON-RPC） ===== */
  const mcpIn = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n';
  const mcpOut = execFileSync(NODE, [path.join(installed, 'bin', 'cli.mjs'), '--mcp'], {
    input: mcpIn, encoding: 'utf8', env: { ...process.env, DATA_DIR: dataTmp }, timeout: 15000,
  });
  const mcpMsg = JSON.parse(mcpOut.split('\n').find((l) => l.includes('"id":1')) || '{}');
  ok('--mcp 模式 initialize 应答', mcpMsg.result && mcpMsg.result.serverInfo, mcpMsg.result ? 'v' + mcpMsg.result.serverInfo.version : 'none');
  ok('--mcp serverInfo.version=1.5.9', mcpMsg.result && mcpMsg.result.serverInfo && mcpMsg.result.serverInfo.version === '1.5.9');

  OUT.push(`\n临时目录：${tmp}`);
  OUT.push('RESULT: ' + (OUT.some((l) => l.startsWith('FAIL')) ? 'FAIL' : 'ALL-PASS'));
} catch (e) {
  OUT.push('EXCEPTION: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  OUT.push('RESULT: FAIL');
} finally {
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
  try { fs.rmSync(path.join(ROOT, 'stepfun-usage-monitor-1.5.9.tgz'), { force: true }); } catch { /* ignore */ }
}
fs.writeFileSync(path.join(__dirname, 'pack-check.txt'), OUT.join('\n') + '\n');
