#!/usr/bin/env node
/**
 * VSIX 构建器（v1.5.0，零依赖）
 * 纯 Node 实现 ZIP（stored 不压缩条目 + CRC32 + 中央目录 + EOCD），产出
 *   ide-extension/dist/stepfun-monitor-<版本>.vsix
 * 构建后立即「读回自校验」：解析中央目录、逐条目核对 CRC 与内容。
 * 结果写入 test/vsix-build.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'ide-extension');
const OUT_DIR = path.join(EXT, 'dist');
const LOG = path.join(ROOT, 'test', 'vsix-build.txt');

const OUT = [];
const log = (s) => { OUT.push(s); };
const flush = () => fs.writeFileSync(LOG, OUT.join('\n') + '\n');

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* ---------------- ZIP 写出（stored） ---------------- */
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 文件名标志
    local.writeUInt16LE(0, 8);             // method: stored
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // comp size
    local.writeUInt32LE(data.length, 22);  // uncomp size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4);           // made by: unix, zip 3.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/内部属性 全 0
    cd.writeUInt32LE(0, 36);               // 外部属性
    cd.writeUInt32LE(offset, 42);          // 本地头偏移
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/* ---------------- ZIP 读回（独立解析中央目录，自校验） ---------------- */
function readZip(buf) {
  if (buf.readUInt32LE(buf.length - 22) !== 0x06054b50) throw new Error('EOCD 签名缺失');
  const n = buf.readUInt16LE(buf.length - 22 + 10);
  const cdOff = buf.readUInt32LE(buf.length - 22 + 16);
  const files = [];
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录签名错误 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // 本地头 → 数据
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + size);
    files.push({ name, method, crc, size, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------- 组装 VSIX ---------------- */
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));
const VER = manifest.version;

const ASSETS = [
  ['extension/package.json', path.join(EXT, 'package.json')],
  ['extension/extension.js', path.join(EXT, 'extension.js')],
  ['extension/README.md', path.join(EXT, 'README.md')],
  ['extension/LICENSE', path.join(EXT, 'LICENSE')],
  ['extension/media/chart.svg', path.join(EXT, 'media', 'chart.svg')],
];

const repoUrl = 'https://github.com/Neriah-Ado/stepfun-usage-monitor';
const vsixmanifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2010" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="zh-CN" Id="stepfun-monitor" Version="${VER}" Publisher="neriah-ado"/>
    <DisplayName>StepFun Usage Monitor</DisplayName>
    <Description xml:space="preserve">在 IDE 内以底边栏面板 / 小窗 / 独立浏览器页面三种方式浏览 StepFun API Token 用量监控仪表盘（stepfun-usage-monitor 的伴侣扩展，零依赖）</Description>
    <Tags>stepfun,token,usage,monitor,llm,mcp</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="zh-CN"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${repoUrl}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="${repoUrl}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Repository" Value="${repoUrl}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Issues" Value="${repoUrl}/issues"/>
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true"/>
      <Property Id="Microsoft.VisualStudio.Services.Content.License" Value="extension/LICENSE"/>
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation InstalledByMsi="false">
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
  </Assets>
</PackageManifest>`;

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="text/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="txt" ContentType="text/plain"/>
</Types>`;

const entries = [
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
  { name: 'extension.vsixmanifest', data: Buffer.from(vsixmanifest, 'utf8') },
  ...ASSETS.map(([name, p]) => ({ name, data: fs.readFileSync(p) })),
];

log(`构建 stepfun-monitor-${VER}.vsix（${entries.length} 个条目）`);
const zip = buildZip(entries);
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `stepfun-monitor-${VER}.vsix`);
fs.writeFileSync(outFile, zip);
log(`写出: ${outFile}（${(zip.length / 1024).toFixed(1)} KB）`);

/* ---------------- 自校验 ---------------- */
let ok = true;
const back = readZip(fs.readFileSync(outFile));
log('');
for (const f of back) {
  const crcOk = crc32(f.data) === f.crc;
  const storedOk = f.method === 0 && f.size === f.data.length;
  log(`${crcOk && storedOk ? 'PASS' : 'FAIL'} - ${f.name} (${f.size} bytes, crc ${crcOk ? 'OK' : 'MISMATCH'})`);
  if (!crcOk || !storedOk) ok = false;
}
const names = back.map((f) => f.name);
for (const must of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/extension.js', 'extension/media/chart.svg']) {
  const has = names.includes(must);
  log(`${has ? 'PASS' : 'FAIL'} - 必需条目存在: ${must}`);
  if (!has) ok = false;
}
log('');
log(ok ? `自校验全部通过：${back.length} 条目` : '自校验存在失败项');
flush();
process.exitCode = ok ? 0 : 1;
