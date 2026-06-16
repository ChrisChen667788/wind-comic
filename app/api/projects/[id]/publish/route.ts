/**
 * /api/projects/[id]/publish (v12.3.1) — 发布动作:闸门 + 记录(阶段二十二)。
 *
 * POST {platform} → 闸门顺序:
 *   1. 登录(401)  2. 属主/可编辑(403)  3. 计费 gate creator+(402)
 *   4. 质量门禁硬拦:evaluateQualityGate level='block' → 422(把 advisory 变硬拦)
 *   5. 组装可直发包(buildPublishPackage)+ 生成/复用 share token + 落 publish_records。
 * 状态 = 'packaged'(包就绪 + 分享链接);真上传(status='published')在 v12.3.3。
 * GET → 列发布记录。
 *
 * 安全:发布是 outward-facing —— 强制登录 + 属主守卫;此刀不外发任何内容(只打包+记录)。
 */
import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { updateProjectById } from '@/lib/repos/project-repo';
import { canEditProject } from '@/lib/project-share';
import { checkPlan, planRejection } from '@/lib/plan-gate';
import { getProjectAudits, aggregateFilmAudit } from '@/lib/vision-audit';
import { getLatestQualityScore } from '@/lib/quality-scores';
import { evaluateQualityGate } from '@/lib/quality-gate';
import { isPlatformId, getPlatformSpec, type PlatformPack } from '@/lib/distribution';
import { buildPublishPackage } from '@/lib/publish-package';
import { recordPublish, listPublishRecords } from '@/lib/repos/publish-record-repo';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parse(raw: string | null | undefined): any { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ records: await listPublishRecords(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. 登录(发布是 outward-facing,强制真鉴权)
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. 属主 / 可编辑守卫
  const proj = db.prepare('SELECT id, user_id, share_token FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const owns = proj.user_id === payload.sub || (await canEditProject(id, payload.sub));
  if (!owns) return NextResponse.json({ error: 'Forbidden: 非项目所有者/可编辑者' }, { status: 403 });

  let body: any = {}; try { body = await request.json(); } catch {}
  const platform = body?.platform;
  if (!isPlatformId(platform)) return NextResponse.json({ error: 'platform 非法' }, { status: 400 });
  const spec = getPlatformSpec(platform)!;

  // 3. 计费 gate —— 发布锁 creator+
  const planGate = checkPlan(request, 'creator');
  if (!planGate.ok) return planRejection(planGate.current, planGate.required);

  // 4. 质量门禁硬拦(block → 422,不再只是 advisory 徽章)
  const audits = await getProjectAudits(id);
  const filmAudit = audits.length ? aggregateFilmAudit(audits) : null;
  const qualityScore = await getLatestQualityScore(id);
  const qgate = evaluateQualityGate({ filmAudit, qualityScore });
  if (qgate.level === 'block') {
    return NextResponse.json({ error: 'publish_blocked', message: '质量门禁未通过(block),先修复最弱镜再发布', gate: qgate }, { status: 422 });
  }

  // 5. 组装可直发包
  const distData = parse((db.prepare(`SELECT data FROM project_assets WHERE project_id=? AND type='distribution' ORDER BY version DESC LIMIT 1`).get(id) as any)?.data);
  const pack: PlatformPack | null = Array.isArray(distData?.platforms) ? (distData.platforms.find((p: any) => p?.platform === platform) ?? null) : null;
  const finalRow = db.prepare(`SELECT media_urls, persistent_url FROM project_assets WHERE project_id=? AND type='final_video' ORDER BY version DESC LIMIT 1`).get(id) as any;
  const finalUrls = parse(finalRow?.media_urls) || [];
  const bundle = buildPublishPackage(spec, pack, { finalVideoUrl: finalRow?.persistent_url || finalUrls[0] || null });

  // 6. 生成/复用 share token
  let token: string | null = proj.share_token || null;
  if (!token) { token = nanoid(18); await updateProjectById(id, { share_token: token, share_created_at: now() }); }
  const shareUrl = `/share/${token}`;

  // 7. 落发布记录(packaged —— 真上传在 v12.3.3)
  const record = await recordPublish({ projectId: id, platform, status: 'packaged', shareUrl, title: bundle.title });

  return NextResponse.json({ ok: true, status: 'packaged', shareUrl, package: bundle, record, qualityGate: { level: qgate.level, ready: qgate.ready } });
}
