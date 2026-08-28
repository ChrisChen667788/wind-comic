/**
 * POST /api/series/[id]/export (阶段二十六 · v12.25.0 / 评审加固 v12.26.0) —— 一键导出整季合集。
 * 把本系列**已完成**各集成片按集号拼成一条整季视频(归一画幅 + 重编码),持久化后存为锚点集的
 * `season_video` 资产。安全:登录 + 只动本人系列。
 *
 * v12.26.0 加固:① 输出走 persistAsset 落盘(不再存 /tmp 临时路径 → 重启后 404);
 * ② 用完清理 tmpDir(防磁盘泄漏);③ per-series 并发锁(防多个 ffmpeg 同跑刷资源);
 * ④ 返回 skipped(无成片被跳过的集);⑤ 画幅取已完成集。
 */
import { NextResponse } from 'next/server';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodes } from '@/lib/repos/series-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { acquireLock, releaseLock, makeLockOwner } from '@/lib/repos/resource-lock-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_EPISODES = 20;
// v12.227(多实例就绪):导出并发锁从**进程内 Set** 换成 DB CAS 锁。
// 病根:进程内 Set 在多实例下形同虚设 —— 第二个实例的 Set 是空的,同一系列会被两个
// ffmpeg 同时导出,产物互相覆盖(season_video 指向谁看竞争结果)、CPU/磁盘双份消耗。
// TTL 取 maxDuration 同量级(300s),持锁进程崩溃后靠 TTL 自动解锁,不会永久卡住导出。
const EXPORT_LOCK_TTL_MS = 300_000;
const exportLockKey = (seriesId: string) => `series-export:${seriesId}`;

function urlOf(a: any): string | undefined {
  if (!a) return undefined;
  if (a.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a.media_urls || '[]'); return Array.isArray(m) ? m[0] : undefined; } catch { return undefined; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eps = await listSeriesEpisodes(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });
  const completed = eps.filter((e) => e.status === 'completed').slice(0, MAX_EPISODES);
  if (completed.length === 0) return NextResponse.json({ error: '还没有已完成的剧集,先批量生成' }, { status: 400 });

  // v12.158:导出前体检闸门 —— 有降级镜/红灯的集先提示修复,确认仍导出带 ignoreHealth:true。
  // 不做硬阻断(用户可能就要 animatic 版),但默认别让残次品无感混进整季合集。
  const reqBody = await request.json().catch(() => ({} as any));
  if (reqBody?.ignoreHealth !== true) {
    const { buildProjectHealth, mapPool } = await import('@/lib/film-health-io');
    const checks = await mapPool(completed, 2, async (e) => ({
      episode: e.episode_number, health: await buildProjectHealth(e.id).catch(() => null),
    }));
    const bad = checks.filter((c) => c.health && (c.health.overall === 'fail' || c.health.animaticShots.length > 0));
    if (bad.length > 0) {
      return NextResponse.json({
        error: 'health_gate',
        message: `${bad.length} 集有质量问题(降级镜/体检红灯),建议先在系列面板补渲;确认仍导出请重试并选择忽略`,
        details: bad.map((c) => ({ episode: c.episode, overall: c.health!.overall, animaticShots: c.health!.animaticShots })),
      }, { status: 409 });
    }
  }

  // 并发锁:同一系列正在导出 → 409(防多 Tab/脚本/多实例并发起多个 ffmpeg)
  const lockOwner = makeLockOwner('series-export');
  if (!(await acquireLock(exportLockKey(id), EXPORT_LOCK_TTL_MS, lockOwner))) {
    return NextResponse.json({ error: '该系列正在导出中,请稍候' }, { status: 409 });
  }

  // 按集号收集各集成片 URL;无成片的集记入 skipped
  const urls: string[] = [];
  const skipped: number[] = [];
  for (const ep of completed) {
    const u = urlOf((await listAssetsByType(ep.id, 'final_video'))[0]);
    if (u) urls.push(u); else skipped.push(ep.episode_number ?? 0);
  }
  if (urls.length === 0) {
    await releaseLock(exportLockKey(id), lockOwner).catch(() => { /* 释放失败靠 TTL 兜底 */ });
    return NextResponse.json({ error: '已完成剧集均无成片文件' }, { status: 400 });
  }

  const anchor = eps[0];               // 季产物挂集号最小的锚点集(GET 也从这读,保持一致)
  const aspect = completed[0].aspect || anchor.aspect || '16:9'; // 画幅取真实已完成集
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-export-'));
  try {
    const { concatVideos } = await import('@/services/video-composer');
    const { outputPath, count } = await concatVideos(urls, aspect, tmpDir);
    // 持久化:从 tmp 落到 storage(否则重启/清理后 URL 失效);失败兜底用 tmp serve-file URL
    const tmpUrl = `${serveFilePathUrl(outputPath)}`;
    const persisted = await persistAsset(tmpUrl, { ext: '.mp4' }).catch(() => null);
    const videoUrl = persisted?.url || tmpUrl;
    await upsertAsset({
      projectId: anchor.id, type: 'season_video', name: '整季合集',
      data: { seriesId: id, count, aspect, skipped }, mediaUrls: [videoUrl], persistentUrl: persisted?.url || null,
    });
    return NextResponse.json({ ok: true, videoUrl, count, skipped });
  } catch (e) {
    return NextResponse.json({ error: '合集导出失败: ' + (e instanceof Error ? e.message : String(e)).slice(0, 160) }, { status: 502 });
  } finally {
    await releaseLock(exportLockKey(id), lockOwner).catch(() => { /* 释放失败靠 TTL 兜底 */ });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理临时目录,防磁盘泄漏 */ }
  }
}
