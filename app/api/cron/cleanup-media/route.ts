/**
 * GET/POST /api/cron/cleanup-media (v12.191) — 媒体定时清理。
 *
 * data/ 已累积 3.5GB(用户磁盘之痛的一半根源):storage 30 天、composed/exports 7 天、
 * media(images/audio/videos)14 天 —— **只删「有持久引用保护之外」的过期文件**?
 * 保守起见:composed 成片可再合成、exports 可再导出、media 中间物可再生 —— 按 mtime 清;
 * storage(persistAsset 注册表)walk 现有 cleanup()。带 CRON_SECRET 校验(env 未设则仅本机)。
 * 干跑:?dryRun=1 只报告不删。
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanup } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 按龄清理目录 —— **被数据库引用的文件永不删除**(v12.342)。
 *
 * 原实现只看 mtime 就删,理由是「composed 成片可再合成、exports 可再导出、media 中间物可再生」。
 * 但「可再生」不等于「可以删」:再生要花钱、要时间,而用户并不知道自己的成片有 7 天保质期。
 * 实际后果:`data/composed` 已被清空,而 `project_assets` 里仍有 **33 条**指向它的引用 ——
 * 用户点开历史项目,成片播不出来,系统对此毫无察觉。storage 那边同样如此(见 lib/asset-storage）。
 *
 * 现在:先取库里所有仍被引用的**文件名**,命中的一律跳过,不管多老。
 * 取引用失败就整轮不删 —— 删除不可逆,占磁盘可逆。
 */
function referencedBasenames(): Set<string> | null {
  try {
    const { db } = require('@/lib/db');
    const rows = db.prepare(
      `SELECT persistent_url, media_urls FROM project_assets
       WHERE persistent_url IS NOT NULL OR media_urls IS NOT NULL`,
    ).all() as Array<{ persistent_url?: string; media_urls?: string }>;
    const names = new Set<string>();
    for (const r of rows) {
      for (const blob of [r.persistent_url || '', r.media_urls || '']) {
        for (const m of blob.matchAll(/([A-Za-z0-9._-]+\.(?:mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a|srt|edl|xml|aaf))/g)) {
          names.add(m[1]);
        }
      }
    }
    return names;
  } catch (e) {
    console.error('[cleanup-media] 读引用失败,本轮不删任何文件:', e instanceof Error ? e.message : e);
    return null;
  }
}

function sweepDir(dir: string, maxAgeDays: number, dryRun: boolean, referenced: Set<string> | null): { removed: number; freedMB: number; skippedReferenced: number } {
  let removed = 0, freed = 0, skippedReferenced = 0;
  if (referenced === null) return { removed: 0, freedMB: 0, skippedReferenced: 0 };  // 读不到引用 → 不删
  try {
    if (!fs.existsSync(dir)) return { removed: 0, freedMB: 0, skippedReferenced: 0 };
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (referenced.has(f)) { skippedReferenced++; continue; }   // 被引用 → 永不删
        if (st.mtimeMs < cutoff) {
          freed += st.size;
          if (!dryRun) fs.unlinkSync(p);
          removed++;
        }
      }
    };
    walk(dir);
  } catch { /* 单目录失败不阻塞其他 */ }
  return { removed, freedMB: Math.round(freed / 1024 / 1024), skippedReferenced };
}

async function handle(request: Request) {
  const url = new URL(request.url);
  // v12.234(二轮对抗复检 · HIGH):原写 `if (secret && ...)` —— **CRON_SECRET 未设时整个守卫被短路**,
  // 匿名 GET 一下就按 mtime 批量删 data/composed / exports / media 里的成片。
  // 兄弟端点 run-scheduled-publishes 早就是「生产未设密钥 → 503 拒跑」,本端点漏了同款兜底;
  // 而删除比发布更不可逆。护栏的默认必须是拒绝,不能是「没配置就等于不设防」。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: '未配置 CRON_SECRET,拒绝在生产无保护执行媒体清理' }, { status: 503 },
      );
    }
    console.warn('[cron/cleanup-media] 未设 CRON_SECRET,非生产环境放行(生产会 503)');
  } else {
    // v12.236(第三轮对抗复检):密钥原本**只能**从 `?secret=` 读 —— 完整 URL 会被
    // Nginx/Vercel/CDN 的访问日志原样记下,等于把可触发**不可逆批量删除**的密钥明文写进日志;
    // 而兄弟端点 run-scheduled-publishes 早就用 Authorization 头。现在优先收头;
    // query 形式暂时保留(用户本机 launchd 定时任务在用),但每次命中都告警,提示改用头。
    const auth = request.headers.get('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const queryed = url.searchParams.get('secret') || '';
    if (bearer !== secret && queryed !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!bearer && queryed === secret) {
      console.warn(
        '[cron/cleanup-media] ⚠️ 密钥走 ?secret= 查询参数,会明文进访问日志。' +
        '请改用 `Authorization: Bearer $CRON_SECRET`(该形式已支持)。',
      );
    }
  }
  const dryRun = url.searchParams.get('dryRun') === '1';
  const root = process.cwd();
  // 一次性取引用清单,三个目录共用;取不到则整轮不删(见 referencedBasenames)
  const refs = referencedBasenames();
  const report = {
    dryRun,
    referenceLookup: refs === null ? 'failed(本轮不删)' : `${refs.size} 个被引用文件受保护`,
    composed: sweepDir(path.join(root, 'data', 'composed'), 7, dryRun, refs),
    exports: sweepDir(path.join(root, 'data', 'exports'), 7, dryRun, refs),
    media: sweepDir(path.join(root, 'data', 'media'), 14, dryRun, refs),
    storage: cleanup({ maxAgeDays: 30, dryRun }),   // v12.342:干跑也走同一条逻辑,报告才有意义
  };
  const totalRemoved = report.composed.removed + report.exports.removed + report.media.removed + (report.storage.removed || 0);
  return NextResponse.json({ ...report, totalRemoved, ranAt: new Date().toISOString() });
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
