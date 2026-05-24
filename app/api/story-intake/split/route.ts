import { NextRequest, NextResponse } from 'next/server';
import { splitIntoEpisodes, getNarrationMode } from '@/lib/story-intake';

export const runtime = 'nodejs';

/**
 * v6.2 — 长篇拆解概览.
 * POST /api/story-intake/split  { text, targetChars?, maxEpisodes?, narrationMode? }
 *   → { total, episodes:[{index,title,charCount,preview}], narration }
 * (纯逻辑在 lib/story-intake, client 也可直接用; 此 API 给服务端/编排复用一个稳定契约.)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return NextResponse.json({ message: '缺少 text' }, { status: 400 });

  const episodes = splitIntoEpisodes(text, {
    targetChars: typeof body?.targetChars === 'number' ? body.targetChars : undefined,
    maxEpisodes: typeof body?.maxEpisodes === 'number' ? body.maxEpisodes : undefined,
  });
  const n = getNarrationMode(body?.narrationMode);

  return NextResponse.json({
    total: episodes.length,
    episodes: episodes.map((e) => ({ index: e.index, title: e.title, charCount: e.charCount, preview: e.text.slice(0, 140) })),
    narration: { id: n.id, label: n.label, directive: n.directive, generatesNarrationTrack: n.generatesNarrationTrack },
  });
}
