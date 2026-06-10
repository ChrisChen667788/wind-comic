/**
 * GET /api/mock-assets/* (v10.4.0) — mock 引擎的确定性产物服务(无鉴权,媒体可被
 * <img>/<video>/ffmpeg 直接消费)。三种产物,同 seed 同输出:
 *
 *   image/<seed8hex>.svg?ar=16:9&label=...   渐变 SVG(色相由 seed 决定)
 *   clip/<seed8hex>.mp4?ar=16:9&d=2          ffmpeg lavfi 纯色短片 + 正弦音轨(tmp 缓存)
 *   voice/<seed8hex>.wav?d=2.5               纯 JS 合成正弦 WAV(频率由 seed 决定)
 *
 * 安全:seed 强校验(8 hex)、时长/画幅硬钳制、clip 生成走 IP 限流(缓存命中不计)。
 * 产物不可变 → Cache-Control: immutable。
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ffmpegBin } from '@/lib/lipsync-providers/local-2d';
import { rateLimit, clientIp, isRateLimitActive } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileP = promisify(execFile);

const SEED_RE = /^[0-9a-f]{8}$/;
const AR_SIZE: Record<string, [number, number]> = {
  '16:9': [1024, 576],
  '9:16': [576, 1024],
  '1:1': [768, 768],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '2.35:1': [1128, 480],
};

const IMMUTABLE = { 'Cache-Control': 'public, max-age=31536000, immutable' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgImage(seed: string, ar: string, label: string): string {
  const [w, h] = AR_SIZE[ar] || AR_SIZE['16:9'];
  const hue = Math.round((parseInt(seed.slice(0, 2), 16) / 255) * 360);
  const hue2 = (hue + 40 + (parseInt(seed.slice(2, 4), 16) % 80)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 45% 22%)"/>
    <stop offset="100%" stop-color="hsl(${hue2} 55% 38%)"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.14}" fill="hsl(${hue2} 70% 62% / 0.5)"/>
  <text x="24" y="${h - 48}" font-family="monospace" font-size="20" fill="rgba(255,255,255,0.85)">MOCK · ${esc(label).slice(0, 60)}</text>
  <text x="24" y="${h - 22}" font-family="monospace" font-size="14" fill="rgba(255,255,255,0.55)">seed ${seed} · ${w}x${h} · 演示资产</text>
</svg>`;
}

/** 纯 JS 合成 16-bit mono 22050Hz 正弦 WAV(带 50ms 渐入渐出) */
function sineWav(seconds: number, freq: number): Buffer {
  const rate = 22050;
  const n = Math.max(1, Math.floor(rate * seconds));
  const data = Buffer.alloc(n * 2);
  const fade = Math.min(Math.floor(rate * 0.05), n >> 2);
  for (let i = 0; i < n; i++) {
    let amp = 0.28 * Math.sin((2 * Math.PI * freq * i) / rate);
    if (i < fade) amp *= i / fade;
    if (n - i < fade) amp *= (n - i) / fade;
    data.writeInt16LE(Math.round(amp * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function clipMp4(seed: string, ar: string, dur: number): Promise<Buffer> {
  const [w, h] = AR_SIZE[ar] || AR_SIZE['16:9'];
  const cacheDir = path.join(os.tmpdir(), 'qfmj-mock-assets');
  const file = path.join(cacheDir, `${seed}-${w}x${h}-${dur}.mp4`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg unavailable');
  fs.mkdirSync(cacheDir, { recursive: true });
  const color = seed.slice(0, 6);
  const freq = 220 + (parseInt(seed.slice(4, 8), 16) % 440);
  const tmp = `${file}.part-${process.pid}.mp4`;
  await execFileP(
    bin,
    [
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x${color}:s=${w}x${h}:d=${dur}:r=24`,
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', tmp,
    ],
    { timeout: 20_000 },
  );
  fs.renameSync(tmp, file); // 原子落位,避免并发读到半截文件
  return fs.readFileSync(file);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  if (!parts || parts.length !== 2) {
    return NextResponse.json({ message: 'bad mock asset path' }, { status: 400 });
  }
  const [kind, fileName] = parts;
  const dot = fileName.lastIndexOf('.');
  const seed = dot > 0 ? fileName.slice(0, dot) : '';
  if (!SEED_RE.test(seed)) {
    return NextResponse.json({ message: 'bad seed' }, { status: 400 });
  }
  const sp = request.nextUrl.searchParams;
  const ar = AR_SIZE[sp.get('ar') || ''] ? (sp.get('ar') as string) : '16:9';

  if (kind === 'image' && fileName.endsWith('.svg')) {
    const label = (sp.get('label') || 'mock').slice(0, 60);
    return new NextResponse(svgImage(seed, ar, label), {
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', ...IMMUTABLE },
    });
  }

  if (kind === 'voice' && fileName.endsWith('.wav')) {
    const dur = Math.min(Math.max(parseFloat(sp.get('d') || '2') || 2, 0.5), 30);
    const freq = 200 + (parseInt(seed.slice(0, 4), 16) % 320);
    return new NextResponse(new Uint8Array(sineWav(dur, freq)), {
      headers: { 'Content-Type': 'audio/wav', ...IMMUTABLE },
    });
  }

  if (kind === 'clip' && fileName.endsWith('.mp4')) {
    const dur = Math.min(Math.max(Math.round(parseFloat(sp.get('d') || '2') || 2), 1), 4);
    // 首次生成会起 ffmpeg 进程 → IP 限流(缓存命中在 clipMp4 内直接短路,不消耗进程)
    if (isRateLimitActive()) {
      const rl = rateLimit(`mock-clip:${clientIp(request)}`, { limit: 60, windowMs: 60_000 });
      if (!rl.allowed) {
        return NextResponse.json({ message: 'mock clip rate limited' }, { status: 429 });
      }
    }
    try {
      const buf = await clipMp4(seed, ar, dur);
      return new NextResponse(new Uint8Array(buf), {
        headers: { 'Content-Type': 'video/mp4', ...IMMUTABLE },
      });
    } catch (e) {
      return NextResponse.json(
        { message: `mock clip failed: ${e instanceof Error ? e.message : 'unknown'}` },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ message: 'unknown mock asset kind' }, { status: 404 });
}
