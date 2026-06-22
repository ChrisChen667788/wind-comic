/**
 * lib/model-scan (v10.6.3 模型雷达) — 一键扫描各 API 支持的最新模型 + 同家族自动升级建议。
 *
 * 思路:本项目的引擎栈大半走 OpenAI 兼容端点(DeepSeek / MiniMax / 主网关 / XVERSE-vLLM)
 * 或聚合网关(qingyuntop 管 Veo/Sora/Vidu、vectorengine 管 Kling/MJ/TTS),它们都有
 * `GET /v1/models` —— 扫描 = 拉清单,与当前配置(env 覆盖 + 代码默认)做同家族比对。
 *
 * 自动升级四道护栏:
 *   1. 只在**同家族**内升(deepseek→deepseek、veo→veo、Sonnet 档→Sonnet 档),绝不跨厂商/跨档
 *   2. 档位不降:flash 快档锁档位(keepTier),pro 主档只升不降
 *   3. LLM 候选先 1-token 实测,过了才采用;视频模型无法廉价实测 → 标注「列表确认,
 *      首发时验证」(失败由既有 fallbackModels 链自愈)
 *   4. 每次采用留旧值(model_overrides.prev_value),一键回滚
 *
 * 无列举接口的(fal/FLUX 路径制、本地 ComfyUI、Sync.so 直连)如实标 unscannable。
 * 排序是确定性启发式(版本号向量 + 档位权重),纯函数可单测;不联网部分零副作用。
 */

// ─── 版本/档位排序(纯函数) ────────────────────────────────────────────────

/** 档位权重:pro/max/ultra 主档 3,turbo/plus/hd 中档 2,flash/lite/mini 快档 1,无标记 2。 */
export function tierWeight(id: string): number {
  const s = id.toLowerCase();
  if (/(^|[-_.])(pro|max|ultra)([-_.]|$)/.test(s)) return 3;
  if (/(^|[-_.])(turbo|plus|hd)([-_.]|$)/.test(s)) return 2;
  if (/(^|[-_.])(flash|lite|mini|fast)([-_.]|$)/.test(s)) return 1;
  return 2;
}

/** 提取版本号向量:'veo3.1-pro'→[3,1],'claude-sonnet-4-6'→[4,6],'MiniMax-M2.7'→[2,7]。 */
export function versionVector(id: string): number[] {
  const nums = id.match(/\d+(?:\.\d+)*/g) || [];
  const v: number[] = [];
  for (const n of nums) for (const part of n.split('.')) v.push(parseInt(part, 10));
  return v;
}

/** 版本向量字典序比较(短向量补 0):a>b 返回 1。 */
export function compareVersions(a: number[], b: number[]): -1 | 0 | 1 {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 从候选清单挑出比 current 更新更强的同档模型;没有更优的返回 null。
 * keepTier:锁档位(快档专用 —— flash 升 flash,绝不升成 pro 拖慢快车道)。
 */
export function pickBest(current: string, candidates: string[], opts?: { keepTier?: boolean }): string | null {
  const curV = versionVector(current);
  const curT = tierWeight(current);
  let best: string | null = null;
  for (const c of candidates) {
    if (c === current) continue;
    const t = tierWeight(c);
    if (opts?.keepTier ? t !== curT : t < curT) continue; // 档位不降
    const cmp = compareVersions(versionVector(c), curV);
    if (cmp < 0) continue; // 版本不倒退
    if (cmp === 0 && t <= curT) continue; // 同版本只接受档位更高
    if (best === null) { best = c; continue; }
    const cmpBest = compareVersions(versionVector(c), versionVector(best));
    if (cmpBest > 0 || (cmpBest === 0 && t > tierWeight(best))) best = c;
  }
  return best;
}

// ─── 扫描目标(模块 × 家族 × 清单来源) ─────────────────────────────────────

export type ScanSource = 'primary' | 'creative' | 'fallback' | 'xverse' | 'qingyuntop' | 'vectorengine';

export interface ModuleTarget {
  module: string;
  label: string;
  envKey: string;
  /** 代码默认值(与 lib/config.ts 一致) */
  defaultModel: string;
  /** 同家族判定 —— 候选必须命中才参与升级 */
  family: RegExp;
  source: ScanSource;
  /** 快档锁档位 */
  keepTier?: boolean;
  /** 升级前可用 1-token 实测(仅 chat LLM) */
  verifiable?: boolean;
}

export const MODULE_TARGETS: ModuleTarget[] = [
  // 通用高质量档:按用户决策锁 Sonnet 档(不自动跳 Opus —— 成本档位是产品决策)
  { module: 'primary-llm', label: '通用 LLM(Claude Sonnet 档)', envKey: 'OPENAI_MODEL', defaultModel: 'claude-sonnet-4-6', family: /^claude-sonnet-/i, source: 'primary', verifiable: true },
  { module: 'creative-llm', label: '创意主 LLM(DeepSeek)', envKey: 'OPENAI_CREATIVE_MODEL', defaultModel: 'deepseek-v4-pro', family: /^deepseek-/i, source: 'creative', verifiable: true },
  { module: 'creative-fast-llm', label: '创意快档 LLM(DeepSeek flash)', envKey: 'OPENAI_CREATIVE_FAST_MODEL', defaultModel: 'deepseek-v4-flash', family: /^deepseek-/i, source: 'creative', keepTier: true, verifiable: true },
  { module: 'llm-fallback', label: '通用回退(MiniMax M 系)', envKey: 'LLM_FALLBACK_MODEL', defaultModel: 'MiniMax-M2.7', family: /^minimax-m\d/i, source: 'fallback', verifiable: true }, // \d 防 Music/MCP 系误入
  { module: 'xverse', label: '自托管编剧(XVERSE-Ent)', envKey: 'XVERSE_MODEL', defaultModel: 'xverse/XVERSE-Ent-A5.7B', family: /^xverse\//i, source: 'xverse', verifiable: true },
  { module: 'video-veo', label: '视频(Veo,qingyuntop 网关)', envKey: 'VEO_MODEL', defaultModel: 'veo3.1-pro', family: /^veo/i, source: 'qingyuntop' },
  { module: 'tts-minimax', label: '配音兜底(MiniMax speech)', envKey: 'MINIMAX_TTS_MODEL', defaultModel: 'speech-02-hd', family: /^speech-/i, source: 'fallback' },
];

/** 无列举接口的模块 —— 如实标注,不假装能扫。 */
export const UNSCANNABLE_NOTES: Array<{ module: string; label: string; why: string }> = [
  { module: 'image-fal-flux', label: '图像 · fal / FLUX Kontext', why: '模型在请求路径里,无 /models 列举接口 — 升级走代码默认值' },
  { module: 'image-comfyui', label: '图像 · 本地 ComfyUI', why: '本地工作流,模型由 workflow 文件决定' },
  { module: 'lipsync-direct', label: '口型 · Sync.so / Hailuo 直连', why: '无列举接口;Kling 口型经 vectorengine 网关已覆盖' },
  // v12.29.0:前沿引擎前沿对齐后纳入雷达视野(均 BYO,无 /models 列举,升级走代码默认值/req_key)。
  { module: 'video-grok', label: '视频 · xAI Grok Imagine 1.5(BYO)', why: '模型在请求体(GROK_VIDEO_MODEL),无 /models 列举 — 升级走代码默认值' },
  { module: 'video-seedance', label: '视频 · ByteDance Seedance 2.0(火山 CV,BYO)', why: 'req_key 制(jimeng_vgfm_*),非版本号清单 — 升级改 REQ_KEY_MAP' },
  { module: 'video-ltx', label: '视频 · LTX-2.3(Lightricks 开源/自托管,BYO)', why: '模型在 fal 路径(LTX_MODEL),无 /models 列举 — 升级走代码默认值' },
];

// ─── 扫描执行 ────────────────────────────────────────────────────────────────

export interface SourceSpec { baseUrl: string; key?: string }

/** 各清单来源的 baseURL/key 解析(与 health/providers 同一套 env 回退链)。 */
export function resolveSources(): Record<ScanSource, SourceSpec> {
  const veBase = process.env.VECTORENGINE_BASE_URL || process.env.KELING_BASE_URL || 'https://api.vectorengine.ai';
  const veKey = process.env.VECTORENGINE_API_KEY || process.env.KELING_API_KEY || process.env.VEO_API_KEY;
  return {
    primary: { baseUrl: process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1', key: process.env.OPENAI_API_KEY },
    creative: {
      baseUrl: process.env.CREATIVE_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
      key: process.env.DEEPSEEK_API_KEY || process.env.CREATIVE_API_KEY || process.env.OPENAI_API_KEY,
    },
    fallback: { baseUrl: process.env.LLM_FALLBACK_BASE_URL || 'https://api.minimaxi.com/v1', key: process.env.LLM_FALLBACK_API_KEY || process.env.MINIMAX_API_KEY },
    xverse: { baseUrl: process.env.XVERSE_BASE_URL || 'http://localhost:8000/v1', key: process.env.XVERSE_API_KEY },
    qingyuntop: { baseUrl: (process.env.QINGYUNTOP_BASE_URL || 'https://api.qingyuntop.top') + '/v1', key: process.env.QINGYUNTOP_API_KEY || process.env.VEO_API_KEY },
    vectorengine: { baseUrl: veBase + '/v1', key: veKey },
  };
}

function isPlaceholderKey(key?: string): boolean {
  return !key || key.startsWith('your_') || key.length < 8;
}

export type ListModelsFetcher = (source: ScanSource, spec: SourceSpec) => Promise<string[] | null>;

/** 默认抓取器:GET {base}/models(OpenAI 兼容),10s 超时;失败返回 null(来源不可用)。 */
export const fetchModelList: ListModelsFetcher = async (_source, spec) => {
  if (isPlaceholderKey(spec.key)) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`${spec.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${spec.key}` },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const data = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    const ids = data.map((m: any) => (typeof m === 'string' ? m : m?.id)).filter((x: any) => typeof x === 'string');
    return ids.length ? ids : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

export interface ModuleScanResult {
  module: string;
  label: string;
  envKey: string;
  current: string;
  /** 同家族候选数(来源清单 ∩ 家族) */
  familyCandidates: number;
  /** 建议升级到(null = 已是最新最强 / 来源不可用) */
  latest: string | null;
  status: 'upgrade' | 'up-to-date' | 'source-unavailable';
  /** 采用方式说明(LLM=已实测 / 视频=列表确认) */
  note?: string;
}

export interface ModelScanReport {
  scannedAt: string;
  results: ModuleScanResult[];
  unscannable: typeof UNSCANNABLE_NOTES;
}

/** 全模块扫描(fetcher 可注入 —— 单测喂假清单,生产用 fetchModelList)。 */
export async function scanLatestModels(fetcher: ListModelsFetcher = fetchModelList): Promise<ModelScanReport> {
  const sources = resolveSources();
  // 同一来源只拉一次
  const listings = new Map<ScanSource, string[] | null>();
  const needed = Array.from(new Set(MODULE_TARGETS.map((t) => t.source)));
  await Promise.all(needed.map(async (s) => {
    listings.set(s, await fetcher(s, sources[s]));
  }));

  const results: ModuleScanResult[] = MODULE_TARGETS.map((t) => {
    const current = process.env[t.envKey] || t.defaultModel;
    const list = listings.get(t.source);
    if (!list) {
      return { module: t.module, label: t.label, envKey: t.envKey, current, familyCandidates: 0, latest: null, status: 'source-unavailable' as const, note: '来源不可用(未配 key 或网关无响应)' };
    }
    const family = list.filter((id) => t.family.test(id));
    const best = pickBest(current, family, { keepTier: t.keepTier });
    return {
      module: t.module, label: t.label, envKey: t.envKey, current,
      familyCandidates: family.length,
      latest: best,
      status: best ? ('upgrade' as const) : ('up-to-date' as const),
      note: best ? (t.verifiable ? '采用前 1-token 实测' : '列表确认 — 首发时验证,失败走 fallback 链') : undefined,
    };
  });

  return { scannedAt: new Date().toISOString(), results, unscannable: UNSCANNABLE_NOTES };
}

/** chat LLM 候选 1-token 实测(升级护栏 3)。非 chat 模块不调用。 */
export async function verifyChatModel(source: ScanSource, model: string): Promise<boolean> {
  const spec = resolveSources()[source];
  if (isPlaceholderKey(spec.key)) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${spec.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spec.key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: ctl.signal,
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    // MiniMax 风格 base_resp 错误码也算失败
    if (j?.base_resp && j.base_resp.status_code !== 0) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
