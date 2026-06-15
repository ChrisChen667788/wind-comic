/**
 * POST /api/polish-script
 *
 * 剧本润色 — v2.11 独立模块。
 *
 * 诉求:用户不一定每次都要走完整 Agent 管线,很多时候手里已经有一段剧本/故事大纲,
 * 只想让 LLM 在保留原意 + 角色/结构不变的前提下,把文字打磨得更好读、更有画面感、
 * 或切换某种风格(文艺/商业/悬疑/喜剧/纪实)。
 *
 * 两档模式 (v2.11 #5 行业级升级):
 *   basic → 快而便宜, 只出 polished + summary + notes
 *   pro   → 行业级, 额外出一份 audit (Hook / 三幕 / 对白 / 角色锚 /
 *           场景光影 / AIGC 就绪度), 作为整条管线的"写作质量 QA"
 *
 * 入参:
 *   {
 *     script: string,              // 原文(必需, 支持 plain text / 分镜格式)
 *     mode?: 'basic' | 'pro',      // 默认 basic
 *     style?: 'literary'|'commercial'|'thriller'|'comedy'|'documentary'|'poetic',
 *     intensity?: 'light'|'moderate'|'heavy',
 *     focus?: string,
 *   }
 *
 * 出参(basic):
 *   { polished, summary, notes[], elapsedMs, model, mode: 'basic' }
 *
 * 出参(pro):
 *   { polished, summary, notes[], audit: {...}, elapsedMs, model, mode: 'pro' }
 */

import { NextRequest } from 'next/server';
import { API_CONFIG } from '@/lib/config';
import { robustJsonParse, stripJsonWrapper } from '@/lib/polish-json';
import { buildPolishPrompt, type PolishMode } from '@/lib/polish-prompts';
import { stripThink, isTransientLLMError } from '@/lib/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: any = {};
  try { body = await request.json(); } catch {}

  const rawScript = typeof body?.script === 'string' ? body.script.trim() : '';
  if (!rawScript) {
    return Response.json({ error: '请提供 script 字段(string)' }, { status: 400 });
  }
  if (rawScript.length > 32000) {
    return Response.json({ error: '剧本过长 (>32000 字符), 请分段润色' }, { status: 413 });
  }

  // v2.13.4: 安全闸门 — 剧本本身允许冲突/亲密(影视化叙事),只挡注入 + 真实有害 + PII
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const scriptVerdict = checkAndSanitize(rawScript, { task: 'polish-req' });  // task=polish-req 跳过 out-of-scope 检测
  if (!scriptVerdict.ok) {
    console.warn(`[polish-script] guardrail blocked script: ${scriptVerdict.category}/${scriptVerdict.reason}`);
    return Response.json({ error: scriptVerdict.userMessage, category: scriptVerdict.category }, { status: 400 });
  }
  const script = scriptVerdict.sanitized;

  const mode: PolishMode = body?.mode === 'pro' ? 'pro' : 'basic';
  // v12.2.9 计费 gate:Polish Pro 走 deepseek-v4-pro 行业级体检(贵),锁 pro 档;
  // 免费/creator 用户仍可用 basic(快档)。商业化必做,堵免费用户烧高单价 API。
  if (mode === 'pro') {
    const { checkPlan, planRejection } = await import('@/lib/plan-gate');
    const gate = checkPlan(request, 'pro');
    if (!gate.ok) {
      console.warn(`[polish-script] plan-gate blocked pro: user=${gate.userId} tier=${gate.current}`);
      return planRejection(gate.current, gate.required);
    }
  }
  const style = typeof body?.style === 'string' ? body.style : undefined;
  const intensity = typeof body?.intensity === 'string' ? body.intensity : 'moderate';

  // v2.13.4: focus(用户特别要求)也走 guardrail + enhancement
  const rawFocus = typeof body?.focus === 'string' ? body.focus.slice(0, 300) : '';
  let focus: string | undefined = undefined;
  if (rawFocus) {
    const focusVerdict = checkAndSanitize(rawFocus, { task: 'polish-req', allowEmpty: true });
    if (!focusVerdict.ok) {
      console.warn(`[polish-script] guardrail blocked focus: ${focusVerdict.category}/${focusVerdict.reason}`);
      return Response.json({ error: '"特别要求" 字段:' + focusVerdict.userMessage, category: focusVerdict.category }, { status: 400 });
    }
    if (focusVerdict.sanitized) {
      const { enhancePolishRequirement } = await import('@/lib/prompt-templates');
      focus = enhancePolishRequirement(focusVerdict.sanitized) || focusVerdict.sanitized;
    }
  }

  // v7.0.3: 润色走 创意主 LLM (DeepSeek) + MiniMax 全局兜底, 与 orchestrator 一致.
  //   关键修复: 之前用 creativeModel 却发去通用 baseURL/apiKey (qingyuntop), 模型↔网关不匹配 → 报错.
  // v7.1: 按档分模型 —— basic("快而便宜") 走快档 deepseek-v4-flash (秒级, 推理少);
  //   pro("行业级") 走 deepseek-v4-pro (质量优先)。二者同属 DeepSeek v4 最新一族, 均兜底 MiniMax.
  const cfg = API_CONFIG.openai as any;
  const usePolishFast = mode !== 'pro';
  const llmAttempts: Array<{ baseURL: string; apiKey: string; model: string; label: string }> = [];
  const primaryLLM = {
    baseURL: cfg.creativeBaseURL || cfg.baseURL,
    apiKey: cfg.creativeApiKey || cfg.apiKey,
    model: usePolishFast ? (cfg.creativeFastModel || cfg.creativeModel || cfg.model) : (cfg.creativeModel || cfg.model),
    label: usePolishFast ? '创意·DeepSeek快' : '创意·DeepSeek',
  };
  if (primaryLLM.apiKey) llmAttempts.push(primaryLLM);
  if (cfg.fallbackApiKey && (cfg.fallbackApiKey !== primaryLLM.apiKey || cfg.fallbackModel !== primaryLLM.model)) {
    llmAttempts.push({ baseURL: cfg.fallbackBaseURL, apiKey: cfg.fallbackApiKey, model: cfg.fallbackModel, label: 'MiniMax兜底' });
  }
  if (llmAttempts.length === 0) {
    return Response.json({ error: 'LLM 未配置 (DEEPSEEK_API_KEY / OPENAI_API_KEY 均缺), 润色暂不可用' }, { status: 503 });
  }

  const systemPrompt = buildPolishPrompt({ mode, style, intensity, focus });

  // Pro 模式: 更低温度 (行业诊断要求稳定), 更大 token 预算 (要额外输出 audit), 更长超时
  const temperature = mode === 'pro' ? 0.5 : 0.7;
  const tokenCeiling = mode === 'pro' ? 16000 : 8000;
  const tokenMultiplier = mode === 'pro' ? 2.2 : 1.4;
  // v7.1 关键修复: DeepSeek 为推理模型, reasoning_tokens (与"提示复杂度"相关, pro 审计提示实测 ~1700-2000)
  //   与 content 共享 max_tokens 预算。旧 floor=2000 会被 reasoning 吃光 → content 为空 → 误判失败、
  //   每次都回落到慢速 MiniMax (basic ~88s / pro ~144s 且 degraded)。抬高 floor 留足 content 余量:
  //   basic 6000 / pro 12000 (实测 pro@12000 → finish=stop, 正常出 audit)。
  const tokenFloor = mode === 'pro' ? 12000 : 6000;
  const max_tokens = Math.max(tokenFloor, Math.min(tokenCeiling, Math.ceil(script.length * tokenMultiplier)));
  const timeoutMs = mode === 'pro' ? 240_000 : 180_000;

  const start = Date.now();

  try {
    // 依次尝试 创意(DeepSeek) → MiniMax 兜底; 第一个成功即用.
    let data: any = null;
    let usedModel = llmAttempts[0].model;
    let lastErr = 'LLM 调用失败';
    let lastStatus = 502;
    // v7.1: 每个端点遇"瞬时错误"(过载/限流/5xx)退避重试 1 次, 再切兜底 (与 llm-client 一致)
    const RETRIES = 1;
    for (const a of llmAttempts) {
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        const tag = attempt > 0 ? `${a.label}#${attempt + 1}` : a.label;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(`${a.baseURL}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${a.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: a.model,
              temperature,
              // 给 GPT 兼容服务一个结构化响应提示;不支持的会降级为自然 JSON
              response_format: { type: 'json_object' },
              max_tokens,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `以下是待润色的剧本,请按 system 的规则出 JSON:\n\n---\n${script}\n---` },
              ],
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          const d = await resp.json();
          if (resp.ok && d?.choices?.[0]?.message?.content) {
            data = d; usedModel = a.model; break;
          }
          lastErr = d?.error?.message || `LLM 调用失败 (${resp.status})`;
          lastStatus = resp.status;
          console.warn(`[polish-script] ${tag} 失败: ${lastErr}`);
        } catch (attErr: any) {
          clearTimeout(timer);
          lastErr = attErr?.name === 'AbortError' ? '超时' : (attErr?.message || String(attErr));
          console.warn(`[polish-script] ${tag} 异常: ${lastErr}`);
        }
        if (attempt < RETRIES && isTransientLLMError(lastErr)) {
          await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
          continue; // 退避后重试同端点
        }
        break; // 成功/非瞬时/超时 → 跳出去切下一个端点
      }
      if (data) break;
    }

    if (!data) {
      const isQuota = /quota|insufficient|余额|balance|user quota is not enough|429|usage limit|额度|用尽/i.test(lastErr);
      if (isQuota) {
        return Response.json(
          {
            error: '主 LLM (DeepSeek) 与 MiniMax 兜底均额度不足/受限, 无法润色. 请检查 DeepSeek / MiniMax 额度, 或稍后重试.',
            category: 'upstream-quota',
            originalMessage: lastErr,
          },
          { status: 402 },
        );
      }
      void lastStatus;
      return Response.json({ error: lastErr }, { status: 502 });
    }

    // v7.1: 剥离 reasoning 模型偶发的 <think>...</think> 块, 再做 JSON 解析 (与 llm-client 统一)
    const raw = stripThink(data.choices[0].message.content.toString());
    const parsed = robustJsonParse(raw);
    if (!parsed?.polished || typeof parsed.polished !== 'string') {
      console.warn('[polish-script] failed to extract polished field, falling back to stripped raw');
      // 彻底失败:把 JSON 外壳剥掉, 只保留可读内容塞给前端, 不让用户看到 raw JSON
      const strippedPolished = stripJsonWrapper(raw);
      return Response.json({
        polished: strippedPolished,
        summary: '模型未返回结构化响应, 已尽可能提取正文',
        notes: [],
        audit: null,
        mode,
        elapsedMs: Date.now() - start,
        degraded: true,
      });
    }

    // Pro 模式额外要求 audit, basic 模式直接忽略(模型若错发也不理它)
    const audit = mode === 'pro' ? sanitizeAudit(parsed.audit) : null;

    return Response.json({
      polished: String(parsed.polished),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((n: any) => typeof n === 'string' && n.trim()).slice(0, 20)
        : [],
      audit,
      mode,
      elapsedMs: Date.now() - start,
      model: usedModel,
      // pro 模式要求 audit 但没拿到 → 视为降级
      degraded: mode === 'pro' && !audit ? true : undefined,
    });
  } catch (e: any) {
    const msg = e?.name === 'AbortError'
      ? (mode === 'pro' ? '润色超时 (4 分钟), Pro 产出较大, 可先试 Basic 模式' : '润色超时 (3 分钟)')
      : (e?.message || 'unknown');
    console.warn('[polish-script] exception:', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * 把模型返回的 audit 做最小化清洗 —— 模型常会漏字段或多塞字段,
 * 白名单过滤 + 基本类型校验, 前端就能稳定渲染了。
 *
 * 不在 lib 里导出, 因为这是 route 层的"受信前端数据形状", 不是通用能力。
 */
function sanitizeAudit(raw: any): any | null {
  if (!raw || typeof raw !== 'object') return null;

  const asStr = (v: any, max = 600) =>
    typeof v === 'string' ? v.slice(0, max) : '';
  const asStrArr = (v: any, maxItems = 20, max = 300) =>
    Array.isArray(v)
      ? v
          .filter((x) => typeof x === 'string' && x.trim())
          .slice(0, maxItems)
          .map((x) => x.slice(0, max))
      : [];

  const hook = raw.hook && typeof raw.hook === 'object' ? {
    strength: ['weak', 'ok', 'strong'].includes(raw.hook.strength) ? raw.hook.strength : 'ok',
    at3s: asStr(raw.hook.at3s, 400),
    rationale: asStr(raw.hook.rationale, 200),
  } : null;

  const actStructure = raw.actStructure && typeof raw.actStructure === 'object' ? {
    incitingIncident: asStr(raw.actStructure.incitingIncident, 300),
    midpoint: asStr(raw.actStructure.midpoint, 300),
    climax: asStr(raw.actStructure.climax, 300),
    resolution: asStr(raw.actStructure.resolution, 300),
    missingBeats: asStrArr(raw.actStructure.missingBeats, 15, 200),
  } : null;

  const dialogueIssues = raw.dialogueIssues && typeof raw.dialogueIssues === 'object' ? {
    onTheNoseLines: asStrArr(raw.dialogueIssues.onTheNoseLines, 8, 200),
    abstractEmotionLines: asStrArr(raw.dialogueIssues.abstractEmotionLines, 8, 200),
  } : null;

  const characterAnchors = Array.isArray(raw.characterAnchors)
    ? raw.characterAnchors
        .slice(0, 12)
        .map((c: any) => ({
          name: asStr(c?.name, 50),
          visualLock: asStr(c?.visualLock, 300),
          speechStyle: asStr(c?.speechStyle, 200),
          arc: asStr(c?.arc, 200),
        }))
        .filter((c: any) => c.name)
    : [];

  const sceneLighting = Array.isArray(raw.sceneLighting)
    ? raw.sceneLighting
        .slice(0, 30)
        .map((s: any) => ({
          scene: asStr(s?.scene, 200),
          lightDirection: asStr(s?.lightDirection, 50),
          quality: asStr(s?.quality, 50),
          colorTemp: asStr(s?.colorTemp, 80),
          mood: asStr(s?.mood, 120),
        }))
        .filter((s: any) => s.scene)
    : [];

  const continuityAnchors = asStrArr(raw.continuityAnchors, 30, 300);

  const styleProfile = raw.styleProfile && typeof raw.styleProfile === 'object' ? {
    genre: asStr(raw.styleProfile.genre, 80),
    tone: asStr(raw.styleProfile.tone, 120),
    rhythm: asStr(raw.styleProfile.rhythm, 120),
    artDirection: asStr(raw.styleProfile.artDirection, 200),
  } : null;

  const aigcReadiness = raw.aigcReadiness && typeof raw.aigcReadiness === 'object' ? {
    score: clampScore(raw.aigcReadiness.score),
    reasoning: asStr(raw.aigcReadiness.reasoning, 400),
  } : null;

  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .slice(0, 30)
        .map((i: any) => ({
          severity: ['minor', 'major', 'critical'].includes(i?.severity) ? i.severity : 'minor',
          category: ['pacing', 'dialogue', 'structure', 'character', 'aigc', 'other'].includes(i?.category) ? i.category : 'other',
          text: asStr(i?.text, 300),
          where: asStr(i?.where, 120),
        }))
        .filter((i: any) => i.text)
    : [];

  // 至少要有一块实打实的内容才认为 audit 有效; 否则上层会打 degraded 标
  const hasContent =
    !!hook ||
    !!actStructure ||
    characterAnchors.length > 0 ||
    !!aigcReadiness ||
    sceneLighting.length > 0 ||
    issues.length > 0;
  if (!hasContent) return null;

  return {
    hook,
    actStructure,
    dialogueIssues,
    characterAnchors,
    sceneLighting,
    continuityAnchors,
    styleProfile,
    aigcReadiness,
    issues,
  };
}

function clampScore(v: any): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
