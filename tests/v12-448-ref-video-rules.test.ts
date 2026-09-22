/**
 * v12.448 · 参考视频(动作迁移)规则层:校验、交给引擎的形态、挑参考图、请求体、H3 可用性记忆、上传入库。
 *
 * 这一版**没法端到端真跑**(用户账号是 Token Plan,调 H3 报 2013)—— 所以每一层都真调代码,
 * 上传入库用 ffmpeg 现场生成真视频,不拿假字节冒充。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  checkRefVideo, refVideoToEngine, withRefVideoHint, REF_VIDEO_HINT, planH3RefImages, REF_VIDEO_LIMITS, H3_BODY_BUDGET,
} from '@/lib/ref-video';
import { buildCreateRequest, H3_REF_LIMITS } from '@/lib/minimax-video-api';
import { markH3Unavailable, isH3KnownUnavailable, resetH3Availability } from '@/lib/h3-availability';

const rows = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('@/lib/repos/asset-repo', () => ({ listAssetsByType: async () => rows.list }));

const FF = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refv-'));
const mk = (name: string, args: string[]) => {
  const out = path.join(tmp, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, out], { stdio: 'pipe' });
  return out;
};
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

const GOOD = { durationSec: 5, width: 1280, height: 720, fps: 30, sizeBytes: 3 * 1048576, formatName: 'mov,mp4,m4a,3gp,3g2,mj2', codec: 'h264' };

describe('v12.448 · checkRefVideo(按官方契约)', () => {
  it('合规的 5 秒 720p H.264 MP4 通过', () => {
    expect(checkRefVideo(GOOD)).toEqual({ ok: true, errors: [] });
  });
  it('太短拒;超过 15 秒不算错,给出截取点', () => {
    expect(checkRefVideo({ ...GOOD, durationSec: 1.5 }).ok).toBe(false);
    const long = checkRefVideo({ ...GOOD, durationSec: 22 });
    expect(long.ok).toBe(true);
    expect(long.trimTo).toBe(15);
  });
  it('尺寸、宽高比、帧率、编码、容器越界都拒,且说清楚为什么', () => {
    expect(checkRefVideo({ ...GOOD, width: 200, height: 200 }).errors.join()).toContain('256');
    expect(checkRefVideo({ ...GOOD, width: 1920, height: 600 }).errors.join()).toContain('宽高比');
    expect(checkRefVideo({ ...GOOD, fps: 12 }).errors.join()).toContain('帧率');
    expect(checkRefVideo({ ...GOOD, codec: 'vp9' }).errors.join()).toContain('H.264');
    expect(checkRefVideo({ ...GOOD, formatName: 'matroska,webm' }).errors.join()).toContain('MP4');
  });
  it('探测拿不到的维度不当错误(宁可让引擎拒,别在本地误杀合法视频)', () => {
    expect(checkRefVideo({ ...GOOD, fps: null, formatName: null, codec: null, sizeBytes: null }).ok).toBe(true);
  });
  it('本地文件按更紧的内联上限判体积;公网链接按官方上限', () => {
    const big = { ...GOOD, sizeBytes: 30 * 1048576 };
    expect(checkRefVideo(big).ok).toBe(true);
    const inline = checkRefVideo(big, { inline: true });
    expect(inline.ok).toBe(false);
    expect(inline.errors.join()).toContain('公网链接');
  });
});

describe('v12.448 · refVideoToEngine(MiniMax 访问不到 localhost)', () => {
  let small = '', big = '', avi = '';
  beforeAll(() => {
    small = path.join(tmp, 'small.mp4'); fs.writeFileSync(small, Buffer.from('fake-mp4-bytes'));
    big = path.join(tmp, 'big.mp4'); fs.writeFileSync(big, Buffer.alloc(REF_VIDEO_LIMITS.maxInlineBytes + 1));
    avi = path.join(tmp, 'x.avi'); fs.writeFileSync(avi, Buffer.from('x'));
  });
  const resolve = (map: Record<string, string>) => (u: string) => map[u] ?? null;

  it('公网链接与 data:video 原样交出', async () => {
    expect(await refVideoToEngine('https://cdn.example/a.mp4', resolve({}))).toEqual({ ok: true, url: 'https://cdn.example/a.mp4' });
    expect(await refVideoToEngine('data:video/mp4;base64,AAAA', resolve({}))).toEqual({ ok: true, url: 'data:video/mp4;base64,AAAA' });
  });
  it('站内文件转 base64,MIME 按扩展名', async () => {
    const r = await refVideoToEngine('/api/serve-file?key=s', resolve({ '/api/serve-file?key=s': small }));
    expect(r.ok).toBe(true);
    expect((r as any).url).toBe(`data:video/mp4;base64,${Buffer.from('fake-mp4-bytes').toString('base64')}`);
  });
  it('用不了的都说清原因:找不到文件 / 超内联上限 / 格式不支持', async () => {
    const miss = await refVideoToEngine('/api/serve-file?key=gone', resolve({}));
    expect(miss.ok).toBe(false);
    expect((miss as any).reason).toContain('找不到');
    const tooBig = await refVideoToEngine('/api/serve-file?key=b', resolve({ '/api/serve-file?key=b': big }));
    expect((tooBig as any).reason).toContain('内联上限');
    const bad = await refVideoToEngine('/api/serve-file?key=a', resolve({ '/api/serve-file?key=a': avi }));
    expect((bad as any).reason).toContain('MP4');
  });
  it('读盘异常(读不了、解析地址时抛错)不抛出,转成「用不了 + 原因」—— 增强项不能把出片打挂', async () => {
    const locked = path.join(tmp, 'locked.mp4'); fs.writeFileSync(locked, Buffer.from('x')); fs.chmodSync(locked, 0o000);
    try {
      const r = await refVideoToEngine('/api/serve-file?key=l', resolve({ '/api/serve-file?key=l': locked }));
      expect(r.ok).toBe(false);
      expect((r as any).reason).toContain('读取参考视频失败');
    } finally { fs.chmodSync(locked, 0o644); }
    const boom = await refVideoToEngine('/api/serve-file?key=x', () => { throw new Error('签名校验炸了'); });
    expect(boom.ok).toBe(false);
  });
});

describe('v12.448 · 提示词里说明「学动作与运镜」(官方没有子角色字段)', () => {
  it('追加一次、重复调用不叠加、空提示词也成立', () => {
    const once = withRefVideoHint('A girl turns around');
    expect(once).toBe(`A girl turns around. ${REF_VIDEO_HINT}`);
    expect(withRefVideoHint(once)).toBe(once);
    expect(withRefVideoHint('')).toBe(REF_VIDEO_HINT);
  });
});

describe('v12.448 · planH3RefImages(参考模式不能带首帧 → 分镜图变第一张参考图)', () => {
  const id = (u: string) => u;
  it('顺序:分镜图 → 各角色正面 → 角度图按轮次 → 场景参考;去重', () => {
    const r = planH3RefImages({
      frame: 'F', subjects: [{ imageUrl: 'A', refImageUrls: ['A1', 'A2'] }, { imageUrl: 'B', refImageUrls: ['B1'] }],
      extras: ['S', 'A'], videoUrl: 'V',
    }, id);
    expect(r.images).toEqual(['F', 'A', 'B', 'A1', 'B1', 'A2', 'S']);
    expect(r.dropped).toBe(0);
  });
  it(`${H3_REF_LIMITS.images} 张封顶,多出的如实计入 dropped`, () => {
    const subjects = Array.from({ length: 12 }, (_, i) => ({ imageUrl: `C${i}` }));
    const r = planH3RefImages({ frame: 'F', subjects, videoUrl: 'V' }, id);
    expect(r.images).toHaveLength(9);
    expect(r.dropped).toBe(13 - 9);
  });
  it('转不成引擎形态的图不静默消失,计入 dropped', () => {
    const r = planH3RefImages({ frame: 'F', subjects: [{ imageUrl: 'bad' }], videoUrl: 'V' }, (u) => (u === 'bad' ? null : u));
    expect(r.images).toEqual(['F']);
    expect(r.dropped).toBe(1);
  });
  it('请求体预算封顶:视频已经很大时,放不下的图不发', () => {
    const huge = 'x'.repeat(H3_BODY_BUDGET - 10);
    const r = planH3RefImages({ frame: 'FRAME-IMAGE', subjects: [], videoUrl: huge }, id);
    expect(r.images).toEqual([]);
    expect(r.dropped).toBe(1);
  });
});

describe('v12.448 · buildCreateRequest 参考模式', () => {
  it('带参考素材 → text + reference_image + reference_video,且**不带首帧**(官方互斥)', () => {
    const r = buildCreateRequest({
      model: 'MiniMax-H3', prompt: 'p', imageUrl: 'https://cdn.example/frame.png', aspectRatio: '9:16', duration: 6,
      referenceImageUrls: ['https://cdn.example/frame.png', 'https://cdn.example/face.png'], referenceVideoUrls: ['https://cdn.example/move.mp4'],
    });
    const content = (r.body as any).content;
    expect(content[0]).toEqual({ type: 'text', text: 'p' });
    expect(content.filter((c: any) => c.role === 'first_frame')).toHaveLength(0);
    expect(content.filter((c: any) => c.role === 'reference_image').map((c: any) => c.image_url.url))
      .toEqual(['https://cdn.example/frame.png', 'https://cdn.example/face.png']);
    expect(content.filter((c: any) => c.role === 'reference_video')).toEqual([
      { type: 'video_url', video_url: { url: 'https://cdn.example/move.mp4' }, role: 'reference_video' },
    ]);
    // 没有首帧可跟随,画幅按调用方给的走,不能是 adaptive
    expect((r.body as any).ratio).toBe('9:16');
  });
  it('参考素材数量按官方上限截断', () => {
    const r = buildCreateRequest({
      model: 'MiniMax-H3', prompt: 'p',
      referenceImageUrls: Array.from({ length: 12 }, (_, i) => `https://i/${i}`),
      referenceVideoUrls: ['https://v/1', 'https://v/2', 'https://v/3', 'https://v/4'],
    });
    const content = (r.body as any).content;
    expect(content.filter((c: any) => c.role === 'reference_image')).toHaveLength(H3_REF_LIMITS.images);
    expect(content.filter((c: any) => c.role === 'reference_video')).toHaveLength(H3_REF_LIMITS.videos);
  });
  it('参考模式没给画幅 → 16:9,不是 adaptive(adaptive 跟随的是首帧,而参考模式没有首帧)', () => {
    const r = buildCreateRequest({ model: 'MiniMax-H3', prompt: 'p', imageUrl: 'https://cdn.example/frame.png', referenceVideoUrls: ['https://v/1'] });
    expect((r.body as any).ratio).toBe('16:9');
  });
  it('v1 模型收到参考素材直接报错 —— 不许静默丢掉', () => {
    expect(() => buildCreateRequest({ model: 'MiniMax-Hailuo-2.3', prompt: 'p', referenceVideoUrls: ['https://v/1'] })).toThrow(/v1/);
  });
  it('没有参考素材时与修前完全一样(首帧 + adaptive)', () => {
    const r = buildCreateRequest({ model: 'MiniMax-H3', prompt: 'p', imageUrl: 'https://cdn.example/frame.png' });
    expect((r.body as any).content).toHaveLength(2);
    expect((r.body as any).content[1].role).toBe('first_frame');
    expect((r.body as any).ratio).toBe('adaptive');
  });
});

describe('v12.448 · H3 可用性的进程内记忆', () => {
  beforeEach(() => resetH3Availability());
  it('记下后已知不可用;第一次返回 fresh=true(据此只告警一次),再记返回 false', () => {
    expect(isH3KnownUnavailable()).toBe(false);
    expect(markH3Unavailable('2013 暂不支持')).toBe(true);
    expect(isH3KnownUnavailable()).toBe(true);
    expect(markH3Unavailable('2013 暂不支持')).toBe(false);
  });
  it('过期后回到「未知」—— 换成按量付费 key 后会再试 H3', () => {
    const t0 = 1_000_000;
    markH3Unavailable('x', t0);
    expect(isH3KnownUnavailable(t0 + 29 * 60_000)).toBe(true);
    expect(isH3KnownUnavailable(t0 + 31 * 60_000)).toBe(false);
  });
});

describe('v12.448 · 出片注入口 refVideoOptsForShot', () => {
  beforeEach(() => { rows.list = []; });
  const load = async () => (await import('@/lib/shot-ref-video-store')).refVideoOptsForShot;

  it('没挂 / 没项目号 → {},不上报', async () => {
    const f = await load();
    const events: any[] = [];
    expect(await f('p1', 3, (e) => events.push(e))).toEqual({});
    expect(await f(undefined, 3, (e) => events.push(e))).toEqual({});
    expect(events).toEqual([]);
  });
  it('挂了公网链接 → 交出引擎地址与回报函数;回报带上镜号', async () => {
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: JSON.stringify({ url: 'https://cdn.example/m.mp4', source: 'link' }) }];
    const f = await load();
    const events: any[] = [];
    const r = await f('p1', 3, (e) => events.push(e));
    expect(r.referenceVideoUrl).toBe('https://cdn.example/m.mp4');
    r.onRefOutcome!({ status: 'sent', engine: 'minimax-h3', imagesSent: 2, imagesDropped: 0 });
    expect(events).toEqual([{ shotNumber: 3, status: 'sent', engine: 'minimax-h3', imagesSent: 2, imagesDropped: 0 }]);
  });
  it('挂了但本地文件已被清理 → 当场上报 ignored,照常出片({})', async () => {
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: { url: '/api/serve-file?key=gone', source: 'upload' } }];
    const f = await load();
    const events: any[] = [];
    expect(await f('p1', 3, (e) => events.push(e))).toEqual({});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ shotNumber: 3, status: 'ignored' });
    expect(events[0].reason).toContain('找不到');
  });
  it('别的镜、别的类型的行不算;存坏的行当没挂', async () => {
    rows.list = [
      { type: 'stage-scene', shot_number: 3, data: { url: 'https://x/wrong.mp4' } },
      { type: 'shot-ref-video', shot_number: 4, data: { url: 'https://x/other.mp4' } },
      { type: 'shot-ref-video', shot_number: 3, data: '{坏' },
    ];
    const f = await load();
    expect(await f('p1', 3, () => {})).toEqual({});
  });
  it('onNoRef:这一镜最终没用 H3 参考视频时都要回调(没挂 / 没项目号 / 用不了 / 被忽略),发出去了不回调', async () => {
    const f = await load();
    let n = 0;
    const count = () => { n++; };
    await f('p1', 3, () => {}, count);                        // 没挂
    await f(undefined, 3, () => {}, count);                   // 没项目号
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: { url: '/api/serve-file?key=gone', source: 'upload' } }];
    await f('p1', 3, () => {}, count);                        // 挂了用不了
    expect(n).toBe(3);
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: { url: 'https://cdn.example/m.mp4', source: 'link' } }];
    const r = await f('p1', 3, () => {}, count);
    expect(n, '能用时先不回调(还不知道结局)').toBe(3);
    r.onRefOutcome!({ status: 'sent', engine: 'minimax-h3', imagesSent: 1, imagesDropped: 0 });
    expect(n, '发出去了不回调').toBe(3);
    r.onRefOutcome!({ status: 'ignored', reason: 'x' });
    expect(n, '被忽略 → 回落旧接口,要回调').toBe(4);
  });

  it('被忽略的结局同时进服务端日志(每日重跑没有界面,只看日志)', async () => {
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: { url: '/api/serve-file?key=gone', source: 'upload' } }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await (await load())('p1', 3, () => {});
      expect(warn.mock.calls.map((a) => String(a[0])).join()).toContain('第 3 镜的参考视频没用上');
    } finally { warn.mockRestore(); }
  });

  it('上报回调自己抛错也不影响出片', async () => {
    rows.list = [{ type: 'shot-ref-video', shot_number: 3, data: { url: '/api/serve-file?key=gone', source: 'upload' } }];
    const f = await load();
    await expect(f('p1', 3, () => { throw new Error('SSE 已关'); })).resolves.toEqual({});
  });
});

describe('v12.448 · 上传入库(ffmpeg 现场生成真视频)', () => {
  const persisted: string[] = [];
  const persist = async (uri: string) => { persisted.push(uri); return { url: `/api/serve-file?key=k${persisted.length}` }; };
  const ingest = async (file: string, mime = 'video/mp4') => (await import('@/lib/ref-video-ingest')).ingestRefVideo(fs.readFileSync(file), mime, persist);

  it('合规的 3 秒视频:原样入库,探测结果带回', async () => {
    const f = mk('ok.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']);
    const r = await ingest(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toMatch(/^\/api\/serve-file\?key=/);
    expect(r.probe.width).toBe(640);
    expect(Math.round(r.probe.durationSec)).toBe(3);
    expect(r.trimmedFrom).toBeUndefined();
    expect(persisted.at(-1)!.startsWith('data:video/mp4;base64,')).toBe(true);
  }, 60000);

  it('入库全程不做同步读写 —— 50MB 的同步读写会卡住整个进程的事件循环(对抗复查第三轮)', async () => {
    const f = mk('sync-probe.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=17', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '30']);
    const buf = fs.readFileSync(f);
    const names = ['writeFileSync', 'readFileSync', 'statSync', 'mkdtempSync', 'rmSync', 'existsSync'] as const;
    const spies = names.map((n) => vi.spyOn(fs, n as any));
    try {
      const r = await (await import('@/lib/ref-video-ingest')).ingestRefVideo(buf, 'video/mp4', persist);
      expect(r.ok).toBe(true); // 走了截取 + 落盘的全程
      const hits = spies.flatMap((s, i) => s.mock.calls.filter((c) => String(c[0]).includes('ref-video-')).map((c) => `${names[i]}(${String(c[0])})`));
      expect(hits).toEqual([]);
    } finally { spies.forEach((s) => s.mockRestore()); }
  }, 120000);

  it('20 秒 → 自动截取前 15 秒,并告诉调用方原长', async () => {
    const f = mk('long.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '30']);
    const r = await ingest(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.round(r.trimmedFrom!)).toBe(20);
    expect(r.probe.durationSec).toBeGreaterThanOrEqual(14);
    expect(r.probe.durationSec).toBeLessThanOrEqual(15.5);
  }, 120000);

  it('27MB、24 秒(超过 20MB 内联上限)→ 先截取再判体积:截完 17MB 左右,收 —— 不能在截取前就按内联上限拒掉', async () => {
    // 噪声画面压不小,码率钉在 9Mbps:24 秒 ≈ 27MB,前 15 秒 ≈ 17MB。手机拍的原片多半就是这种「又长又大」
    const f = mk('big-long.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=24,noise=alls=100:allf=t+u', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '48', '-b:v', '9M', '-maxrate', '9M', '-minrate', '9M', '-bufsize', '9M']);
    expect(fs.statSync(f).size).toBeGreaterThan(20 * 1048576); // 前提:原片确实超内联上限
    const r = await ingest(f);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(Math.round(r.trimmedFrom!)).toBe(24);
    expect(r.probe.sizeBytes!).toBeLessThanOrEqual(20 * 1048576);
  }, 120000);

  it('12 秒但 25MB(不用截取、仍超内联上限)→ 拒,并说明是本地上传上限', async () => {
    const before = persisted.length;
    const f = mk('big-short.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=12,noise=alls=100:allf=t+u', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '48', '-b:v', '17M', '-maxrate', '17M', '-minrate', '17M', '-bufsize', '17M']);
    expect(fs.statSync(f).size).toBeGreaterThan(20 * 1048576);
    const r = await ingest(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('本地上传上限');
    expect(persisted.length).toBe(before);
  }, 120000);

  it('太短 / 太小 / 不是视频 / 不收的类型:拒,且不落盘', async () => {
    const before = persisted.length;
    const short = mk('short.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']);
    expect((await ingest(short)).ok).toBe(false);
    const tiny = mk('tiny.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=128x128:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264']);
    const t = await ingest(tiny);
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.errors.join()).toContain('256');
    const junk = path.join(tmp, 'junk.mp4'); fs.writeFileSync(junk, Buffer.alloc(4096, 0x41));
    expect((await ingest(junk)).ok).toBe(false);
    expect((await ingest(short, 'video/webm')).ok).toBe(false);
    expect(persisted.length).toBe(before);
  }, 120000);
});
