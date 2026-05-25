/**
 * lib/script-drafts (v2.15 G9)
 *
 * 用一个 idea 并行生成 1-3 个剧本草稿(温度差), 让用户对比后再选一版走完整 pipeline。
 *
 * 设计取舍:
 *   - 不调 orchestrator (避免有状态干扰: agentTalk/event/项目持久化等), 纯函数 LLM 调用
 *   - 复用 lib/mckee-skill 的 McKee writer prompt → 草稿质量与 runWriter 一致
 *   - N=1 时 temperature=0.7 (与 runWriter 默认一致, 等同"快草稿"); N=2/3 时分别加 0.95/1.2
 *     使第 2/3 版有显著差异(更激进的题材选择 / 更冒险的转场)
 *   - 单次失败不阻塞其他: Promise.allSettled, 失败的草稿返回 errorMessage 字段, UI 可显示"该版生成失败"
 *
 * 跟 runWriter 的差异 (清楚标注):
 *   - 不跑 Two-Pass(规划 + 格式化), 单次出 JSON; 时间快 50% 但 act 配比可能略弱
 *   - 不带 Voice Fingerprints / Budget Plan / 上版评分反馈
 *   - 不带 parsedScript 适配模式
 *
 * 用户决定 "采用此版" 后, 调用方应当把 chosenDraft.idea 透回 /api/create-stream
 * 走完整 runWriter (拿到带 Voice/Budget 的高质量版本)。
 */

import { API_CONFIG } from './config';
import { callLLMWithFallback } from './llm-client';
import { getMcKeeWriterPrompt } from './mckee-skill';
import { robustJsonParse } from './polish-json';
import type { Script, ScriptShot } from '@/types/agents';

export interface ScriptDraftRequest {
  idea: string;
  /** 用户选定画风, 透传到 prompt 作上下文 */
  style?: string;
  /** 1-3, 超出范围 clamp */
  count: number;
  /** 上层取消 */
  signal?: AbortSignal;
}

export interface ScriptDraft {
  /** 客户端用来 reference 的临时 id, 不是 DB id */
  draftId: string;
  /** 这个草稿用的温度 (展示给用户参考"风格激进度") */
  temperatureUsed: number;
  /** 用户原始 style (用作回到 create-stream 时的种子) */
  styleUsed: string;
  /** 成功时的 Script payload */
  script?: Script;
  /** 失败时的错误消息, 供 UI 显示 "该版生成失败" */
  errorMessage?: string;
  /** 估算字数 (UI 卡片"轻量 / 紧凑 / 厚重"标签用) */
  estimatedWords?: number;
}

const TEMPERATURE_LADDER = [0.7, 0.95, 1.2] as const;

/**
 * 生成 N 个剧本草稿。N=1 等价单次 LLM 调用; N=2/3 用阶梯温度。
 * 返回数组始终长度 = clamped count, 失败的草稿带 errorMessage。
 */
export async function generateScriptDrafts(
  req: ScriptDraftRequest,
): Promise<ScriptDraft[]> {
  const idea = (req.idea || '').trim();
  if (!idea) throw new Error('idea 不能为空');
  if (idea.length < 5) throw new Error('idea 至少 5 个字符');

  const count = Math.max(1, Math.min(3, Math.floor(req.count || 1)));
  const style = (req.style || '').trim() || 'cinematic';

  if (!API_CONFIG.openai.apiKey) {
    throw new Error('OPENAI_API_KEY 未配置, 无法生成草稿');
  }

  const tempLadder = TEMPERATURE_LADDER.slice(0, count);

  const tasks = tempLadder.map((temperature, i) =>
    generateOneDraft({
      idea,
      style,
      temperature,
      draftIndex: i,
      signal: req.signal,
    }),
  );

  const settled = await Promise.allSettled(tasks);

  return settled.map((r, i): ScriptDraft => {
    const base = {
      draftId: `draft-${Date.now()}-${i}`,
      temperatureUsed: tempLadder[i],
      styleUsed: style,
    };
    if (r.status === 'fulfilled') {
      const script = r.value;
      return {
        ...base,
        script,
        estimatedWords: estimateWords(script),
      };
    }
    return {
      ...base,
      errorMessage: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/** 单次草稿调用 — 不并发, 不重试, 失败抛给上层 Promise.allSettled */
async function generateOneDraft(opts: {
  idea: string;
  style: string;
  temperature: number;
  draftIndex: number;
  signal?: AbortSignal;
}): Promise<Script> {
  // 简化版 system prompt — McKee 框架 + 一次出 JSON (跳过 Two-Pass 规划阶段)
  const systemPrompt =
    getMcKeeWriterPrompt('', opts.style, {
      isScriptAdaptation: false,
      directorTotalShots: 6,
      minShots: 4,
      maxShots: 8,
    }) +
    `\n\n## 草稿模式特别约定\n` +
    `这是用户对比草稿生成调用 (草稿 #${opts.draftIndex + 1}, 温度 ${opts.temperature})。\n` +
    `输出严格 JSON, 形如 { "title": string, "synopsis": string (1-2 句), "shots": [...] }。\n` +
    `不要在 JSON 前后加任何解释文本, 不要 \`\`\`json fence。\n` +
    `每个 shot 必须含: shotNumber (1-based), sceneDescription, action, emotion, characters[], dialogue (可选), visualPrompt。`;

  const userMessage =
    `创意:${opts.idea}\n\n` +
    `画风:${opts.style}\n\n` +
    `输出长度: 4-8 个镜头的短剧, JSON 格式直出, 不要 markdown 包裹。`;

  // v7.1: 草稿对比 = "快速比稿"场景, 用创意"快档" deepseek-v4-flash (推理 token 远少于 pro,
  //   实测单稿 12-20s 且稳定出 JSON; pro 单稿 35-60s 且 reasoning 易吃光 token 预算导致空响应)。
  //   质量优先的完整管线 runWriter 仍用 pro。75s 超时覆盖长尾, 主→MiniMax 全局兜底, 内置 <think> 剥离。
  //   解析/校验失败再重试 1 次 (HA: flash 快, 重试代价低); 链路彻底失败 (超时/全挂) 不重试以控总时长。
  let lastErr = '草稿生成失败';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callLLMWithFallback({
      system: systemPrompt,
      user: userMessage,
      useCreative: true,
      fast: true,
      temperature: opts.temperature,
      jsonMode: true,
      // McKee 编剧提示 (9KB) 产出较丰富 (实测 ~11000 字 ≈ 5000 token); 给到 8000 防止截断,
      // 截断会导致 JSON 解析失败→触发重试→时长翻倍。8000 留足头部余量, 首试即过的概率更高。
      maxTokens: 8000,
      // flash 正常 50-70s (McKee 提示重); 100s 给"flash过载重试 + MiniMax 兜底(推理模型 40-90s)"留余量,
      // 避免兜底腿必然超时 (并行 2-3 稿仍 < route maxDuration 240)
      timeoutMs: 100_000,
    });
    if (!res.ok || !res.content) {
      lastErr = res.error || 'LLM 返回空';
      break; // 主+兜底都失败 (多为超时/欠费), 重试无益
    }

    const parsed = robustJsonParse(res.content);
    const obj = parsed as any;
    if (!parsed || typeof parsed !== 'object') {
      lastErr = 'LLM 输出无法解析为 JSON';
      continue; // 拿到内容但非 JSON → 重试一次
    }
    if (!obj.title || !Array.isArray(obj.shots) || obj.shots.length === 0) {
      lastErr = 'LLM 输出缺 title 或 shots[]';
      continue; // 结构不完整 → 重试一次
    }

    return {
      title: String(obj.title).slice(0, 80),
      synopsis: String(obj.synopsis || '').slice(0, 500),
      shots: normalizeShots(obj.shots),
    };
  }
  throw new Error(lastErr);
}

function normalizeShots(raw: any[]): ScriptShot[] {
  return raw
    .filter((s) => s && typeof s === 'object')
    .slice(0, 12)
    .map((s, i): ScriptShot => ({
      shotNumber: typeof s.shotNumber === 'number' ? s.shotNumber : i + 1,
      sceneDescription: String(s.sceneDescription || '').slice(0, 300),
      action: String(s.action || '').slice(0, 300),
      emotion: String(s.emotion || '').slice(0, 60),
      characters: Array.isArray(s.characters)
        ? s.characters.filter((c: any) => typeof c === 'string').slice(0, 6)
        : [],
      dialogue: s.dialogue ? String(s.dialogue).slice(0, 200) : undefined,
      visualPrompt: s.visualPrompt ? String(s.visualPrompt).slice(0, 400) : undefined,
    }));
}

function estimateWords(script: Script): number {
  let n = (script.synopsis || '').length;
  for (const sh of script.shots || []) {
    n += (sh.action || '').length;
    n += (sh.dialogue || '').length;
    n += (sh.sceneDescription || '').length;
  }
  return n;
}
