/**
 * lib/publish-dispatch (v12.3.3) — 发布取件 + 组装(阶段二十二)。
 *
 * 把「从项目 DB 资产取分发文案/成片/封面 → buildPublishPackage」抽成一处,
 * 供 GET /publish-package、POST /publish、定时 worker 三处复用(此前 GET/POST 各抄一份)。
 * 纯数据读 + 纯函数组装,无鉴权/无外发(那些由各路由/scheduler 自己把关)。
 */
import { db } from './db';
import { getPlatformSpec, type PlatformPack } from './distribution';
import { buildPublishPackage, type PublishPackage } from './publish-package';

function parse(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/**
 * 取项目某平台的可直发包。
 * 封面:定版封面(chosen-cover v12.3.2)优先,否则封面候选首张。
 * 平台成片:已按该平台 aspect 导好的成片(platform_video)优先,否则原片。
 */
export function assembleProjectPackage(projectId: string, platform: string): { spec: ReturnType<typeof getPlatformSpec>; bundle: PublishPackage } | null {
  const spec = getPlatformSpec(platform);
  if (!spec) return null;

  // 分发文案 → 该平台 PlatformPack
  const distRow = db.prepare(`SELECT data FROM project_assets WHERE project_id = ? AND type = 'distribution' ORDER BY version DESC LIMIT 1`).get(projectId) as any;
  const distData = parse(distRow?.data);
  const pack: PlatformPack | null = Array.isArray(distData?.platforms)
    ? (distData.platforms.find((p: any) => p?.platform === platform) ?? null) : null;

  // 原成片
  const finalRow = db.prepare(`SELECT media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`).get(projectId) as any;
  const finalUrls = parse(finalRow?.media_urls) || [];
  const finalVideoUrl = finalRow?.persistent_url || finalUrls[0] || null;

  // 已按平台 aspect 导好的成片(export-platform 落 type='platform_video',data.aspect 标记)
  let platformVideoUrl: string | null = null;
  const pvRow = db.prepare(`SELECT persistent_url, media_urls, data FROM project_assets WHERE project_id = ? AND type = 'platform_video' ORDER BY version DESC LIMIT 1`).get(projectId) as any;
  if (pvRow && (parse(pvRow.data)?.aspect ?? spec.aspect) === spec.aspect) {
    platformVideoUrl = pvRow.persistent_url || (parse(pvRow.media_urls) || [])[0] || null;
  }

  // 封面:定版优先,否则候选首张
  const chosenRow = db.prepare(`SELECT persistent_url, media_urls FROM project_assets WHERE project_id = ? AND type = 'chosen-cover' ORDER BY version DESC LIMIT 1`).get(projectId) as any;
  let coverUrl: string | null = chosenRow?.persistent_url || (parse(chosenRow?.media_urls) || [])[0] || null;
  if (!coverUrl) {
    const covRow = db.prepare(`SELECT data FROM project_assets WHERE project_id = ? AND type = 'cover-candidates' ORDER BY version DESC LIMIT 1`).get(projectId) as any;
    const cands = parse(covRow?.data)?.candidates;
    if (Array.isArray(cands) && cands.length) coverUrl = cands[0]?.imageUrl || cands[0]?.url || null;
  }

  const bundle = buildPublishPackage(spec, pack, { finalVideoUrl, platformVideoUrl, coverUrl });
  return { spec, bundle };
}
