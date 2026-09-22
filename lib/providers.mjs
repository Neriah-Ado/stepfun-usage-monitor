/**
 * 多服务商注册表与路由（v1.5.5）
 *
 * 背景：v1.5.5 起支持在同一个代理实例内服务多家大模型服务商（OpenAI 兼容），
 * 使用记录按服务商分组统计（usage.jsonl 增加 provider 字段，/api/stats 增加 byProvider）。
 *
 * 路由优先级（从高到低，前一级命中即不再向下匹配）：
 *   1. 路径前缀   /p/<key>/v1/...      转发时剥掉 /p/<key> 前缀，路径与密钥均不变
 *   2. 请求头     X-Provider: <key>    适合不方便改路径的客户端
 *   3. 模型名前缀 <model> 命中服务商的 modelPrefixes（仅请求体可解析时生效；
 *                                      超大流式透传请求体不解析，自动落到下一级）
 *   4. 激活默认   当前激活服务商（默认 stepfun；仪表盘一键切换或 POST /api/provider）
 *
 * 密钥注入顺序（客户端未带 Authorization 时）：
 *   providers.json 内的 apiKey > 环境变量（各服务商 envKeys，如 STEPFUN_API_KEY / GLM_API_KEY）。
 *   providers.json 位于数据目录（DATA_DIR/providers.json），仅存本机，不随包分发。
 *
 * 用户配置（providers.json）可按 key 覆盖内置服务商的 baseUrl / apiKey / modelPrefixes，
 * 也可新增自定义服务商（任意 OpenAI 兼容网关）。TARGET_URL 环境变量仍然覆盖 stepfun 的
 * baseUrl（v1.5.5 之前的用法保持有效）。
 */
import fs from 'node:fs';
import path from 'node:path';

/* ==================== 内置服务商 ==================== */
/** baseUrl 均为官方 OpenAI 兼容端点（客户端在其后拼 /chat/completions 等路径） */
export const BUILTIN_PROVIDERS = [
  { key: 'stepfun',  name: 'StepFun 阶跃星辰', nameEn: 'StepFun',       baseUrl: 'https://api.stepfun.com',                          envKeys: ['STEPFUN_API_KEY'],                     modelPrefixes: ['step-'] },
  { key: 'glm',      name: '智谱 GLM',         nameEn: 'Zhipu GLM',     baseUrl: 'https://open.bigmodel.cn/api/paas/v4',             envKeys: ['GLM_API_KEY', 'BIGMODEL_API_KEY'],     modelPrefixes: ['glm-', 'chatglm'] },
  { key: 'deepseek', name: 'DeepSeek',         nameEn: 'DeepSeek',      baseUrl: 'https://api.deepseek.com',                          envKeys: ['DEEPSEEK_API_KEY'],                    modelPrefixes: ['deepseek-'] },
  { key: 'kimi',     name: 'Kimi Moonshot',    nameEn: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1',                     envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],    modelPrefixes: ['moonshot-', 'kimi-'] },
  { key: 'minimax',  name: 'MiniMax',          nameEn: 'MiniMax',       baseUrl: 'https://api.minimaxi.com/v1',                      envKeys: ['MINIMAX_API_KEY'],                     modelPrefixes: ['minimax-', 'abab'] },
  { key: 'qwen',     name: '通义千问 Qwen',    nameEn: 'Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKeys: ['DASHSCOPE_API_KEY'],                modelPrefixes: ['qwen-', 'qwq-', 'qvq-'] },
  { key: 'yi',       name: '零一万物 Yi',      nameEn: 'Yi (01.AI)',    baseUrl: 'https://api.lingyiwanwu.com/v1',                    envKeys: ['YI_API_KEY', 'LINGYIWANWU_API_KEY'],   modelPrefixes: ['yi-'] },
];
const BUILTIN_MAP = new Map(BUILTIN_PROVIDERS.map((p) => [p.key, p]));
const DEFAULT_KEY = 'stepfun';
const PATH_PREFIX_RE = /^\/p\/([a-z0-9_-]{1,32})(\/.*)?$/i;

/** key 规范化：小写、去空白、限长 */
function normKey(s) {
  const k = String(s == null ? '' : s).trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(k) ? k : '';
}

/** stepfun 的 baseUrl 允许被 TARGET_URL 覆盖（兼容 v1.5.5 之前的单服务商用法与全部旧测试） */
function builtinBaseUrl(key) {
  if (key === DEFAULT_KEY && process.env.TARGET_URL && /^https?:\/\//i.test(process.env.TARGET_URL)) {
    return process.env.TARGET_URL.replace(/\/+$/, '');
  }
  return BUILTIN_MAP.get(key).baseUrl;
}

function toUrl(baseUrl) {
  try { return new URL(baseUrl); } catch { return null; }
}

/**
 * 加载服务商状态（进程启动时一次；激活项变更时写回 providers.json）
 * @param {string} dataDir 数据目录（与 usage.jsonl 同目录）
 */
export function loadProviderState(dataDir) {
  const file = path.join(dataDir, 'providers.json');
  const providers = new Map();
  for (const p of BUILTIN_PROVIDERS) {
    providers.set(p.key, { ...p, baseUrl: builtinBaseUrl(p.key), apiKey: '', builtin: true, target: toUrl(builtinBaseUrl(p.key)) });
  }
  let active = DEFAULT_KEY;
  let rawProviders = [];
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 无配置文件：纯内置 */ }
  if (raw && Array.isArray(raw.providers)) {
    rawProviders = raw.providers;
    for (const u of rawProviders) {
      const key = normKey(u && u.key);
      if (!key) continue;
      const base = providers.get(key) || {};
      const baseUrl = typeof u.baseUrl === 'string' && /^https?:\/\//i.test(u.baseUrl)
        ? u.baseUrl.replace(/\/+$/, '')
        : (key === DEFAULT_KEY && base.baseUrl) || base.baseUrl || '';
      const url = toUrl(baseUrl);
      if (!url) continue;                                    // 无效 baseUrl 的条目跳过（不影响其他服务商）
      const envKeys = Array.isArray(u.envKeys) && u.envKeys.length ? u.envKeys.map((s) => String(s)).filter(Boolean) : (base.envKeys || []);
      const modelPrefixes = Array.isArray(u.modelPrefixes)
        ? u.modelPrefixes.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
        : (base.modelPrefixes || []);
      providers.set(key, {
        key,
        name: typeof u.name === 'string' && u.name.trim() ? u.name.trim().slice(0, 40) : (base.name || key),
        nameEn: typeof u.nameEn === 'string' && u.nameEn.trim() ? u.nameEn.trim().slice(0, 40) : (base.nameEn || base.name || key),
        baseUrl, apiKey: typeof u.apiKey === 'string' ? u.apiKey : '',
        envKeys, modelPrefixes, builtin: BUILTIN_MAP.has(key), target: url,
      });
    }
  }
  if (raw && typeof raw.active === 'string') {
    const k = normKey(raw.active);
    if (k && providers.has(k)) active = k;
  }

  const state = {
    dataDir, file, providers, active, rawProviders,
    /** 全部 key（错误提示用） */
    keys() { return [...providers.keys()]; },
    /** 当前激活 key */
    activeKey() { return active; },
    /** 当前激活服务商对象 */
    activeProvider() { return providers.get(active) || providers.get(DEFAULT_KEY); },
    /**
     * 路由解析。返回 { provider, target, forwardPath, source }；
     * 路径前缀 / X-Provider 指定了未知 key 时返回 { error, valid }。
     * @param {string} url 原始 url（含查询串）
     * @param {string} pathname 已去查询串的路径
     * @param {object} headers 请求头
     * @param {string} model 请求体中的模型名（可空；空则跳过模型名前缀匹配）
     */
    resolve(url, pathname, headers, model) {
      const pn = pathname || url;
      // 1) 路径前缀 /p/<key>/...
      const m = PATH_PREFIX_RE.exec(pn);
      if (m) {
        const key = normKey(m[1]);
        const p = providers.get(key);
        if (!p) return { error: `未知服务商: ${key}`, valid: state.keys() };
        const rest = (m[2] || '/') + url.slice(pn.length);       // 保留查询串
        return { provider: p, target: p.target, forwardPath: rest, source: 'path' };
      }
      // 2) X-Provider 请求头
      const hv = headers && (headers['x-provider'] || headers['X-Provider']);
      if (hv != null && String(hv).trim()) {
        const key = normKey(hv);
        const p = providers.get(key);
        if (!p) return { error: `未知服务商(X-Provider): ${key}`, valid: state.keys() };
        return { provider: p, target: p.target, forwardPath: url, source: 'header' };
      }
      // 3) 模型名前缀
      if (model) {
        const ml = String(model).toLowerCase();
        for (const p of providers.values()) {
          for (const pre of p.modelPrefixes || []) {
            if (pre && ml.startsWith(pre)) return { provider: p, target: p.target, forwardPath: url, source: 'model' };
          }
        }
      }
      // 4) 激活默认
      const p = state.activeProvider();
      return { provider: p, target: p.target, forwardPath: url, source: 'active' };
    },
    /** 切换激活服务商并持久化；成功返回 true */
    setActive(key) {
      const k = normKey(key);
      if (!k || !providers.has(k)) return false;
      active = k;
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ active, providers: rawProviders }, null, 2));
        fs.renameSync(tmp, file);
      } catch { /* 持久化失败不影响本次切换（内存态已生效） */ }
      return true;
    },
    /** 给 /api/providers 与仪表盘使用（绝不包含 apiKey） */
    publicInfo() {
      return {
        active,
        providers: [...providers.values()].map((p) => ({
          key: p.key, name: p.name, nameEn: p.nameEn, baseUrl: p.baseUrl,
          builtin: !!p.builtin, hasKey: !!providerKeyFor(p), modelPrefixes: p.modelPrefixes || [],
        })),
      };
    },
  };
  return state;
}

/** 取服务商密钥：providers.json apiKey > 环境变量（按 envKeys 顺序取第一个非空） */
export function providerKeyFor(p) {
  if (!p) return '';
  if (p.apiKey) return p.apiKey;
  for (const k of p.envKeys || []) {
    const v = process.env[k];
    if (v) return v;
  }
  return '';
}
