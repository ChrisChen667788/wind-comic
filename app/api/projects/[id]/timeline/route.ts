/**
 * GET/POST /api/projects/[id]/timeline · v3.1 F
 *
 * Cinema 时间线 MVP — 仅支持 shot 重排 + 单镜时长改.
 * 完整时间线 (轨道 + 拖拽) 是 v3.1 大目标, 此 MVP 提供:
 *   GET → { shots: [{ shotNumber, duration, dialogue, thumbnailUrl, videoUrl }] }
 *   POST { shotOrder: number[], durations?: Record<shotNumber, seconds> }
 *     → 更新 script.shots 顺序 + per-shot duration
 *
 * 数据写回: project_assets where type='script' 的 data 字段 (Script JSON).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import type { Script, ScriptShot } from '@/types/agents';
import { computeTracks, applyTrackEdits, resetTrackEdit, type SegmentOverride } from '@/lib/timeline-tracks';
import { updateAsset, listLatestStoryboards } from '@/lib/repos/asset-repo';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadScript(projectId: string): { row: any; script: Script | null } {
  const row = db.prepare(
    `SELECT id, data FROM project_assets
     WHERE project_id = ? AND type = 'script'
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(projectId) as { id: string; data: string } | undefined;
  if (!row) return { row: null, script: null };
  try {
    const script = JSON.parse(row.data) as Script;
    return { row, script };
  } catch {
    return { row, script: null };
  }
}

async function loadShotMedia(projectId: string): Promise<Map<number, { thumbnailUrl?: string; videoUrl?: string }>> {
  const out = new Map<number, { thumbnailUrl?: string; videoUrl?: string }>();
  try {
    // v13.10:缩略图取每镜当前那行分镜(选行口径见 lib/storyboard-latest)。原来和视频一起按 updated_at DESC
    // 取第一张有图的 —— 当前那行没图时会退到旧稿,param-sync 刷过旧行的 updated_at 也会让旧稿排到前面。
    const boards = await listLatestStoryboards(projectId);
    const videos = db.prepare(
      `SELECT type, shot_number, media_urls FROM project_assets
       WHERE project_id = ? AND shot_number IS NOT NULL AND type = 'video'
       ORDER BY updated_at DESC`,
    ).all(projectId) as Array<{ type: string; shot_number: number; media_urls: string }>;
    for (const r of [...boards, ...videos]) {
      if (!r.shot_number) continue;
      const existing = out.get(r.shot_number) || {};
      try {
        const urls = JSON.parse(r.media_urls || '[]');
        if (Array.isArray(urls) && urls[0]) {
          if (r.type === 'video') { if (!existing.videoUrl) existing.videoUrl = urls[0]; }
          else if (!existing.thumbnailUrl) existing.thumbnailUrl = urls[0];
        }
      } catch { /* ignore */ }
      out.set(r.shot_number, existing);
    }
  } catch (e) {
    console.warn('[timeline] loadShotMedia failed:', e);
  }
  return out;
}

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const { script } = loadScript(projectId);
  if (!script || !Array.isArray(script.shots)) {
    return NextResponse.json({ shots: [], tracks: { bgm: [], subtitle: [] }, totalDuration: 0 });
  }
  const media = await loadShotMedia(projectId);
  const shots = script.shots.map((s) => ({
    shotNumber: s.shotNumber,
    duration: s.duration || 5,
    dialogue: s.dialogue || '',
    action: s.action || '',
    sceneDescription: s.sceneDescription || '',
    characters: s.characters || [],
    thumbnailUrl: media.get(s.shotNumber)?.thumbnailUrl || null,
    videoUrl: media.get(s.shotNumber)?.videoUrl || null,
  }));
  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  // v3.1 F.1: 派生 BGM + subtitle 轨道
  const tracks = await computeTracks(projectId, script);
  return NextResponse.json({ shots, totalDuration, tracks });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // v12.234(本版新增的全仓不变量自己抓到的,四路对抗 agent 均未报):
  // 此处此前只有 `if (!actorId) 401`,而 actorId 永远是 '__no_auth__' 这个 truthy 哨兵 → 死检查。
  // 本 handler 末尾直接 updateAsset() 覆写剧本,**全程没有任何归属校验** ——
  // 也就是匿名请求可以重排/改写**任意项目**的分镜。GET 有 view 守卫,POST 却裸奔,又一处读写不对称。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const actorId = _g.userId;

  let body: any = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { row, script } = loadScript(projectId);
  if (!script || !Array.isArray(script.shots) || !row) {
    return NextResponse.json({ error: '项目剧本不存在' }, { status: 404 });
  }

  // shotOrder: 新顺序的 shotNumber[] (e.g. [3, 1, 2, 4] 表示把 shot 3 移到首位)
  if (Array.isArray(body.shotOrder)) {
    const orderMap = new Map<number, number>();
    body.shotOrder.forEach((n: number, idx: number) => orderMap.set(n, idx));
    // 不在新顺序里的 shot 排在末尾保留 (防误删)
    const reordered = [...script.shots].sort((a, b) => {
      const ai = orderMap.has(a.shotNumber) ? orderMap.get(a.shotNumber)! : 9999;
      const bi = orderMap.has(b.shotNumber) ? orderMap.get(b.shotNumber)! : 9999;
      return ai - bi;
    });
    // 重新分配 shotNumber 让保持 1, 2, 3, ... (UI 显示一致)
    reordered.forEach((s, i) => { s.shotNumber = i + 1; });
    script.shots = reordered;
  }

  // durations: { shotNumber: seconds } — 改 shot 时长 (5/6/10/15/30 自由)
  if (body.durations && typeof body.durations === 'object') {
    for (const s of script.shots) {
      const newDur = body.durations[String(s.shotNumber)] ?? body.durations[s.shotNumber];
      if (typeof newDur === 'number' && newDur > 0 && newDur <= 60) {
        s.duration = Math.round(newDur);
      }
    }
  }

  await updateAsset(row.id, { data: script });

  // v3.1 F.1: 处理 track edits (BGM/字幕 mute/移位/改写)
  // 单段 reset 走 trackResets array; 普通编辑走 trackEdits array
  if (Array.isArray(body.trackEdits)) {
    const valid: SegmentOverride[] = body.trackEdits.filter((e: any) =>
      e && (e.trackType === 'bgm' || e.trackType === 'subtitle') && typeof e.segmentKey === 'string',
    );
    if (valid.length > 0) await applyTrackEdits(projectId, valid);
  }
  if (Array.isArray(body.trackResets)) {
    for (const r of body.trackResets) {
      if (r && typeof r.segmentKey === 'string' && (r.trackType === 'bgm' || r.trackType === 'subtitle')) {
        await resetTrackEdit(projectId, r.trackType, r.segmentKey);
      }
    }
  }

  const totalDuration = script.shots.reduce((sum, s: ScriptShot) => sum + (s.duration || 5), 0);
  // 重新派生 tracks 给 client (含最新 override)
  const tracks = await computeTracks(projectId, script);
  return NextResponse.json({
    shots: script.shots.map((s) => ({
      shotNumber: s.shotNumber,
      duration: s.duration,
      dialogue: s.dialogue || '',
    })),
    totalDuration,
    tracks,
  });
}
