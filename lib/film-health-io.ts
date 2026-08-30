/**
 * 成片体检取数层(v12.155.0)—— 从 /api/projects/[id]/health 路由抽出,
 * 单项目与系列聚合(/api/series/[id]/health)共用。判定仍在 film-health(纯函数)。
 */
import { db } from '@/lib/db';
import { pickScriptAsset } from './script-asset';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { probeMediaFull, buildFilmHealthReport, type FilmHealthReport } from './film-health';
import { serveFileToLocalPath } from './first-frame';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** serve-file → 本地路径(ffprobe 直读);其余原样。 */
function toLocalPath(url: string): string {
  return serveFileToLocalPath(url) || url;
}

export interface ProjectHealth extends FilmHealthReport {
  animaticShots: number[];
}

/** 单项目全维体检(取数 + 判定)。 */
export async function buildProjectHealth(projectId: string): Promise<ProjectHealth> {
  const finals = await listAssetsByType(projectId, 'final_video');
  const finalRow = finals.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))[0];
  const finalUrl = finalRow ? (finalRow.persistent_url || (parseJson(finalRow.media_urls) || [])[0] || '') : '';
  const finalProbe = finalUrl ? await probeMediaFull(toLocalPath(finalUrl)) : null;

  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = parseJson(pickScriptAsset(scriptRows).row?.data);
  if (!Array.isArray(script?.shots)) {
    const r = db.prepare('SELECT script_data FROM projects WHERE id = ?').get(projectId) as any;
    script = parseJson(r?.script_data) || {};
  }
  const shots: any[] = Array.isArray(script?.shots) ? script.shots : [];
  const expected = shots.length
    ? shots.reduce((t, s) => t + (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5), 0)
    : null;

  const videoRows = await listAssetsByType(projectId, 'video');
  const withVideo = videoRows.filter((r) => {
    const urls = parseJson(r.media_urls) || [];
    return !!(r.persistent_url || urls[0]);
  });
  const animaticShots = videoRows.filter((r) => {
    const d = parseJson(r.data) || {};
    const urls = parseJson(r.media_urls) || [];
    const candidates = [r.persistent_url, urls[0]].map((x) => String(x || ''));
    return d.isAnimatic === true || candidates.some((x) => /animatic-\d+\.mp4/.test(x));
  }).map((r) => r.shot_number as number).filter((n) => typeof n === 'number').sort((a, b) => a - b);

  const projRow = db.prepare('SELECT aspect FROM projects WHERE id = ?').get(projectId) as { aspect?: string } | undefined;

  const report = buildFilmHealthReport({
    finalProbe,
    hasFinalAsset: !!finalUrl,
    projectAspect: projRow?.aspect || '16:9',
    expectedDurationSec: expected,
    shotTotal: shots.length,
    shotWithVideo: withVideo.length,
    animaticShots,
  });

  // v12.216:引擎能力边界提示 —— 项目语种命中口型降级(ja/ko/ru)或运营者开了不生效的开关时,
  // 追加为体检行(知情项;overall 不动 —— 引擎边界不是这条片的缺陷)。语种从剧本嗅探(零成本)。
  try {
    const { sniffTextLanguage } = await import('./language-detect');
    const { engineCapabilityNotes } = await import('./engine-capability-notes');
    const sniffSample = [script?.title, ...shots.slice(0, 6).map((s: any) => s?.dialogue)].filter(Boolean).join(' ');
    const notes = engineCapabilityNotes({ language: sniffTextLanguage(sniffSample) });
    for (const n of notes) {
      report.items.push({ key: n.key, label: n.label, status: n.severity === 'warn' ? 'warn' : 'unknown', detail: n.text } as any);
    }
  } catch { /* 提示层失败不阻塞体检 */ }

  return { ...report, animaticShots };
}

/** 有界并发池(系列逐集体检用;沿用 season-orchestrator 的 runPool 哲学,轻量内联)。 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
