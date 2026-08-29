/**
 * POST /api/projects/[id]/localize (v12.187) — 一键多语版(成片级出海翻译管线 MVP)。
 *
 * body: { language: 'ja'|'ru'|..., apply?: boolean }
 *  1. 翻译:LLM 只翻文案字段(复用 language-guard 的 byte-identical 结构约束)→ 存
 *     `script-<lang>` 资产(原稿零破坏,可反复出多语版)。
 *  2. apply=true:原稿备份为 `script-original`(仅首次)→ 翻译稿写入 script_data →
 *     触发 recompose(regenVoiceover + 该语种 TTS)→ 成片配音即该语种。
 * 对标行业 2.7 元/集翻译成本(一次 LLM 翻译调用 + TTS 重配,无重渲视频)。
 */
import { NextResponse } from 'next/server';
import { pickScriptAsset } from '@/lib/script-asset';
import { getUserFromRequest } from '../../../auth/lib';
import { getOwnedProject, updateProjectById } from '@/lib/repos/project-repo';
import { upsertAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { normalizeLanguage, languageDisplayName, SUPPORTED_LANGUAGES } from '@/lib/language-detect';
import { buildLanguageFixPrompt, needsLanguageFix } from '@/lib/language-guard';
import { robustJsonParse } from '@/lib/polish-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const project = await getOwnedProject(id, payload.sub);
  if (!project) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({} as any));
  const lang = normalizeLanguage(String(body?.language || ''), '');
  if (!lang || lang === 'zh') return NextResponse.json({ message: '请指定非中文目标语种(ja/ko/ru/en…)' }, { status: 400 });

  // 取数与 pull-sheet 同款:script 资产优先(排除多语版/备份),回退 projects.script_data
  // v12.381:改走唯一入口。原来这里自带一份 `!/^script-/` 过滤 —— 判据方向是对的,
  // 但它连 `script-drafts` 这类将来可能出现的非语种资产也会一起排掉,
  // 而 pull-sheet / recompose 又各有各的写法(其实都没过滤)。三份实现,三种行为。
  const scriptRows = await listAssetsByType(id, 'script');
  const _picked = pickScriptAsset(scriptRows);
  let script: any = (() => { try { return _picked.row?.data ? JSON.parse(_picked.row.data) : null; } catch { return null; } })();
  if (!Array.isArray(script?.shots)) {
    script = (() => { try { return JSON.parse((project as any).script_data || '{}'); } catch { return {}; } })();
  }
  if (!Array.isArray(script?.shots) || script.shots.length === 0) {
    return NextResponse.json({ message: '项目还没有剧本' }, { status: 422 });
  }

  // 1. LLM 翻译(只翻文案字段,结构 byte-identical)
  const meta = SUPPORTED_LANGUAGES[lang];
  const { callLLMWithFallback } = await import('@/lib/llm-client');
  // 大剧本(10 镜 JSON)单次翻译易被 maxTokens 截断;严格结构校验拒绝后提档重试一次,
  // 且第二次给「输出预算铁律」压缩非文案字段体积。
  const sysPrompt = buildLanguageFixPrompt(meta.enName, meta.nativeName);
  let translated: any = null;
  for (const attempt of [
    { maxTokens: 24576, extra: '' },
    { maxTokens: 32768, extra: '\nIf output budget is tight, you may shorten visualPrompt fields to ≤40 words — but NEVER truncate the JSON structure.' },
  ]) {
    const llmRes = await callLLMWithFallback({
      system: sysPrompt + attempt.extra,
      user: JSON.stringify(script),
      jsonMode: true, maxTokens: attempt.maxTokens, timeoutMs: 240_000,
    });
    if (!llmRes.ok || !llmRes.content) continue;
    const cand = robustJsonParse(llmRes.content);
    if (cand && Array.isArray(cand.shots) && cand.shots.length === script.shots.length) { translated = cand; break; }
    console.warn(`[Localize] 翻译稿结构不齐(${cand?.shots?.length ?? 'null'}/${script.shots.length}),提档重试`);
  }
  if (!translated) {
    return NextResponse.json({ message: '翻译稿结构校验失败(两次尝试),原稿未动' }, { status: 502 });
  }
  if (needsLanguageFix(translated, lang)) {
    return NextResponse.json({ message: `翻译稿语种校验未过(${languageDisplayName(lang)}),原稿未动` }, { status: 502 });
  }

  // 落多语版资产(可反复出不同语种)
  await upsertAsset({ projectId: id, type: 'script', name: `script-${lang}`, data: translated, mediaUrls: [] });

  if (body?.apply !== true) {
    return NextResponse.json({ ok: true, applied: false, language: lang, title: translated.title, message: `已生成 ${languageDisplayName(lang)} 版剧本(script-${lang} 资产);带 apply:true 可套用+重配音` });
  }

  // 2. apply:备份原稿(首次)→ 写入 → 重配音
  const backups = (await listAssetsByType(id, 'script')).filter((r) => r.name === 'script-original');
  if (backups.length === 0) {
    await upsertAsset({ projectId: id, type: 'script', name: 'script-original', data: script, mediaUrls: [] });
  }
  await updateProjectById(id, { script_data: JSON.stringify(translated) });

  return NextResponse.json({
    ok: true, applied: true, language: lang, title: translated.title,
    next: `POST /api/projects/${id}/recompose {"regenVoiceover":true,"language":"${lang}"} 重配音出多语成片`,
  });
}
