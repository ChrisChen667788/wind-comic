import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { parseProfile } from '@/lib/character-studio';
import type { MentionableAsset } from '@/lib/prompt-ide';

export const runtime = 'nodejs';

/**
 * v6.1 — Prompt IDE 可引用资产清单.
 * GET /api/prompt-ide/assets  → 当前用户可被 @ 引用的资产 (角色库 + 全局资产),
 * 编辑器据此做自动补全 + 编译展开. expansion = @name 在最终 prompt 里替换成的文本.
 */
export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;
  if (!userId) {
    const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    userId = first?.id || 'demo-user';
  }

  const out: MentionableAsset[] = [];
  const seen = new Set<string>(); // 按名字去重 (角色库优先于 global_assets)

  // 1) 角色库 — 身份块优先 (v6.0 档案), 退而用 appearance/description
  try {
    const rows = db.prepare(
      'SELECT id, name, appearance, description, profile FROM character_library WHERE user_id = ? ORDER BY usage_count DESC, created_at DESC',
    ).all(userId) as any[];
    for (const r of rows) {
      const key = (r.name || '').toLowerCase();
      if (!r.name || seen.has(key)) continue;
      const prof = parseProfile(r.profile);
      const expansion = (prof?.identityBlock && prof.identityBlock.trim())
        || (r.appearance && r.appearance.trim())
        || (r.description && r.description.trim())
        || r.name;
      out.push({ id: r.id, kind: 'character', name: r.name, expansion });
      seen.add(key);
    }
  } catch { /* ignore */ }

  // 2) 全局资产 — character/scene/style/prop; 视觉锚优先, 退而用 description
  try {
    const rows = db.prepare(
      'SELECT id, type, name, description, visual_anchors FROM global_assets WHERE user_id = ? ORDER BY updated_at DESC',
    ).all(userId) as any[];
    for (const r of rows) {
      const key = (r.name || '').toLowerCase();
      if (!r.name || seen.has(key)) continue;
      const kind = ['character', 'scene', 'style', 'prop'].includes(r.type) ? r.type : 'prop';
      let anchors: string[] = [];
      try { anchors = JSON.parse(r.visual_anchors || '[]'); } catch { anchors = []; }
      const expansion = (anchors.length ? anchors.join(', ') : '')
        || (r.description && r.description.trim())
        || r.name;
      out.push({ id: r.id, kind, name: r.name, expansion });
      seen.add(key);
    }
  } catch { /* ignore */ }

  return NextResponse.json({ assets: out });
}
