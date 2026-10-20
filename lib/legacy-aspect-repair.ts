/**
 * 旧库画幅修复(v13.3)—— `projects.aspect` 记着引擎出不了的画幅的项目,改成实际出片的画幅。
 *
 * ## 为什么会有这种行
 * v12.468 之前创建页给了 2.35:1:create-pipeline 把它原样写进 `projects.aspect`,编排器 `setAspect`
 * 只认整数比、把它拒掉,按默认 16:9 出片;漫剧 / 短剧题材在 Style Bible 那一步还会再被翻成 9:16
 * (翻转不回写项目行)。于是库里记着 2.35:1,出的却是 16:9 或 9:16。v12.468 起新项目不会再这样,
 * 但**已经写下的行不会自己变回来**。v12.468 之后各生成入口经 `parseProjectAspect` 把这类旧值读成 16:9 ——
 * 对当年被翻成 9:16 的项目,单镜重生出来的就是横屏,和已有镜头接不上。
 *
 * ## 判据
 * 按**已出的素材**量,不按当年的规则反推(那段翻转依赖题材判定、风格关键词长度、构建时的模块解析,
 * 事后还原不可靠):
 *   1. 镜头级素材 —— 单镜视频(排除占位片:v12.467 前占位片一律 1280x720,不代表引擎出的画幅)
 *      与分镜图,ffprobe 量宽高,用 `parseRequestedAspect` 归到三种之一后**投票**,票数唯一最多的那个。
 *      单张图会漂(v12.148 实测 seedream i2i 跟随参考图尺寸),所以看多数,不看第一张。
 *   2. 镜头级量不到或打平 → 最新一版成片。成片排第二:它可能是后来按项目行重合成的(v12.470 起旧行按 16:9),
 *      画布未必是当年引擎出的画幅。
 *   3. 一件都量不到 → `parseRequestedAspect(旧值)`(认不出按 16:9)—— 也就是 v12.468 起各生成入口实际在用的画幅,
 *      这一行记下的就是「以后出片会是什么」。
 * 宽高 → 画幅、旧值 → 画幅,用的都是 `parseRequestedAspect`,与编排器 `setAspect` 同一个函数,不另立判据。
 *
 * ## 怎么跑
 *  - 自动:应用启动后在后台跑一次(instrumentation.ts → `scheduleLegacyAspectRepair`),Docker 镜像里也能跑
 *    (运行镜像不带 lib/ 源码,修复脚本在镜像里跑不起来)。`LEGACY_ASPECT_REPAIR=off` 关闭。
 *  - 手动(源码部署):`npm run repair:aspect` 预览,`-- --apply` 执行,`-- --restore` 撤销。
 * 只碰画幅不在三种之内的行;UPDATE 带旧值守卫(期间被别处改过的行不覆盖);每条改动记进 `data/` 下的账本,可撤销。
 * 不改 `updated_at`(数据修复不该把项目在列表里顶上来)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDbDriver } from './db-driver';
import { listAssetsByType, type AssetRow } from './repos/asset-repo';
import { probeMediaFull } from './film-health';
import { serveFileToLocalPath } from './first-frame';
import { isPlaceholderVideo } from './placeholder-provenance';
import { PROJECT_ASPECTS, parseRequestedAspect, type VideoAspect } from './video-aspect';

export type MediaSource = 'video' | 'storyboard' | 'final_video';
export interface MeasuredMedia { source: MediaSource; width: number; height: number }
export type DecisionBasis = 'shots' | 'final_video' | 'rule';
export interface LegacyAspectDecision { to: VideoAspect; basis: DecisionBasis; detail: string }

const SOURCE_LABEL: Record<MediaSource, string> = { video: '单镜视频', storyboard: '分镜图', final_video: '成片' };

/** 宽高 → 三种画幅之一(与 setAspect 同一个函数);宽高无效 → null。 */
export function aspectOfSize(width: number, height: number): VideoAspect | null {
  if (!(width > 0 && height > 0)) return null;
  return parseRequestedAspect(`${width}:${height}`);
}

/** 纯函数:旧值 + 量到的素材 → 改成什么、凭什么。 */
export function decideLegacyAspect(from: string | null | undefined, media: MeasuredMedia[]): LegacyAspectDecision {
  const shotVotes = new Map<VideoAspect, number>();
  let shotTotal = 0;
  for (const m of media) {
    if (m.source === 'final_video') continue;
    const a = aspectOfSize(m.width, m.height);
    if (!a) continue;
    shotTotal++;
    shotVotes.set(a, (shotVotes.get(a) ?? 0) + 1);
  }
  if (shotTotal > 0) {
    const ranked = [...shotVotes.entries()].sort((x, y) => y[1] - x[1]);
    const [top, topN] = ranked[0];
    if (ranked.length === 1 || ranked[1][1] < topN) {
      return { to: top, basis: 'shots', detail: `镜头素材 ${topN}/${shotTotal} 为 ${top}` };
    }
  }
  const final = media.find((m) => m.source === 'final_video' && aspectOfSize(m.width, m.height));
  if (final) {
    const a = aspectOfSize(final.width, final.height)!;
    const why = shotTotal > 0 ? '镜头素材横竖打平' : '镜头素材量不到';
    return { to: a, basis: 'final_video', detail: `${why},按成片 ${final.width}x${final.height}` };
  }
  const ruled = parseRequestedAspect(from) ?? '16:9';
  return { to: ruled, basis: 'rule', detail: `没有量得到的素材,按现行规则 ${String(from ?? '空')} → ${ruled}` };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

/** 一行素材 → 可量的地址:优先本地落盘副本(serve-file → 本地路径,ffprobe 直读)。 */
function mediaUrlOf(row: AssetRow): string | null {
  const urls = parseJson<string[]>(row.media_urls, []);
  const url = row.persistent_url || urls.find((u) => typeof u === 'string' && u) || '';
  if (!url) return null;
  return serveFileToLocalPath(url) || url;
}

export type ProbeFn = (pathOrUrl: string) => Promise<{ width: number; height: number } | null>;

/** 量一个项目已出的素材。每类最多量 perType 件(素材多的项目不必全量;外链过期会逐个等超时)。 */
export async function measureProjectMedia(projectId: string, opts: { perType?: number; probe?: ProbeFn } = {}): Promise<MeasuredMedia[]> {
  const perType = opts.perType ?? 6;
  const probe: ProbeFn = opts.probe ?? probeMediaFull;
  const out: MeasuredMedia[] = [];
  const measure = async (source: MediaSource, rows: AssetRow[]) => {
    let n = 0;
    for (const row of rows) {
      if (n >= perType) break;
      const target = mediaUrlOf(row);
      if (!target) continue;
      const p = await probe(target).catch(() => null);
      if (p && p.width > 0 && p.height > 0) { out.push({ source, width: p.width, height: p.height }); n++; }
    }
  };
  const videos = (await listAssetsByType(projectId, 'video')).filter((r) => !isPlaceholderVideo({
    data: parseJson<Record<string, unknown>>(r.data, {}),
    mediaUrls: parseJson<string[]>(r.media_urls, []),
    persistentUrl: r.persistent_url ?? null,
  }));
  await measure('video', videos);
  await measure('storyboard', await listAssetsByType(projectId, 'storyboard'));
  const finals = (await listAssetsByType(projectId, 'final_video'))
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1));
  await measure('final_video', finals.slice(0, 1));
  return out;
}

/** 画幅不在三种之内(含空值、带空格的写法)的项目。 */
export async function findLegacyAspectProjects(): Promise<Array<{ id: string; aspect: string | null }>> {
  const placeholders = PROJECT_ASPECTS.map(() => '?').join(', ');
  return getDbDriver().query<{ id: string; aspect: string | null }>(
    `SELECT id, aspect FROM projects WHERE aspect IS NULL OR aspect NOT IN (${placeholders}) ORDER BY created_at`,
    [...PROJECT_ASPECTS],
  );
}

/** 只在该行仍是旧值时改(期间被重跑写过新画幅的行不覆盖);不碰 updated_at。返回是否改到。 */
async function compareAndSetAspect(id: string, from: string | null, to: string): Promise<boolean> {
  const r = from === null
    ? await getDbDriver().run('UPDATE projects SET aspect = ? WHERE id = ? AND aspect IS NULL', [to, id])
    : await getDbDriver().run('UPDATE projects SET aspect = ? WHERE id = ? AND aspect = ?', [to, id, from]);
  return r.changes > 0;
}

export interface LedgerEntry { id: string; from: string | null; to: VideoAspect; basis: DecisionBasis; detail: string; at: string }
export interface RepairChange extends Omit<LedgerEntry, 'at'> { applied: boolean }

export const DEFAULT_LEDGER_PATH = path.join(process.cwd(), 'data', 'legacy-aspect-repaired.json');

function readLedger(ledgerPath: string): LedgerEntry[] {
  try { return fs.existsSync(ledgerPath) ? (JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')) as LedgerEntry[]) : []; } catch { return []; }
}

/** 扫描 + 判定;apply 时逐行改并记账。 */
export async function repairLegacyAspects(opts: { apply: boolean; ledgerPath?: string; probe?: ProbeFn; now?: () => string } = { apply: false }): Promise<{ scanned: number; changes: RepairChange[] }> {
  const rows = await findLegacyAspectProjects();
  const changes: RepairChange[] = [];
  for (const row of rows) {
    const media = await measureProjectMedia(row.id, { probe: opts.probe });
    const d = decideLegacyAspect(row.aspect, media);
    const applied = opts.apply ? await compareAndSetAspect(row.id, row.aspect, d.to) : false;
    changes.push({ id: row.id, from: row.aspect, to: d.to, basis: d.basis, detail: d.detail, applied });
  }
  const done = changes.filter((c) => c.applied);
  if (opts.apply && done.length) {
    const ledgerPath = opts.ledgerPath ?? DEFAULT_LEDGER_PATH;
    const at = (opts.now ?? (() => new Date().toISOString()))();
    const ledger = readLedger(ledgerPath);
    ledger.push(...done.map(({ applied: _a, ...c }) => ({ ...c, at })));
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  }
  return { scanned: rows.length, changes };
}

/** 按账本撤销:只还原仍是本修复写下的值的行(之后被重跑改过的不动)。还原过的条目从账本移除。 */
export async function restoreLegacyAspects(opts: { ledgerPath?: string } = {}): Promise<{ restored: string[]; skipped: string[] }> {
  const ledgerPath = opts.ledgerPath ?? DEFAULT_LEDGER_PATH;
  const ledger = readLedger(ledgerPath);
  const restored: string[] = [];
  const skipped: string[] = [];
  const keep: LedgerEntry[] = [];
  for (const e of [...ledger].reverse()) {
    const r = await getDbDriver().run('UPDATE projects SET aspect = ? WHERE id = ? AND aspect = ?', [e.from, e.id, e.to]);
    if (r.changes > 0) restored.push(e.id); else { skipped.push(e.id); keep.unshift(e); }
  }
  if (ledger.length) fs.writeFileSync(ledgerPath, JSON.stringify(keep, null, 2));
  return { restored, skipped };
}

/**
 * 启动后在后台跑一次自动修复(instrumentation.ts 调)。不阻塞启动、出错只记日志;
 * `LEGACY_ASPECT_REPAIR=off` 关闭。返回定时器(测试用)。
 */
export function scheduleLegacyAspectRepair(opts: {
  env?: Record<string, string | undefined>;
  delayMs?: number;
  run?: () => Promise<{ scanned: number; changes: RepairChange[] }>;
  log?: (msg: string) => void;
} = {}): ReturnType<typeof setTimeout> | null {
  const env = opts.env ?? process.env;
  if ((env.LEGACY_ASPECT_REPAIR || '').trim().toLowerCase() === 'off') return null;
  const log = opts.log ?? ((m: string) => console.log(m));
  const run = opts.run ?? (() => repairLegacyAspects({ apply: true }));
  const timer = setTimeout(() => {
    run().then(({ scanned, changes }) => {
      if (!scanned) return;
      const applied = changes.filter((c) => c.applied);
      for (const c of applied) log(`[legacy-aspect] ${c.id}: ${c.from ?? '空'} → ${c.to}(${c.detail})`);
      log(`[legacy-aspect] 画幅不在三种之内的旧项目 ${scanned} 个,已改正 ${applied.length} 个;账本 data/legacy-aspect-repaired.json,撤销用 npm run repair:aspect -- --restore`);
    }).catch((e) => log(`[legacy-aspect] 自动修复失败(不影响服务):${e instanceof Error ? e.message : e}`));
  }, opts.delayMs ?? 15_000);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
