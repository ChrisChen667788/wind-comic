/**
 * POST /api/mv/detect-bpm (v12.351) —— 从 BGM 自动测 BPM。
 *
 * 病根:`lib/beat-detect.detectBeats` 从 v12.246 就在,但 MV 页始终是
 * `useState(120)` + 手填数字框 —— 检测造好了没接线,用户得自己数拍子。
 *
 * body: { musicUrl: string }   —— serve-file URL / 本地路径均可
 * 200 → { ok, bpm, confidence, beats, intervals, source }
 * 409 → { ok:false, reason }   —— 测不出就说测不出,**不返回一个编出来的数**
 *
 * 只读音频、不生成任何内容,所以不计费;仍要求登录,避免拿它当任意文件探测器。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { detectBeats, bpmFromBeats } from '@/lib/beat-detect';
import { resolveByKey } from '@/lib/asset-storage';
import { isServeFilePathAllowed } from '@/lib/serve-file-sign';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { musicUrl?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const raw = (body.musicUrl || '').trim();
  if (!raw) return NextResponse.json({ error: '需要 musicUrl' }, { status: 400 });

  // 解析成本地路径。**只接受本仓存储内的文件** —— 否则这个端点就成了任意文件探测器
  // (给它 /etc/passwd,ffmpeg 的报错方式能反推出文件在不在)。
  let localPath: string | null = null;
  const k = raw.match(/key=([0-9a-zA-Z_-]+)/);
  if (k) {
    localPath = resolveByKey(k[1])?.absPath || null;
  } else if (raw.startsWith('/') && !raw.startsWith('/api/')) {
    localPath = isServeFilePathAllowed(raw) ? raw : null;
  }
  if (!localPath || !fs.existsSync(localPath)) {
    return NextResponse.json({
      ok: false,
      reason: '只能对已落盘的本地素材测 BPM —— 外链音频请先上传/落盘',
    }, { status: 409 });
  }

  const beats = await detectBeats(localPath);
  const r = bpmFromBeats(beats);
  if (!r) {
    return NextResponse.json({
      ok: false,
      reason: `拍点不足(检测到 ${beats.length} 个),测不出可靠 BPM —— 请手动填写`,
      beats: beats.length,
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    bpm: r.bpm,
    confidence: r.confidence,
    beats: beats.length,
    intervals: r.intervals,
    // 诚实:低置信度要让调用方看得见,而不是给个数字了事
    note: r.confidence < 0.6
      ? '拍点不齐(可能漏拍或曲子节奏多变),这个 BPM 仅供参考,建议试听后手动校正'
      : undefined,
  });
}
