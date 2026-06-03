/**
 * /api/projects/[id]/vision-audit/run  · v3.4.1
 *
 * POST 触发对该项目所有 storyboard 关键帧的成片质检 (画面 vs 剧本).
 * 从 project_assets 拉 storyboard (图 + description) + timeline (台词/情绪),
 * 逐镜跑 auditShotVsScript, 持久化, 返回 summary.
 *
 * 注意: vision 调用按镜烧钱, 所以是用户显式触发 (不在生成流程里自动跑).
 * 并发限 3, 防一次性打爆上游.
 *
 * Auth: 登录用户.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../auth/lib';
import { db } from '@/lib/db';
import { normalizeAssetRow } from '@/lib/asset-storage';
import {
  auditShotVsScript,
  saveShotAudit,
  getProjectAudits,
  aggregateFilmAudit,
  type ShotScriptContext,
} from '@/lib/vision-audit';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CONCURRENCY = 3;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // storyboard assets — 图 + description
  const storyboards = db
    .prepare(`SELECT * FROM project_assets WHERE project_id = ? AND type = 'storyboard' ORDER BY shot_number ASC`)
    .all(id) as any[];

  if (storyboards.length === 0) {
    return NextResponse.json({ error: '该项目还没有分镜, 无法质检' }, { status: 400 });
  }

  // timeline asset — 可能含 per-shot 台词/情绪
  const timelineRow = db
    .prepare(`SELECT data FROM project_assets WHERE project_id = ? AND type = 'timeline' LIMIT 1`)
    .get(id) as any;
  const timelineByShot = new Map<number, { dialogue?: string; emotion?: string }>();
  if (timelineRow?.data) {
    try {
      const parsed = JSON.parse(timelineRow.data);
      const shots = Array.isArray(parsed) ? parsed : (parsed.shots || parsed.timeline || []);
      for (const s of shots) {
        const n = Number(s.shotNumber ?? s.shot_number);
        if (Number.isFinite(n)) timelineByShot.set(n, { dialogue: s.dialogue, emotion: s.emotion });
      }
    } catch { /* ignore */ }
  }

  // 组装审核任务
  type Task = { imageUrl: string; ctx: ShotScriptContext };
  const tasks: Task[] = [];
  for (const sb of storyboards) {
    const { mediaUrls, persistentUrl } = normalizeAssetRow(sb);
    const imageUrl = persistentUrl || mediaUrls?.[0];
    if (!imageUrl) continue;
    let description = '';
    try { description = JSON.parse(sb.data || '{}').description || ''; } catch { /* ignore */ }
    const shotNumber = sb.shot_number ?? tasks.length + 1;
    const tl = timelineByShot.get(shotNumber);
    tasks.push({
      imageUrl,
      ctx: {
        shotNumber,
        sceneDescription: description.slice(0, 400),
        dialogue: tl?.dialogue,
        mood: tl?.emotion,
      },
    });
  }

  if (tasks.length === 0) {
    return NextResponse.json({ error: '分镜都没有可用关键帧图', persisted: false }, { status: 400 });
  }

  // 并发跑, 限 CONCURRENCY
  let cursor = 0;
  let okCount = 0;
  let failCount = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const my = tasks[cursor++];
      const r = await auditShotVsScript(my.imageUrl, my.ctx);
      if (r) { await saveShotAudit(id, r); okCount++; }
      else { failCount++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));

  const audits = await getProjectAudits(id);
  return NextResponse.json({
    projectId: id,
    requested: tasks.length,
    scored: okCount,
    skipped: failCount,
    summary: aggregateFilmAudit(audits),
    audits,
  });
}
