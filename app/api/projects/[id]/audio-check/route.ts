/**
 * /api/projects/[id]/audio-check (v12.1.1) — 成片音频体检 + 自愈。
 *
 * GET → 最新 final_video:ffprobe 是否含音频流 + 可听性(有 BGM/配音才听得到)。
 *   完全缺音频流(极端)→ 自愈 remux 补静音 aac,保证可播,并把 final_video 的本地副本替换。
 * 读免鉴权(与项目其它只读端点一致)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { probeAudioStream, ensureAudioStream, audibilityLabel } from '@/lib/audio-health';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** serve-file?path= / 绝对路径 → 本地文件路径(仅本地副本可 ffprobe)。 */
function localPathOf(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('/api/serve-file')) {
    try {
      const u = new URL(url, 'http://localhost');
      const p = u.searchParams.get('path');
      if (p && fs.existsSync(p)) return p;
    } catch { /* ignore */ }
    return null;
  }
  if (url.startsWith('/') && fs.existsSync(url)) return url;
  return null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await listAssetsByType(id, 'final_video');
  if (!rows.length) return NextResponse.json({ exists: false });

  const latest = rows[rows.length - 1];
  const data = parseJson(latest.data) || {};
  const mediaUrls = parseJson(latest.media_urls) || [];
  const url = latest.persistent_url || mediaUrls[0] || '';

  // 可听性:落库时已存 hasBgm/hasVoiceover(v12.1.1);老成片无此字段 → 据 ffprobe 兜底
  const audibility = audibilityLabel({ hasBgm: data.hasBgm, hasVoiceover: data.hasVoiceover });

  const localPath = localPathOf(url);
  let hasAudioStream: boolean | null = null;
  let healed = false;
  if (localPath) {
    hasAudioStream = await probeAudioStream(localPath);
    if (hasAudioStream === false) {
      const r = await ensureAudioStream(localPath);
      healed = r.healed;
      if (r.healed) hasAudioStream = true;
    }
  }

  return NextResponse.json({
    exists: true,
    url,
    hasAudioStream,                    // true=有音轨流 / false=无 / null=无法探测(远端)
    audible: audibility.audible,       // 是否听得到声(有 BGM/配音)
    label: audibility.label,
    sources: audibility.sources,
    healed,                            // 是否自愈补了静音轨
  });
}
