/**
 * /api/projects/[id]/asset-ledger (v10.6.1) — 资产级连续性台账。
 *
 *   GET  自动构建(剧本镜头 × 角色服装/场景/手动道具)→ 与持久化台账合并(人工描述
 *        与手动条目保留)→ 落库(project_assets type='asset_ledger',upsert 幂等)→ 返回
 *   PUT  {entryId, description} 改条目描述 → **返回受影响镜头清单**(验收核心)
 *        并把对应 storyboard/video 置 stale(待重渲/复核)
 *   POST {kind, name, description?} 手动登记(道具为主),引用镜按词即时扫描
 *
 * 读免鉴权(与项目 assets GET 一致按 projectId 作用域);写需登录。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { listAssetsByType, upsertAsset, setAssetsStaleByShots } from '@/lib/repos/asset-repo';
import {
  buildLedger, mergeLedger, applyDescriptionChange, addManualEntry,
  type AssetLedger, type ShotLike, type LedgerKind,
} from '@/lib/asset-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEDGER_TYPE = 'asset_ledger';
const LEDGER_NAME = '连续性台账';

function parseData(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function loadPersisted(projectId: string): Promise<AssetLedger | null> {
  const rows = await listAssetsByType(projectId, LEDGER_TYPE);
  if (!rows.length) return null;
  const d = parseData(rows[rows.length - 1].data);
  return Array.isArray(d?.entries) ? (d as AssetLedger) : null;
}

async function persist(projectId: string, ledger: AssetLedger): Promise<void> {
  await upsertAsset({ projectId, type: LEDGER_TYPE, name: LEDGER_NAME, data: ledger });
}

function loadShots(projectId: string): ShotLike[] {
  const row = db.prepare('SELECT script_data FROM projects WHERE id = ?').get(projectId) as { script_data?: string } | undefined;
  const shots = parseData(row?.script_data)?.shots;
  return Array.isArray(shots) ? shots : [];
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shots = loadShots(id);
  const characters = (await listAssetsByType(id, 'character')).map((r) => {
    const d = parseData(r.data);
    return { name: r.name, appearance: d.appearance, costume: d.costume, description: d.description };
  });
  const scenes = (await listAssetsByType(id, 'scene')).map((r) => ({ name: r.name, description: parseData(r.data).description }));

  const prev = await loadPersisted(id);
  const ledger = mergeLedger(prev, buildLedger({ shots, characters, scenes }));
  await persist(id, ledger);
  return NextResponse.json(ledger);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const entryId = typeof body?.entryId === 'string' ? body.entryId : '';
  const description = typeof body?.description === 'string' ? body.description.slice(0, 300) : '';
  if (!entryId) return NextResponse.json({ message: '缺 entryId' }, { status: 400 });

  const ledger = await loadPersisted(id);
  if (!ledger) return NextResponse.json({ message: '台账未初始化(先 GET)' }, { status: 404 });
  const changed = applyDescriptionChange(ledger, entryId, description);
  if (!changed) return NextResponse.json({ message: '条目不存在' }, { status: 404 });

  await persist(id, changed.ledger);
  // 启发式漂移处理:受影响镜头的分镜图/视频置 stale(待重渲/复核)。
  // BYO Vision 增强(条目描述 vs 画面 比对打分)见 docs/algorithms.md。
  const staleMarked = await setAssetsStaleByShots(id, ['storyboard', 'video'], changed.affectedShots, true);
  return NextResponse.json({ entry: changed.entry, affectedShots: changed.affectedShots, staleMarked });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const kind = (['costume', 'scene', 'prop'] as LedgerKind[]).includes(body?.kind) ? (body.kind as LedgerKind) : 'prop';
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!name.trim()) return NextResponse.json({ message: '缺 name' }, { status: 400 });

  const ledger = (await loadPersisted(id)) ?? { entries: [] };
  const next = addManualEntry(ledger, { kind, name, description: body?.description }, loadShots(id));
  if (next === ledger) return NextResponse.json({ message: '同名条目已存在' }, { status: 409 });
  await persist(id, next);
  return NextResponse.json(next, { status: 201 });
}
