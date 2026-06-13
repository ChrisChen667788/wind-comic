/**
 * /api/projects/[id]/pull-sheet/replicate (v11.1.2) — 拉片复刻起片(阶段十九杀手锏)。
 *
 * POST {sheetSource?, replacements[], title?, editedPrompts?, aspect?}
 *   sheetSource: 'factory'(默认,本项目出厂真值表)| <pull-sheet 资产 id>(外部拆条表)
 *   → 应用替换(全员换猫级全局指令 / 逐维度 / 参考图)→ 构建复刻脚本(保原片镜头结构/时长)
 *   → 建**新项目** → 入队 create 任务(replicaScript 跳过 Writer 创意)→ 并行生成新片。
 *
 * 返回 {newProjectId, jobId}。需登录 + 源项目归属。
 * 版权:复刻 = 同结构新内容(主体替换 + 重生成),不复制原片素材。
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { listAssetsByType, getAsset } from '@/lib/repos/asset-repo';
import { insertProjectFull, getOwnedProject, deleteProject } from '@/lib/repos/project-repo';
import { getUserFromRequest } from '../../../../auth/lib';
import { buildPullSheetFromScript, type PullSheet } from '@/lib/pull-sheet';
import { applyReplacements, buildReplicaScript, collectRefImages, type ReplaceRule } from '@/lib/pull-sheet-replace';
import { compareReplicaFidelity } from '@/lib/replica-fidelity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function firstUrl(mediaUrls: string | null): string | null {
  const u = parseJson(mediaUrls);
  return Array.isArray(u) && typeof u[0] === 'string' ? u[0] : null;
}

async function loadFactorySheet(projectId: string): Promise<PullSheet> {
  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = parseJson(scriptRows[0]?.data);
  if (!Array.isArray(script?.shots)) {
    const r = db.prepare('SELECT title, script_data FROM projects WHERE id = ?').get(projectId) as
      | { title?: string; script_data?: string } | undefined;
    script = parseJson(r?.script_data) || {};
    if (!script.title && r?.title) script.title = r.title;
  }
  const [storyboards, videos] = await Promise.all([
    listAssetsByType(projectId, 'storyboard'),
    listAssetsByType(projectId, 'video'),
  ]);
  const toRefs = (rows: typeof storyboards) =>
    rows.filter((r) => typeof r.shot_number === 'number')
      .map((r) => ({ shotNumber: r.shot_number as number, url: r.persistent_url || firstUrl(r.media_urls) || '' }))
      .filter((m) => m.url);
  return buildPullSheetFromScript(script || {}, { storyboards: toRefs(storyboards), videos: toRefs(videos) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  // refImage 仅允许 https 外链或站内 serve-file —— 挡 SSRF(http://169.254.169.254 元数据 / file://)
  const safeRef = (u: unknown): string | undefined => {
    if (typeof u !== 'string' || !u.trim()) return undefined;
    const v = u.trim();
    return (/^https:\/\//i.test(v) || v.startsWith('/api/serve-file') || v.startsWith('/')) ? v : undefined;
  };
  const replacements: ReplaceRule[] = Array.isArray(body?.replacements)
    ? body.replacements
        .filter((r: any) => r && typeof r.to === 'string' && r.to.trim() &&
          ['global', 'character', 'scene', 'prop'].includes(r.kind))
        .map((r: any) => ({ kind: r.kind, from: typeof r.from === 'string' ? r.from.slice(0, 60) : '', to: String(r.to).slice(0, 120), refImage: safeRef(r.refImage) }))
    : [];

  // 拉片表来源
  const sheetSource = typeof body?.sheetSource === 'string' ? body.sheetSource : 'factory';
  let sheet: PullSheet;
  if (sheetSource === 'factory') {
    sheet = await loadFactorySheet(id);
  } else {
    const asset = await getAsset(sheetSource);
    if (!asset || asset.project_id !== id || asset.type !== 'pull-sheet') {
      return NextResponse.json({ message: '拉片表不存在' }, { status: 404 });
    }
    sheet = parseJson(asset.data);
  }
  if (!sheet?.shots?.length) return NextResponse.json({ message: '拉片表为空,无法复刻' }, { status: 400 });

  // 替换 → 复刻脚本
  const replicaShots = applyReplacements(sheet, replacements);
  const editedPrompts: Record<number, string> = body?.editedPrompts && typeof body.editedPrompts === 'object'
    ? body.editedPrompts : {};
  const title = (typeof body?.title === 'string' && body.title.trim())
    ? body.title.trim().slice(0, 60) : `${sheet.title} · 复刻`;
  // 预览:返回替换后逐镜 prompt(可编辑)+ 命中参考图 + 复刻保真度对照,不建项目不起片
  if (body?.preview === true) {
    const previewScript = buildReplicaScript(title, replicaShots);
    const fidelity = compareReplicaFidelity(sheet, previewScript);
    return NextResponse.json({
      title,
      shotCount: replicaShots.length,
      shots: replicaShots.map((s) => ({
        shotNumber: s.shotNumber, durationSec: s.durationSec,
        characters: s.characters, scene: s.scene, prompt: s.prompt, refImages: s.refImages,
      })),
      refImages: collectRefImages(replicaShots),
      fidelity,
    });
  }

  const replicaScript = buildReplicaScript(title, replicaShots, { editedPrompts });
  const fidelity = compareReplicaFidelity(sheet, replicaScript);
  const refImages = collectRefImages(replicaShots);
  const aspect = typeof body?.aspect === 'string' ? body.aspect : '9:16';

  // 建新项目
  const newProjectId = nanoid();
  await insertProjectFull({
    id: newProjectId, userId: payload.sub, title, description: replicaScript.synopsis,
    status: 'generating', aspect, primaryCharacterRef: null, lockedCharacters: [],
  });

  const pipelineInput = {
    idea: replicaScript.synopsis, projectId: newProjectId, replicaScript, aspect,
    // 复刻参考图 = 新主体外观,作 character cref;限量挡静默超限丢弃
    references: refImages.slice(0, 6).map((url) => ({ url, elementRole: 'character' })),
  };

  // 入队失败 → 回滚孤儿项目(审查:否则项目永卡 generating)
  try {
    if (process.env.PIPELINE_QUEUE === '1') {
      const { enqueuePipelineJob } = await import('@/lib/repos/pipeline-job-repo');
      const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
      ensurePipelineWorker();
      const job = await enqueuePipelineJob({ type: 'create', projectId: newProjectId, userId: payload.sub, payload: pipelineInput });
      return NextResponse.json({ newProjectId, jobId: job.id, shots: replicaShots.length, queued: true, fidelity });
    }
    // 无队列:后台跑(不阻塞响应),前端轮询新项目
    const { runCreatePipeline } = await import('@/lib/create-pipeline');
    void runCreatePipeline(pipelineInput as any, () => {}).catch((e) => console.error('[replicate] pipeline error:', e));
    return NextResponse.json({ newProjectId, shots: replicaShots.length, queued: false, fidelity });
  } catch (e) {
    await deleteProject(newProjectId, payload.sub).catch(() => {});
    return NextResponse.json({ message: `复刻起片失败:${e instanceof Error ? e.message : '入队异常'}` }, { status: 500 });
  }
}
