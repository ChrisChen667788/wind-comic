/**
 * POST /api/projects/[id]/cameo-retry-storyboard · Sprint A.4 批量重生端点
 *
 * 接收一组低分镜头编号, 用 Sprint A.1 的 cameo-retry 流程重新渲染分镜图,
 * 把新图 + 新 score 写回 project_assets。完成后返回汇总。
 *
 * 入参:
 *   { shotNumbers: number[] }
 *
 * 出参:
 *   { processed: number, upgraded: number, unchanged: number, failed: number,
 *     details: Array<{ shotNumber, before, after, retried, reason }> }
 *
 * 取舍说明:
 *   · 同步处理 (sequential), 没用 SSE — 一般 1-5 镜, 总耗时 1-5 min, HTTP 能撑住
 *   · 失败镜头不影响其他, 各自捕获 error
 *   · 用项目里第一个 character 资产作为 cref (与 orchestrator 主管线 fallback 一致)
 *   · 仅更新 storyboard 资产的 media_urls + data, 不动视频资产 (用户重看视频还是旧的,
 *     如果他们要新视频, 应该单独点"重生此镜视频")
 *
 * 限制 (避免被滥用):
 *   · 最多一次重生 30 镜, 超过截断
 *   · 仅支持已经存在的 storyboard shot, 找不到的静默跳过
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min upper bound

const MAX_BATCH = 30;

interface StoryboardRow {
  id: string;
  shot_number: number;
  media_urls: string;     // JSON string
  persistent_url: string | null;
  data: string;           // JSON string
}

interface CharacterRow {
  id: string;
  name: string;
  media_urls: string;
  persistent_url: string | null;
  data: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  let body: any = {};
  try { body = await request.json(); } catch {}
  const requestedShots: number[] = Array.isArray(body?.shotNumbers)
    ? body.shotNumbers.filter((n: any) => typeof n === 'number' && n > 0).slice(0, MAX_BATCH)
    : [];

  if (requestedShots.length === 0) {
    return NextResponse.json({ error: '请给定 shotNumbers: number[]' }, { status: 400 });
  }

  // 1. 项目存在性
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  }

  // 2. 取项目的角色资产 — 第一张图作为 cref (与 orchestrator pickConsistencyRefs 的 first-character fallback 对齐)
  const characters = db.prepare(
    `SELECT id, name, media_urls, persistent_url, data FROM project_assets
     WHERE project_id = ? AND type = 'character' ORDER BY created_at ASC`
  ).all(projectId) as CharacterRow[];

  const firstCharacterRef = (() => {
    for (const c of characters) {
      if (c.persistent_url) return c.persistent_url;
      try {
        const arr = JSON.parse(c.media_urls || '[]');
        if (arr[0] && typeof arr[0] === 'string') return arr[0];
      } catch { /* ignore */ }
    }
    return null;
  })();

  if (!firstCharacterRef) {
    return NextResponse.json({
      error: '项目没有可用作 cref 的角色图, 无法做一致性重生',
    }, { status: 400 });
  }

  // 3. 取所有 storyboard 资产, 按 shot_number 索引
  const allBoards = db.prepare(
    `SELECT id, shot_number, media_urls, persistent_url, data FROM project_assets
     WHERE project_id = ? AND type = 'storyboard'
     ORDER BY shot_number ASC`
  ).all(projectId) as StoryboardRow[];

  const boardsByShot = new Map<number, StoryboardRow>();
  allBoards.forEach((b) => {
    if (b.shot_number) boardsByShot.set(b.shot_number, b);
  });

  // 同角色最近 N 张(取所有非目标分镜的图作为 sref 链, 限 4 张)
  const recentReferences: string[] = [];
  for (const b of allBoards) {
    if (recentReferences.length >= 4) break;
    if (requestedShots.includes(b.shot_number)) continue; // 不用待重生的镜头作参考
    const url = b.persistent_url || (() => {
      try { return JSON.parse(b.media_urls || '[]')[0] || null; } catch { return null; }
    })();
    if (url && typeof url === 'string') recentReferences.push(url);
  }

  // 4. orchestrator 实例
  const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
  const orchestrator = new HybridOrchestrator();
  try {
    const proj = db.prepare('SELECT style_id FROM projects WHERE id = ?').get(projectId) as { style_id?: string } | undefined;
    if (proj?.style_id) orchestrator.setUserStyle(proj.style_id);
  } catch { /* ignore */ }

  const details: Array<{
    shotNumber: number;
    before: number | null;
    after: number | null;
    retried: boolean;
    reason: string;
    status: 'upgraded' | 'unchanged' | 'failed' | 'skipped';
  }> = [];
  let upgraded = 0, unchanged = 0, failed = 0;

  for (const shotNumber of requestedShots) {
    const board = boardsByShot.get(shotNumber);
    if (!board) {
      details.push({ shotNumber, before: null, after: null, retried: false, reason: 'storyboard 不存在', status: 'skipped' });
      continue;
    }
    const boardData = (() => {
      try { return JSON.parse(board.data || '{}'); } catch { return {}; }
    })();
    const originalImageUrl = board.persistent_url || (() => {
      try { return JSON.parse(board.media_urls || '[]')[0] || ''; } catch { return ''; }
    })();
    if (!originalImageUrl) {
      details.push({ shotNumber, before: null, after: null, retried: false, reason: '原图 URL 缺失', status: 'skipped' });
      continue;
    }

    const before = typeof boardData.cameoScore === 'number' ? boardData.cameoScore : null;
    try {
      const result = await orchestrator.cameoRetrySingleShot({
        shotNumber,
        originalImageUrl,
        originalPrompt: boardData.description || `Shot ${shotNumber}`,
        crefUrl: firstCharacterRef,
        sameCharacterRecentShots: recentReferences,
        originalCw: 100,
      });

      // 写回 storyboard 资产 — 只在 retry 真正发生且新图非空时更新 media_urls
      const newData = {
        ...boardData,
        cameoScore: result.cameoScore,
        cameoRetried: result.cameoRetried,
        cameoFinalCw: result.finalCw,
        cameoReason: result.reasoning,
        cameoBatchAt: now(),
      };
      const shouldUpdateImage = result.cameoRetried && result.finalImageUrl && result.finalImageUrl !== originalImageUrl;
      if (shouldUpdateImage) {
        db.prepare('UPDATE project_assets SET media_urls = ?, persistent_url = ?, data = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify([result.finalImageUrl]), null, JSON.stringify(newData), now(), board.id);
      } else {
        db.prepare('UPDATE project_assets SET data = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(newData), now(), board.id);
      }

      if (shouldUpdateImage && (result.cameoScore == null || (before != null && result.cameoScore > before))) {
        upgraded++;
        details.push({
          shotNumber, before, after: result.cameoScore, retried: result.cameoRetried,
          reason: result.reasoning, status: 'upgraded',
        });
      } else {
        unchanged++;
        details.push({
          shotNumber, before, after: result.cameoScore, retried: result.cameoRetried,
          reason: result.reasoning, status: 'unchanged',
        });
      }
    } catch (e) {
      failed++;
      details.push({
        shotNumber, before, after: null, retried: false,
        reason: e instanceof Error ? e.message : 'unknown error',
        status: 'failed',
      });
      console.warn(`[cameo-retry-storyboard] shot ${shotNumber} failed:`, e);
    }
  }

  return NextResponse.json({
    processed: requestedShots.length,
    upgraded,
    unchanged,
    failed,
    details,
  });
}
