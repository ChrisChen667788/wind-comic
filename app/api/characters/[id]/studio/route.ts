import { NextRequest, NextResponse } from 'next/server';
import { buildProfileFromLibraryRow, serializeProfile, parseProfile } from '@/lib/character-studio';
import { getCharacter, updateCharacterProfile } from '@/lib/repos/character-repo'; // v9.0.3c: async, 双驱动

export const runtime = 'nodejs';

/**
 * v6.0.1 — 角色资产中心接线.
 *
 * GET  /api/characters/[id]/studio        → 已落库的档案; 没有则按当前行实时构建一份返回
 * POST /api/characters/[id]/studio        → 构建角色档案 (小传 + 绑定音色 + 多视角设定图 prompt),
 *                                            落库 character_library.profile, 返回档案
 *   body: { generate?: boolean, style?: string }
 *   - generate=false (默认): 只出 prompt + 小传 + 音色, 不调图像引擎 (零成本, 即时)
 *   - generate=true: 逐视图调 image provider 链真出图, 把 imageUrl 填回 turnaround + image_urls
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getCharacter(id);
  if (!row) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  // 已落库优先; 否则实时构建 (不落库)
  const stored = parseProfile(row.profile);
  const profile = stored ?? buildProfileFromLibraryRow(row);
  return NextResponse.json({ profile, persisted: !!stored });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getCharacter(id);
  if (!row) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({} as any));
  const generate = body?.generate === true;
  const style: string | undefined = typeof body?.style === 'string' ? body.style : undefined;

  const profile = buildProfileFromLibraryRow(row, { style });

  // generate=true: 逐视图真出图 (best-effort, 单视图失败不影响其它); 缺 key/provider 时静默跳过.
  const generatedUrls: string[] = [];
  if (generate) {
    try {
      const { dispatchImageGenerate } = await import('@/lib/image-providers/registry');
      await import('@/lib/image-providers/builtins'); // 触发内置 provider 注册
      for (const view of profile.turnaround) {
        try {
          const { result } = await dispatchImageGenerate({ prompt: view.prompt }, { refCount: 0 });
          if (result?.imageUrl) {
            view.imageUrl = result.imageUrl; // v12.2.6: TurnaroundView.imageUrl 已类型化,去 as any
            generatedUrls.push(result.imageUrl);
          }
        } catch { /* 单视图失败跳过 */ }
      }
    } catch { /* provider 不可用 (无 key 等) → 退化成纯 prompt 档案 */ }
  }

  // 落库: profile JSON; 若真出了图, 也把图并进 image_urls (去重, 原有在前)
  // v9.0.3c: 走 character-repo (双驱动)
  if (generatedUrls.length > 0) {
    let existing: string[] = [];
    try { existing = JSON.parse(row.image_urls || '[]'); } catch { existing = []; }
    const merged = Array.from(new Set([...existing, ...generatedUrls]));
    await updateCharacterProfile(id, serializeProfile(profile), merged);
  } else {
    await updateCharacterProfile(id, serializeProfile(profile));
  }

  return NextResponse.json({ profile, generated: generatedUrls.length, persisted: true });
}
