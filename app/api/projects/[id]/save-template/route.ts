/**
 * POST /api/projects/[id]/save-template · v9.6.8 (阶段十六 T2 模板市场)
 *
 * 把一个项目沉淀成可复用模板:读项目 画风 / 锁定角色 / 分镜体量 + 质量信号(发布门禁 / 成片分 / 口型)
 * → `extractTemplate`(算质量分 + 标签)→ `saveTemplate` 落 film_templates。payload 带一键起片预填。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { getProjectAudits, aggregateFilmAudit } from '@/lib/vision-audit';
import { getLatestQualityScore } from '@/lib/quality-scores';
import { evaluateQualityGate } from '@/lib/quality-gate';
import { dialogueLinesFromShots, buildLipSyncPlan } from '@/lib/lipsync-plan';
import { extractTemplate, type TemplateElementSummary } from '@/lib/template-market';
import { saveTemplate } from '@/lib/repos/template-repo';
import { persistAsset } from '@/lib/asset-storage';
import type { ScriptShot } from '@/types/agents';

export const runtime = 'nodejs';

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getDbDriver();

  const payloadUser = getUserFromRequest(request);
  let userId = payloadUser?.sub || null;
  if (!userId) {
    const first = await d.get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', []);
    userId = first?.id || null;
  }

  const proj = await d.get<any>('SELECT title, style_id, locked_characters FROM projects WHERE id = ?', [id]);
  if (!proj) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  // 分镜
  const scriptRows = await listAssetsByType(id, 'script');
  let script: { shots?: ScriptShot[] } = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shots: ScriptShot[] = Array.isArray(script.shots) ? script.shots : [];

  // 质量信号 → 模板质量分
  const audits = await getProjectAudits(id);
  const filmAudit = audits.length ? aggregateFilmAudit(audits) : null;
  const qualityScore = await getLatestQualityScore(id);
  const lsPlan = buildLipSyncPlan(dialogueLinesFromShots(shots));
  const gate = evaluateQualityGate({
    filmAudit, qualityScore,
    lipSync: { lines: lsPlan.lines, readiness: lsPlan.readiness, level: lsPlan.level },
  });

  // v9.7.15:实测口型-音频对齐均分(若测过)→ 进模板质量分
  let lipAudioAlignAvg: number | null = null;
  try {
    const alignRows = await listAssetsByType(id, 'lipsync-align');
    const scores: Record<string, number> = JSON.parse(alignRows[0]?.data || '{}')?.scores || {};
    const vals = Object.values(scores).map(Number).filter((n) => Number.isFinite(n));
    if (vals.length) lipAudioAlignAvg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  } catch { lipAudioAlignAvg = null; }

  // 市场卡片预览(v9.7.12:首镜分镜图 + 首镜成片视频)
  const firstMedia = async (type: string): Promise<string | undefined> => {
    const row = await d.get<any>(
      `SELECT media_urls FROM project_assets WHERE project_id = ? AND type = ? AND shot_number IS NOT NULL ORDER BY shot_number ASC LIMIT 1`,
      [id, type],
    );
    try { const u = JSON.parse(row?.media_urls || '[]'); return Array.isArray(u) && u[0] ? u[0] : undefined; } catch { return undefined; }
  };
  // v9.7.13:落盘独立副本(内容寻址进 .storage)→ 源项目删了预览仍在;落盘失败回退原 URL
  let previewUrl = await firstMedia('storyboard');
  let previewVideoUrl = await firstMedia('video');
  if (previewUrl) { try { const p = await persistAsset(previewUrl, { ext: '.jpg', contentType: 'image/jpeg' }); if (p?.url) previewUrl = p.url; } catch { /* 保留原 URL */ } }
  if (previewVideoUrl) { try { const p = await persistAsset(previewVideoUrl, { ext: '.mp4', contentType: 'video/mp4' }); if (p?.url) previewVideoUrl = p.url; } catch { /* 保留原 URL */ } }

  // 角色音色覆盖(v9.7.9:带进模板,一键起片复用)
  let voiceOverrides: Record<string, string> = {};
  try {
    const ovRows = await listAssetsByType(id, 'voice-overrides');
    voiceOverrides = JSON.parse(ovRows[0]?.data || '{}')?.overrides || {};
  } catch { voiceOverrides = {}; }

  // 元素概览(锁定角色 + 画风)
  const locked = safeJson<unknown[]>(proj.locked_characters, []);
  const elements: TemplateElementSummary[] = [];
  if (locked.length) elements.push({ role: 'character', count: locked.length });
  if (proj.style_id) elements.push({ role: 'style', count: 1 });

  const template = extractTemplate({
    id,
    title: `${proj.title || '未命名'} 模板`,
    style: proj.style_id || '',
    elements,
    shotCount: shots.length,
    signals: {
      publishLevel: gate.level,
      consistency: qualityScore?.overall ?? null,
      lipSyncReadiness: lsPlan.lines ? lsPlan.readiness : null,
      lipAudioAlign: lipAudioAlignAvg,
    },
    sourceProjectId: id,
  });

  const saved = await saveTemplate({
    template,
    ownerId: userId,
    payload: {
      style: proj.style_id || undefined,
      lockedCharacters: locked,
      ...(Object.keys(voiceOverrides).length ? { voiceOverrides } : {}),
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewVideoUrl ? { previewVideoUrl } : {}),
    },
    visibility: 'public',
  });

  return NextResponse.json({ ok: true, template: saved });
}
