/**
 * 数据目录解析（v1.5.0）
 *
 * 背景：v1.5.0 起 `npx github:Neriah-Ado/stepfun-usage-monitor` 可直接从 GitHub 拉起本工具。
 * 经 npx 运行时，包体落在 npm 缓存（_npx 目录），随缓存清理会被删除——若把数据写进包内
 * data/，用量记录会随缓存一起丢失。因此统一按以下优先级解析（三个入口 proxy / mcp-server /
 * stats 行为完全一致）：
 *
 *   1. 环境变量 DATA_DIR（显式指定，最优先）
 *   2. ~/.stepfun-usage-monitor/（存在即用：npx / 全新安装的稳定数据目录）
 *   3. <包目录>/data/ 且其中已有 usage.jsonl（v1.4.0 及更早手动安装的历史数据，原地兼容）
 *   4. 兜底 ~/.stepfun-usage-monitor/（首次运行时由调用方创建）
 *
 * 手动安装升级用户（仓库 data/ 已有数据）不受影响，继续使用原目录；
 * 手动安装与 npx 两种方式混用时，请用 DATA_DIR 显式统一指向同一目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DATA_DIR = path.join(os.homedir(), '.stepfun-usage-monitor');

export function resolveDataDir(pkgDir) {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(process.env.DATA_DIR.trim());
  }
  if (fs.existsSync(HOME_DATA_DIR)) return HOME_DATA_DIR;
  const legacy = path.join(pkgDir, 'data');
  try {
    if (fs.existsSync(path.join(legacy, 'usage.jsonl'))) return legacy;
  } catch { /* 权限异常时按全新安装处理 */ }
  return HOME_DATA_DIR;
}
