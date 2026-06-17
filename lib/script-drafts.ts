/**
 * lib/script-drafts (v2.15 G9)
 *
 * 用一个 idea 并行生成 1-3 个剧本草稿(温度差), 让用户对比后再选一版走完整 pipeline。
 *
 * 设计取舍:
 *   - 不调 orchestrator (避免有状态干扰: agentTalk/event/项目持久化等), 纯函数 LLM 调用
 *   - v9.2.2: 用 lib/slim-prompts 精简编剧提示 (~0.5KB) 替代完整 McKee (8.9KB) → flash 单稿 <20s
 *     (此前直挂 9KB McKee, flash 推理负担重 ~50-70s)。骨架 (三幕/钩子/反转/悬念) + JSON 契约保留
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
import { getSlimWriterPrompt } from './slim-prompts';
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
  // v9.2.2: 精简编剧 system prompt (~0.5KB) 替代完整 McKee (8.9KB) —— flash 推理负担骤降,
  //   单稿目标 <20s (此前 McKee 重提示 ~50-70s)。三幕骨架 (钩子/反转/悬念) + 严格 JSON 契约保留;
  //   完整 McKee 仍由质量优先的主管线 runWriter 承担 (用户选定草稿后回到 create-stream)。
  const systemPrompt = getSlimWriterPrompt(opts.style, {
    minShots: 4,
    maxShots: 8,
    note: `草稿 #${opts.draftIndex + 1} · 温度 ${opts.temperature}`,
  });

  const userMessage =
    `创意:${opts.idea}\n\n` +
    `画风:${opts.style}\n\n` +
    `输出长度: 4-8 个镜头的短剧, JSON 格式直出, 不要 markdown 包裹。`;

  // v7.1/v9.2.2: 草稿对比 = "快速比稿"场景, 用创意"快档" deepseek-v4-flash + 精简提示 (见上)。
  //   推理 token 远少于 pro, 配精简提示后单稿目标 <20s 且稳定出 JSON;
  //   质量优先的完整管线 runWriter 仍用 pro + 完整 McKee。主→MiniMax 全局兜底, 内置 <think> 剥离。
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
      // 草稿 = 短剧 4-8 镜, 输出 ~2-3000 token; 6000 留足头部余量防截断 (截断→JSON 解析失败→重试翻倍)。
      maxTokens: 6000,
      // v12.x: 创意快档可能配 Claude(sonnet/haiku,经 qingyuntop 比 deepseek-flash 慢)→ 45s 太紧,
      // 实测 3 稿并行常 2/3 超时。放宽到 90s/尝试(主+兜底最坏 180s,3 稿并行仍 < route maxDuration 240)。
      timeoutMs: 90_000,
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
