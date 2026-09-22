/**
 * /api/projects/[id]/ref-video · v12.448 — 每镜「动作参考视频」。
 *
 * GET  ?shot=N → 该镜挂的参考视频;不带 shot → 全部挂了的镜(镜头工坊打标用)
 * POST         → 挂/换:JSON `{ shotNumber, url }`(公网链接)或 multipart `shotNumber + file`(本地上传)
 * DELETE ?shot=N → 取下
 *
 * 权限:读 view / 写 edit。写不花钱,但会改变后续出片(按参考视频的动作生成)—— 只读协作者不能改。
 * 返回里带 `h3KnownUnavailable`:本进程已确认当前 key 用不了 H3 时,界面要直说「挂上也会被忽略」。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { getShotRefVideo, listShotRefVideos, saveShotRefVideo, deleteShotRefVideo } from '@/lib/shot-ref-video-store';
import { isH3KnownUnavailable } from '@/lib/h3-availability';
import { REF_VIDEO_LIMITS } from '@/lib/ref-video';
// 静态导入:ref-video-ingest 本身很轻(ffmpeg 路径在它内部用到时才加载),不必为 GET 省这一次加载
import { ingestRefVideo } from '@/lib/ref-video-ingest';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 同时在处理的上传数上限。一个接近上限的上传峰值要占 ~150MB(请求体 + 解析 + 截取后转 base64 + 落盘),
 * 并发不设限就能把进程内存顶满(对抗复查挖出)。超出直接 429 —— 在**读请求体之前**拒,拒掉的不占内存。
 */
const MAX_CONCURRENT_INGEST = 2;
let ingesting = 0;

/**
 * 边读边计字节,超过 cap 立即中止并返回 null。不能只看 Content-Length:分块上传(Transfer-Encoding: chunked)
 * 不带这个头,formData() 会把任意大的请求体整个读进内存才轮到后面判大小(对抗复查挖出)。
 */
async function readBodyCapped(req: Request, cap: number): Promise<Buffer | null> {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0); // 没有请求体:交给调用方按「空」处理(不是超限)
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      try { await reader.cancel(); } catch { /* 已经在拒了 */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

const shotOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'view');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });
  const h3KnownUnavailable = isH3KnownUnavailable();
  const raw = new URL(request.url).searchParams.get('shot');
  if (raw == null) return NextResponse.json({ items: await listShotRefVideos(id), h3KnownUnavailable });
  const shot = shotOf(raw);
  if (!shot) return NextResponse.json({ error: '镜号 shot 不合法' }, { status: 400 });
  return NextResponse.json({ shotNumber: shot, refVideo: await getShotRefVideo(id, shot), h3KnownUnavailable });
}

/** 留 1MB 给 multipart 的边界与其它字段 */
const UPLOAD_CAP = REF_VIDEO_LIMITS.maxBytes + 1024 * 1024;
/** 链接请求体只有镜号 + 一个 URL,正常远小于 1KB。JSON 分支同样要封顶:request.json() 会把任意大的请求体整个读进内存(对抗复查第三轮挖出) */
const JSON_BODY_CAP = 16 * 1024;
const tooBig = () => NextResponse.json({ error: `文件超过 ${REF_VIDEO_LIMITS.maxBytes / 1048576}MB` }, { status: 413 });

async function handleUpload(request: NextRequest, id: string, ct: string): Promise<NextResponse> {
  const raw = await readBodyCapped(request, UPLOAD_CAP);
  if (!raw) return tooBig();
  if (raw.byteLength === 0) return NextResponse.json({ error: '请求体为空' }, { status: 400 });
  let form: FormData;
  try {
    form = await new Request(request.url, { method: 'POST', headers: { 'content-type': ct }, body: new Uint8Array(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength) }).formData(); // 视图,不再拷一份(Buffer.concat 分配的是普通 ArrayBuffer)
  } catch {
    // 格式错(缺边界、截断)是请求本身的问题 —— 回 400 让客户端改请求,不是 500 让它重试
    return NextResponse.json({ error: '上传内容不是合法的 multipart 表单' }, { status: 400 });
  }
  const shot = shotOf(form.get('shotNumber'));
  const file = form.get('file');
  if (!shot) return NextResponse.json({ error: '缺少镜号 shotNumber' }, { status: 400 });
  if (!(file instanceof Blob)) return NextResponse.json({ error: '缺少文件 file' }, { status: 400 });
  if (file.size > REF_VIDEO_LIMITS.maxBytes) return tooBig();
  const r = await ingestRefVideo(Buffer.from(await file.arrayBuffer()), file.type, (uri, hint) => persistAsset(uri, hint));
  // 服务器自身故障回 500(可重试 / 找部署方);文件本身不合规才是 422
  if (!r.ok) return NextResponse.json({ error: r.errors.join(';'), errors: r.errors }, { status: r.server ? 500 : 422 });
  const refVideo = {
    shotNumber: shot, url: r.url, source: 'upload' as const,
    durationSec: Math.round(r.probe.durationSec * 10) / 10,
    width: r.probe.width, height: r.probe.height, sizeBytes: r.probe.sizeBytes ?? undefined,
    ...(r.trimmedFrom ? { trimmedFrom: Math.round(r.trimmedFrom * 10) / 10 } : {}),
  };
  await saveShotRefVideo(id, refVideo);
  return NextResponse.json({ ok: true, refVideo, h3KnownUnavailable: isH3KnownUnavailable() });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'edit');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.startsWith('multipart/form-data')) {
      // 声明了长度且超限:一个字节都不读就拒
      if (Number(request.headers.get('content-length') || 0) > UPLOAD_CAP) return tooBig();
      if (ingesting >= MAX_CONCURRENT_INGEST) {
        return NextResponse.json({ error: '正在处理别的参考视频上传,请稍后再试' }, { status: 429 });
      }
      ingesting++;
      try { return await handleUpload(request, id, ct); } finally { ingesting--; }
    }

    if (Number(request.headers.get('content-length') || 0) > JSON_BODY_CAP) return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    const rawJson = await readBodyCapped(request, JSON_BODY_CAP);
    if (!rawJson) return NextResponse.json({ error: '请求体过大' }, { status: 413 });
    let body: any;
    try { body = JSON.parse(rawJson.toString('utf8')); } catch { return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 }); }
    const shot = shotOf(body?.shotNumber);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!shot) return NextResponse.json({ error: '缺少镜号 shotNumber' }, { status: 400 });
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: '链接必须以 http:// 或 https:// 开头' }, { status: 400 });
    // 链接会原样交给 MiniMax 去下载;本站不下载它,但仍拦内网地址 —— 不让本站成为探测内网的跳板,
    // 也免得用户把 localhost 链接挂上去、到出片时才被引擎拒。
    const { assertOutboundUrlSafe } = await import('@/lib/ssrf-guard');
    const verdict = await assertOutboundUrlSafe(url);
    if (!verdict.ok) {
      // 详细原因(可能含服务端解析出的内网 IP)只进日志 —— 原样回给客户端等于帮人枚举内网(对抗复查挖出)
      console.warn(`[ref-video] 链接被拦:${verdict.reason}`);
      return NextResponse.json({ error: '链接不可用:指向内网或无法访问的地址,请换一个公网视频链接' }, { status: 400 });
    }
    const refVideo = { shotNumber: shot, url, source: 'link' as const };
    await saveShotRefVideo(id, refVideo);
    return NextResponse.json({ ok: true, refVideo, h3KnownUnavailable: isH3KnownUnavailable() });
  } catch (e) {
    // 详细原因只进服务端日志:数据库 / 文件系统的报错里可能带内部路径
    console.error('[ref-video] POST failed:', e);
    return NextResponse.json({ error: '保存失败,请重试' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'edit');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });
  const shot = shotOf(new URL(request.url).searchParams.get('shot'));
  if (!shot) return NextResponse.json({ error: '镜号 shot 不合法' }, { status: 400 });
  const removed = await deleteShotRefVideo(id, shot);
  return NextResponse.json({ ok: true, removed });
}
