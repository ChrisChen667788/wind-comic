import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';

export const runtime = 'nodejs';

// POST /api/assets/confirm — 确认某个环节的资产，自动入库
export async function POST(request: NextRequest) {
  try {
    const { projectId, agentRole, assets } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // 根据 agentRole 确定要确认的资产类型
    const roleTypeMap: Record<string, string[]> = {
      writer: ['script'],
      character_designer: ['character'],
      scene_designer: ['scene'],
      storyboard: ['storyboard'],
      video_producer: ['video'],
      editor: ['timeline', 'final_video', 'music', 'video'],
      producer: ['final_video'],
    };

    const types = roleTypeMap[agentRole] || [];

    if (types.length > 0) {
      const placeholders = types.map(() => '?').join(',');
      const result = db.prepare(
        `UPDATE project_assets SET confirmed = 1, updated_at = ? WHERE project_id = ? AND type IN (${placeholders})`
      ).run(now(), projectId, ...types);

      console.log(`[API] Confirmed ${result.changes} assets for ${agentRole} in project ${projectId}`);
    }

    // 如果传入了具体的 assets 数组，也逐个确认
    if (assets && Array.isArray(assets)) {
      for (const asset of assets) {
        if (asset.id) {
          db.prepare('UPDATE project_assets SET confirmed = 1, updated_at = ? WHERE id = ?')
            .run(now(), asset.id);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[API] Asset confirm failed:', e);
    return NextResponse.json({ error: 'Failed to confirm assets' }, { status: 500 });
  }
}
