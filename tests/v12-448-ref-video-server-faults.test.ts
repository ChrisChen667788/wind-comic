/**
 * v12.448 · 第四轮对抗复查修掉的三处:服务器自身故障不能伪装成「用户的文件有问题」,发送路径不许同步读盘。
 *
 * ① 部署漏装 ffprobe → 原来每次上传都回 422「读不出这段视频(文件损坏)」:每个用户都被告知自己的文件坏了,
 *    去反复转码一个好文件。② 存储写不进(磁盘满 / 权限)→ 原来 422「保存失败」:那是服务器的问题。
 * ③ 出片发送路径 refVideoToEngine 残留一个 fs.existsSync(同类 R3-2 漏修);读盘报错原文(带本机路径)经事件推给前端。
 * ffprobe / ffmpeg 用真的(ffmpeg-static 现场生成视频),「缺工具」用一个不存在的路径真 spawn。
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const tools = vi.hoisted(() => ({ ffprobe: null as string | null, ffmpeg: null as string | null }));
vi.mock('@/services/video-composer', async (orig) => {
  const a: any = await orig();
  return { ...a, resolveFFprobePath: () => tools.ffprobe ?? a.resolveFFprobePath(), resolveFFmpegPath: () => tools.ffmpeg ?? a.resolveFFmpegPath() };
});
import { ingestRefVideo } from '@/lib/ref-video-ingest';
import { refVideoToEngine } from '@/lib/ref-video';

const FF = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refv-faults-'));
const mk = (name: string, args: string[]) => {
  const out = path.join(tmp, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, out], { stdio: 'pipe' });
  return fs.readFileSync(out);
};
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });
beforeEach(() => { tools.ffprobe = null; tools.ffmpeg = null; vi.restoreAllMocks(); });

const okPersist = async () => ({ url: '/api/serve-file?key=k' });
const MISSING = path.join(tmp, 'no-such-dir', 'ffprobe');

describe('v12.448 第四轮 · 服务器故障 ≠ 文件有问题', () => {
  it('缺 ffprobe:标成服务器故障、点名 ffprobe,**不说**文件损坏', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const buf = mk('ok.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']);
    tools.ffprobe = MISSING;
    const r = await ingestRefVideo(buf, 'video/mp4', okPersist);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.server).toBe(true);
    expect(r.errors.join()).toContain('ffprobe');
    expect(r.errors.join()).not.toMatch(/损坏|不是视频/);
  }, 60000);

  it('对照:文件本身是坏的(工具都在)→ 仍是用户侧问题,不标服务器故障', async () => {
    const r = await ingestRefVideo(Buffer.from('this is not a video at all'.repeat(100)), 'video/mp4', okPersist);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.server).toBeUndefined();
    expect(r.errors.join()).toContain('文件损坏');
  }, 60000);

  it('需要截取但缺 ffmpeg:服务器故障、点名 ffmpeg', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const buf = mk('long.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=17', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '30']);
    tools.ffmpeg = MISSING;
    const r = await ingestRefVideo(buf, 'video/mp4', okPersist);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.server).toBe(true);
    expect(r.errors.join()).toContain('ffmpeg');
  }, 120000);

  it('存储写不进(persist 回 null)→ 服务器故障,而不是「这个文件不行」', async () => {
    const buf = mk('ok2.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']);
    const r = await ingestRefVideo(buf, 'video/mp4', async () => null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.server).toBe(true);
    expect(r.errors.join()).toContain('服务器存储');
  }, 60000);

  it('服务器故障后临时目录照样清掉', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ref-video-')).length;
    tools.ffprobe = MISSING;
    await ingestRefVideo(mk('ok3.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']), 'video/mp4', okPersist);
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ref-video-')).length).toBe(before);
  }, 60000);
});

describe('v12.448 第四轮 · 出片发送路径', () => {
  const at = (map: Record<string, string>) => (u: string) => map[u] ?? null;

  it('文件已被清理:如实说找不到,且全程不做同步 existsSync', async () => {
    const spy = vi.spyOn(fs, 'existsSync');
    const r = await refVideoToEngine('/api/serve-file?key=g', at({ '/api/serve-file?key=g': path.join(tmp, 'gone.mp4') }));
    expect(r).toEqual({ ok: false, reason: '参考视频文件在本机找不到了(可能被清理),请重新上传' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('读盘报错:推给前端的原因不带本机路径,详情只进服务端日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const locked = path.join(tmp, 'locked.mp4'); fs.writeFileSync(locked, Buffer.from('x')); fs.chmodSync(locked, 0o000);
    try {
      const r = await refVideoToEngine('/api/serve-file?key=l', at({ '/api/serve-file?key=l': locked }));
      expect(r.ok).toBe(false);
      expect((r as any).reason).not.toContain(tmp);
      expect((r as any).reason).not.toMatch(/EACCES|permission/i);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/EACCES|permission/i);
    } finally { fs.chmodSync(locked, 0o644); }
  });
});
