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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: any = {};
  try { body = await request.json(); } catch {}

  const script = typeof body?.script === 'string' ? body.script.trim() : '';
  if (!script) {
    return Response.json({ error: '请提供 script 字段(string)' }, { status: 400 });
  }
  if (script.length > 32000) {
    return Response.json({ error: '剧本过长 (>32000 字符), 请分段润色' }, { status: 413 });
  }

  const mode: PolishMode = body?.mode === 'pro' ? 'pro' : 'basic';
  const style = typeof body?.style === 'string' ? body.style : undefined;
  const intensity = typeof body?.intensity === 'string' ? body.intensity : 'moderate';
  const focus = typeof body?.focus === 'string' ? body.focus.slice(0, 300) : undefined;

  if (!API_CONFIG.openai.apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY 未配置, 润色服务暂不可用' }, { status: 503 });
  }

  const systemPrompt = buildPolishPrompt({ mode, style, intensity, focus });
  const model = API_CONFIG.openai.creativeModel || API_CONFIG.openai.model;

  // Pro 模式: 更低温度 (行业诊断要求稳定), 更大 token 预算 (要额外输出 audit), 更长超时
  const temperature = mode === 'pro' ? 0.5 : 0.7;
  const tokenCeiling = mode === 'pro' ? 16000 : 8000;
  const tokenMultiplier = mode === 'pro' ? 2.2 : 1.4;
  const max_tokens = Math.max(2000, Math.min(tokenCeiling, Math.ceil(script.length * tokenMultiplier)));
  const timeoutMs = mode === 'pro' ? 240_000 : 180_000;

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(`${API_CONFIG.openai.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_CONFIG.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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

    const data = await resp.json();
    if (!resp.ok || !data?.choices?.[0]?.message?.content) {
      const msg = data?.error?.message || `LLM 调用失败 (${resp.status})`;
      console.warn('[polish-script] upstream error:', msg);
      return Response.json({ error: msg }, { status: 502 });
    }

    const raw = data.choices[0].message.content.toString().trim();
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
      model,
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
