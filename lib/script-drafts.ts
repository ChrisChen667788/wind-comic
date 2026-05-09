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

import OpenAI from 'openai';
import { API_CONFIG } from './config';
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
  const openai = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

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

  // 60s 超时, 草稿不应等太久 — runWriter Two-Pass 需要 90-120s, 我们 60s 足够单次
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const completion = await openai.chat.completions.create(
      {
        model: API_CONFIG.openai.model,
        temperature: opts.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal },
    );

    const text = completion.choices[0]?.message?.content || '';
    if (!text) throw new Error('LLM 返回空');

    const parsed = robustJsonParse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('LLM 输出无法解析为 JSON');
    }
    const obj = parsed as any;
    if (!obj.title || !Array.isArray(obj.shots) || obj.shots.length === 0) {
      throw new Error('LLM 输出缺 title 或 shots[]');
    }

    return {
      title: String(obj.title).slice(0, 80),
      synopsis: String(obj.synopsis || '').slice(0, 500),
      shots: normalizeShots(obj.shots),
    };
  } finally {
    clearTimeout(timer);
  }
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
