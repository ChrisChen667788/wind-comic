/**
 * /api/projects/[id]/publish (v12.3.1 → v12.3.3) — 发布动作:闸门 + 记录 + (定时/真上传)。
 *
 * POST {platform, scheduledAt?, upload?, confirmUpload?} → 闸门顺序:
 *   1. 登录(401)  2. 属主/可编辑(403)  3. 计费 gate creator+(402)
 *   4. 质量门禁硬拦:evaluateQualityGate level='block' → 422(把 advisory 变硬拦)
 *   5a. scheduledAt(未来 ISO)→ 排定定时发布(scheduled_publishes)+ 记录 status='scheduled'。
 *   5b. 否则 → 组装可直发包 + 生成/复用 share token:
 *        · upload!=true → 仅打包(status='packaged')。
 *        · upload=true  → 经适配器:youtube 已配 token + confirmUpload → 真传(published/failed);
 *                          国内平台/无 token → 诚实降级(manual,返回手动上传指引,status 仍 packaged)。
 * GET → 列发布记录。
 *
 * 安全:发布是 outward-facing —— 强制登录 + 属主守卫;真上传需 confirmUpload=true,绝不擅自外发。
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
import { isPlatformId } from '@/lib/distribution';
import { assembleProjectPackage } from '@/lib/publish-dispatch';
import { recordPublish, listPublishRecords } from '@/lib/repos/publish-record-repo';
import { schedulePublish, listScheduledPublishes, cancelScheduledPublish } from '@/lib/repos/scheduled-publish-repo';
import { getPublishAdapter } from '@/lib/publish-adapters';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({
    records: await listPublishRecords(id),
    scheduled: await listScheduledPublishes(id),
  });
}

/** DELETE {scheduleId} → 取消一条 pending 定时发布(登录 + 属主守卫)。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const owns = proj.user_id === payload.sub || (await canEditProject(id, payload.sub));
  if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let body: any = {}; try { body = await request.json(); } catch {}
  const scheduleId = body?.scheduleId;
  if (!scheduleId) return NextResponse.json({ error: '缺 scheduleId' }, { status: 400 });
  const canceled = await cancelScheduledPublish(scheduleId, payload.sub);
  return NextResponse.json({ ok: canceled, canceled });
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

  // 5a. 定时发布:排期到未来某 ISO 时间 → 落 scheduled_publishes,worker 到点经适配器发
  const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : null;
  if (scheduledAt) {
    const when = new Date(scheduledAt).getTime();
    if (Number.isNaN(when)) return NextResponse.json({ error: 'scheduledAt 不是合法时间' }, { status: 400 });
    if (when <= Date.now()) return NextResponse.json({ error: 'scheduledAt 必须是未来时间' }, { status: 400 });
    const sched = await schedulePublish({ projectId: id, platform, scheduledAt, createdBy: payload.sub });
    const assembled = assembleProjectPackage(id, platform);
    const record = await recordPublish({ projectId: id, platform, status: 'scheduled', title: assembled?.bundle.title ?? '' });
    return NextResponse.json({ ok: true, status: 'scheduled', scheduled: sched, record, qualityGate: { level: qgate.level, ready: qgate.ready } });
  }

  // 5b. 即时:组装可直发包
  const assembled = assembleProjectPackage(id, platform);
  if (!assembled) return NextResponse.json({ error: 'platform 非法' }, { status: 400 });
  const bundle = assembled.bundle;

  // 生成/复用 share token
  let token: string | null = proj.share_token || null;
  if (!token) { token = nanoid(18); await updateProjectById(id, { share_token: token, share_created_at: now() }); }
  const shareUrl = `/share/${token}`;

  // 真上传(可选,默认关):经适配器。youtube 已配 token + confirmUpload → 真传;否则诚实降级。
  let upload: any = null;
  let recordStatus: 'packaged' | 'published' | 'failed' = 'packaged';
  let externalUrl: string | null = null;
  if (body?.upload === true) {
    const adapter = getPublishAdapter(platform);
    const up = await adapter.upload(bundle, { confirmed: body?.confirmUpload === true });
    upload = up;
    if (up.status === 'published') { recordStatus = 'published'; externalUrl = up.externalUrl; }
    else if (up.status === 'failed') { recordStatus = 'failed'; }
    // up.status === 'manual' → 保持 packaged(已出包,待手动上传)
  }

  // 落发布记录
  const record = await recordPublish({
    projectId: id, platform, status: recordStatus, shareUrl, title: bundle.title,
    externalUrl, publishedAt: recordStatus === 'published' ? now() : null,
  });

  return NextResponse.json({
    ok: recordStatus !== 'failed',
    status: recordStatus,
    shareUrl,
    package: bundle,
    upload,
    record,
    qualityGate: { level: qgate.level, ready: qgate.ready },
  });
}
