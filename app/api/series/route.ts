/**
 * POST /api/series (阶段二十六 · v12.17.0 多集生成) —— 创建系列剧:把「系列设定 + 各集梗概」
 * 落成多个互相串联的剧集 shell(同 seriesId、集号递增),后续各集走既有单集管线生成。
 *
 * 跨集一致性:可选 anchorProjectId(把已有项目设为第 1 集),后续各集**继承它的
 * 画风/锁脸/主角参考**(style_id/primary_character_ref/locked_characters)—— 保第 2 集主角和第 1 集一样。
 *
 * 安全:登录;anchorProjectId 必须属主。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../auth/lib';
import { buildSeriesPlan, validateSeriesInput, deriveSeriesId, type EpisodeOutline, type SeriesAnchor } from '@/lib/series';
import { insertEpisodeProject, linkAnchorEpisode, listUserSeries, maxEpisodeNumber } from '@/lib/repos/series-repo';
import { buildSeasonBatch } from '@/lib/season-batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parse(raw: string | null | undefined): any { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

/** GET /api/series —— 列出本人所有系列(「我的系列」入口用)。 */
export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const series = await listUserSeries(payload.sub);
  return NextResponse.json({ ok: true, series });
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  let body: any = {}; try { body = await request.json(); } catch {}
  const seriesTitle = (typeof body?.seriesTitle === 'string' ? body.seriesTitle : '').trim() || '我的系列剧';
  let episodes: EpisodeOutline[] = Array.isArray(body?.episodes) ? body.episodes : [];

  // v12.21.0 AI 自动拆集:没给 episodes 但给了 premise + episodeCount → 创意 LLM 拆成各集梗概
  // v12.23.0(评审):边界校验 —— 集数 1–50、premise 截断,与 /split 端点一致,防刷 LLM/垃圾数据
  let autoSplit = false;
  if (episodes.length === 0 && typeof body?.premise === 'string' && body.premise.trim() && Number(body?.episodeCount) > 0) {
    const count = Number(body.episodeCount);
    if (count < 1 || count > 50) return NextResponse.json({ error: '集数需在 1–50' }, { status: 400 });
    try {
      const { splitSeriesIntoEpisodes } = await import('@/lib/series-ai');
      episodes = await splitSeriesIntoEpisodes(body.premise.trim().slice(0, 1000), count);
      autoSplit = true;
    } catch (e) {
      return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
    }
  }

  const v = validateSeriesInput(episodes);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // 锚点集(可选):已有项目 → 第 1 集,后续各集继承其一致性资产
  let anchor: SeriesAnchor = {
    aspect: typeof body?.aspect === 'string' ? body.aspect : '16:9',
    styleId: typeof body?.styleId === 'string' ? body.styleId : null,
  };
  let seriesId = `series-${Date.now()}`;
  let startEpisode = 1;
  const anchorProjectId = typeof body?.anchorProjectId === 'string' ? body.anchorProjectId : '';
  if (anchorProjectId) {
    // v12.23.0(评审):用 DbDriver 异步查(PG 双驱);裸 db.prepare 在 PG 部署下读错库 → 越权/404
    const ap = await getDbDriver().get(
      'SELECT id, user_id, aspect, style_id, primary_character_ref, locked_characters FROM projects WHERE id = ?',
      [anchorProjectId],
    ) as any;
    if (!ap) return NextResponse.json({ error: '锚点项目不存在' }, { status: 404 });
    if (ap.user_id !== userId) return NextResponse.json({ error: '锚点项目非本人' }, { status: 403 });
    anchor = {
      aspect: ap.aspect || '16:9',
      styleId: ap.style_id ?? null,
      primaryCharacterRef: ap.primary_character_ref ?? null,
      lockedCharacters: ap.locked_characters ?? null,
    };
    seriesId = deriveSeriesId(anchorProjectId);
    await linkAnchorEpisode(anchorProjectId, seriesId, userId);
    // v12.23.0(评审):续号 = 现有最大集号+1(锚点=1)。修复「同一 anchor 重复建系列 → episode id 撞 PK 循环中途崩」
    startEpisode = (await maxEpisodeNumber(seriesId, userId)) + 1;
  }

  const specs = buildSeriesPlan({ seriesId, seriesTitle, episodes, anchor, startEpisode });
  const created: Array<{ id: string; episodeNumber: number; title: string }> = [];
  for (const spec of specs) {
    const id = `${seriesId}-ep${spec.episodeNumber}`;
    await insertEpisodeProject({ id, userId, spec });
    created.push({ id, episodeNumber: spec.episodeNumber, title: spec.title });
  }

  // 批次计划(供前端追踪逐集生成进度;实际生成各集走既有单集管线)
  const batch = buildSeasonBatch(
    specs.map((s) => ({ index: s.episodeNumber, title: s.title, charCount: s.description.length, text: s.description })),
  );

  return NextResponse.json({
    ok: true,
    seriesId,
    autoSplit, // v12.21.0:本次各集梗概是否 AI 自动拆出
    anchorProjectId: anchorProjectId || null,
    episodes: created,
    inherits: anchorProjectId ? { styleId: anchor.styleId, primaryCharacterRef: anchor.primaryCharacterRef, aspect: anchor.aspect } : null,
    batch,
  });
}
