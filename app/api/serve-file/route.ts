import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveByKey } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/serve-file
 * 支持三种模式:
 *   1) ?key=<sha256>              持久化资产(v2.9+),服务 data/storage/assets/ 下的文件
 *   2) ?path=/tmp/xxx/final.mp4   兼容 v2.8 及之前的 /tmp 临时路径
 *   3) ?proxy=<http-url>          外链代理(Midjourney/Minimax 过期 CDN 的兜底)
 */
export async function GET(request: NextRequest) {
  const keyParam = request.nextUrl.searchParams.get('key');
  const filePath = request.nextUrl.searchParams.get('path');
  const proxyUrl = request.nextUrl.searchParams.get('proxy');

  // ── 模式 1: 持久化资产 ──
  if (keyParam) {
    const resolved = resolveByKey(keyParam);
    if (!resolved) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    return serveLocalFile(request, resolved.absPath);
  }

  // ── 模式 3: 外链代理(只代理 http/https,流式转发) ──
  if (proxyUrl) {
    // 防 SSRF: 拒绝内网地址 / 非 http(s)
    if (!/^https?:\/\//i.test(proxyUrl)) {
      return NextResponse.json({ error: 'Invalid proxy URL' }, { status: 400 });
    }
    if (/^https?:\/\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|localhost|0\.0\.0\.0)/i.test(proxyUrl)) {
      return NextResponse.json({ error: 'Internal URL blocked' }, { status: 403 });
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const upstream = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ai-comic-studio-asset-proxy/1.0' },
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
      }
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      const cl = upstream.headers.get('content-length');
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': ct,
          ...(cl ? { 'Content-Length': cl } : {}),
          'Cache-Control': 'public, max-age=3600', // 浏览器端缓存 1h
        },
      });
    } catch (e) {
      return NextResponse.json({ error: `Proxy failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 });
    }
  }

  // ── 模式 2: 旧 /tmp 路径(v2.8 及之前) ──
  if (!filePath) {
    return NextResponse.json({ error: 'Missing path / key / proxy parameter' }, { status: 400 });
  }

  // 安全检查：只允许服务临时目录下的文件
  const resolvedPath = path.resolve(filePath);
  const tmpDir = os.tmpdir();
  if (!resolvedPath.startsWith(tmpDir)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  return serveLocalFile(request, resolvedPath);
}

/**
 * 服务本地文件(统一处理 Range + content-type + safe stream)。
 */
function serveLocalFile(request: NextRequest, resolvedPath: string): Response {
  const stat = fs.statSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // 支持 Range 请求（视频播放需要）
  const range = request.headers.get('range');

  /**
   * 创建一个安全包装的 ReadableStream，能正确处理浏览器中断/range 请求取消的情况
   * 关键修复：避免 "Invalid state: Controller is already closed" 崩溃
   */
  function createSafeReadableStream(nodeStream: fs.ReadStream): ReadableStream {
    let closed = false;

    const safeClose = (controller: ReadableStreamDefaultController) => {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        /* controller 已被外部关闭，忽略 */
      }
    };

    const safeError = (controller: ReadableStreamDefaultController, err: unknown) => {
      if (closed) return;
      closed = true;
      try {
        controller.error(err);
      } catch {
        /* 忽略二次关闭错误 */
      }
    };

    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => {
          if (closed) {
            // 浏览器已断开，停止读取
            nodeStream.destroy();
            return;
          }
          try {
            controller.enqueue(chunk);
          } catch {
            // controller 已关闭（例如浏览器中断 range 请求），销毁 fs stream
            closed = true;
            nodeStream.destroy();
          }
        });
        nodeStream.on('end', () => safeClose(controller));
        nodeStream.on('error', (err) => safeError(controller, err));
        nodeStream.on('close', () => safeClose(controller));
      },
      cancel() {
        // 浏览器主动取消（seek / 切换视频），立刻销毁底层 fs stream
        closed = true;
        nodeStream.destroy();
      },
    });
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(resolvedPath, { start, end });
    const readableStream = createSafeReadableStream(stream);

    return new Response(readableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      },
    });
  }

  // 完整文件响应
  const stream = fs.createReadStream(resolvedPath);
  const readableStream = createSafeReadableStream(stream);

  return new Response(readableStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${path.basename(resolvedPath)}"`,
      'Cache-Control': 'no-cache',
    },
  });
}
