/**
 * /api/projects/[id]/regenerate-asset-image (v12.10.0 · #1) — 单张角色/场景图重生。
 *
 * 用户在工坊点某张角色/场景图的「重新生成」→ 只重画这一张,不动其它。
 * 用资产存的 appearance(角色)/ description+location(场景)+ 可选反馈词重建 prompt,
 * styleBible 图作 sref 锁风格;新图持久化后更新该资产的 mediaUrls。
 *
 * 安全:登录 + 属主/可编辑守卫。计费护栏:走主图生成,粗估 ¥0.3。
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { canEditProject } from '@/lib/project-share';
import { upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { getCharacterVisualPrompt, getSceneVisualPrompt } from '@/lib/mckee-skill';
import type { AspectRatio } from '@/lib/image-providers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function parse(raw: string | null | undefined): any { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const owns = proj.user_id === payload.sub || (await canEditProject(id, payload.sub));
  if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any = {}; try { body = await request.json(); } catch {}
  const type = body?.type === 'scene' ? 'scene' : body?.type === 'character' ? 'character' : null;
  const name = typeof body?.name === 'string' ? body.name : '';
  const feedback = (typeof body?.feedback === 'string' ? body.feedback : '').trim().slice(0, 200);
  if (!type || !name) return NextResponse.json({ error: '需要 type(character|scene) 和 name' }, { status: 400 });

  // 预算护栏(与主管线一致,生成前拦)
  const { assertBudget } = await import('@/lib/budget-enforce');
  const b = await assertBudget({ userId: payload.sub, pendingCostCny: 0.3 });
  if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });

  const row = db.prepare(`SELECT id, data FROM project_assets WHERE project_id = ? AND type = ? AND name = ? ORDER BY version DESC LIMIT 1`).get(id, type, name) as any;
  if (!row) return NextResponse.json({ error: `未找到${type === 'character' ? '角色' : '场景'}「${name}」` }, { status: 404 });
  const adata = parse(row.data);

  // styleBible 参考图 → sref 锁全片风格
  const sbRow = db.prepare(`SELECT persistent_url, media_urls FROM project_assets WHERE project_id = ? AND type = 'styleBible' ORDER BY version DESC LIMIT 1`).get(id) as any;
  const styleRef: string | undefined = sbRow?.persistent_url || parse(sbRow?.media_urls)?.[0] || (parse(sbRow?.data)?.url) || undefined;

  let prompt: string;
  let aspectRatio: AspectRatio;
  if (type === 'character') {
    prompt = getCharacterVisualPrompt(name, adata.description || '', adata.appearance || '', '');
    aspectRatio = '3:4';
  } else {
    prompt = getSceneVisualPrompt(adata.description || '', adata.location || name, '');
    aspectRatio = '16:9';
  }
  if (feedback) prompt = `${prompt}. Adjustment per user feedback: ${feedback}`;

  // 生成单图(注册表 dispatch;styleBible 作 sref)
  await import('@/lib/image-providers/builtins');
  const { dispatchImageGenerate } = await import('@/lib/image-providers/registry');
  const gen = await dispatchImageGenerate({ prompt, aspectRatio, sref: styleRef }, { refCount: styleRef ? 1 : 0 });
  if (!gen.result?.imageUrl) {
    return NextResponse.json({ error: '图像生成失败: ' + gen.tried.map((t) => t.error).join(' | ').slice(0, 160) }, { status: 502 });
  }

  // 持久化 + 更新该资产(只换图,data 保留)
  const persisted = await persistAsset(gen.result.imageUrl, { ext: 'png' }).catch(() => null);
  const finalUrl = persisted?.url || gen.result.imageUrl;
  await upsertAsset({ projectId: id, type, name, data: adata, mediaUrls: [finalUrl], persistentUrl: persisted?.url || null });

  return NextResponse.json({ ok: true, imageUrl: finalUrl });
}
