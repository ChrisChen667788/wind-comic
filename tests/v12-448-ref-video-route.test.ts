/**
 * v12.448 · /api/projects/[id]/ref-video 路由(直接调 handler)。
 * 鉴权(读 view / 写 edit)、链接的内网拦截、上传的校验结果透传、落库字段。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { File as NodeFile, Blob as NodeBlob } from 'node:buffer';
import { REF_VIDEO_LIMITS } from '@/lib/ref-video';
import { markH3Unavailable, resetH3Availability } from '@/lib/h3-availability';

const m = vi.hoisted(() => ({
  gate: { ok: true } as any,
  gateModes: [] as string[],
  saved: [] as any[],
  deleted: [] as number[],
  list: [] as any[],
  ssrf: { ok: true } as any,
  ingest: null as any,
}));

vi.mock('@/lib/auth-guard', () => ({
  requireProjectAccess: async (_req: unknown, _id: string, mode: string) => { m.gateModes.push(mode); return m.gate; },
}));
vi.mock('@/lib/shot-ref-video-store', () => ({
  getShotRefVideo: async (_p: string, shot: number) => m.list.find((x) => x.shotNumber === shot) || null,
  listShotRefVideos: async () => m.list,
  saveShotRefVideo: async (_p: string, v: any) => { m.saved.push(v); },
  deleteShotRefVideo: async (_p: string, shot: number) => { m.deleted.push(shot); return true; },
}));
vi.mock('@/lib/ssrf-guard', () => ({ assertOutboundUrlSafe: async () => m.ssrf }));
vi.mock('@/lib/ref-video-ingest', () => ({ ingestRefVideo: async () => (typeof m.ingest === 'function' ? m.ingest() : m.ingest) }));
vi.mock('@/lib/asset-storage', () => ({ persistAsset: async () => ({ url: '/api/serve-file?key=x' }) }));

import { GET, POST, DELETE } from '@/app/api/projects/[id]/ref-video/route';

const params = { params: Promise.resolve({ id: 'p1' }) };
const req = (url: string, init?: RequestInit) => new Request(`http://localhost/api/projects/p1/ref-video${url}`, init) as any;
const jsonPost = (body: unknown) => req('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/**
 * 手拼 multipart 请求体:测试环境是 jsdom,它的 FormData 与 Node 自带的 Request 不互通(formData() 会挂住),
 * 手拼的字节交给 Node 的 Request 解析 —— 与生产里浏览器发来的请求走同一条解析路径。
 */
const filePost = async (shot: string, blob: Blob, type = 'video/mp4') => {
  const B = '----refvideo' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="shotNumber"\r\n\r\n${shot}\r\n` +
    `--${B}\r\nContent-Disposition: form-data; name="file"; filename="move.mp4"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${B}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(await blob.arrayBuffer()), tail]);
  return req('', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${B}` }, body });
};

// 测试环境是 jsdom:它把全局 File / Blob 换成了自己的实现,而 Node 的 multipart 解析器按原生 File 做类型检查,
// 解析即断言失败(生产跑在 Node 里,不受影响)。本文件期间换回原生实现,跑完还原。
const jsdomGlobals = { File: (globalThis as any).File, Blob: (globalThis as any).Blob };
beforeAll(() => { (globalThis as any).File = NodeFile; (globalThis as any).Blob = NodeBlob; });
afterAll(() => { (globalThis as any).File = jsdomGlobals.File; (globalThis as any).Blob = jsdomGlobals.Blob; });

beforeEach(() => {
  m.gate = { ok: true }; m.gateModes = []; m.saved = []; m.deleted = []; m.list = []; m.ssrf = { ok: true }; m.ingest = null;
  resetH3Availability();
});

describe('v12.448 · 鉴权', () => {
  it('读用 view、写用 edit;被拒时不碰存储', async () => {
    m.gate = { ok: false, status: 403, message: '无权限' };
    expect((await GET(req('?shot=1'), params)).status).toBe(403);
    expect((await POST(jsonPost({ shotNumber: 1, url: 'https://cdn.example/a.mp4' }), params)).status).toBe(403);
    expect((await DELETE(req('?shot=1', { method: 'DELETE' }), params)).status).toBe(403);
    expect(m.gateModes).toEqual(['view', 'edit', 'edit']);
    expect(m.saved).toEqual([]);
    expect(m.deleted).toEqual([]);
  });
});

describe('v12.448 · GET', () => {
  it('不带 shot → 全部挂了的镜 + 本进程是否已知 H3 不可用', async () => {
    m.list = [{ shotNumber: 2, url: 'https://cdn.example/a.mp4', source: 'link' }];
    markH3Unavailable('2013');
    const d = await (await GET(req(''), params)).json();
    expect(d.items).toEqual(m.list);
    expect(d.h3KnownUnavailable).toBe(true);
  });
  it('带 shot → 该镜;镜号不合法 → 400', async () => {
    m.list = [{ shotNumber: 2, url: 'https://cdn.example/a.mp4', source: 'link' }];
    expect((await (await GET(req('?shot=2'), params)).json()).refVideo.url).toBe('https://cdn.example/a.mp4');
    expect((await (await GET(req('?shot=3'), params)).json()).refVideo).toBeNull();
    expect((await GET(req('?shot=abc'), params)).status).toBe(400);
    expect((await GET(req('?shot=0'), params)).status).toBe(400);
  });
});

describe('v12.448 · POST 链接', () => {
  it('公网链接落库为 source=link', async () => {
    const res = await POST(jsonPost({ shotNumber: 3, url: '  https://cdn.example/move.mp4 ' }), params);
    expect(res.status).toBe(200);
    expect(m.saved).toEqual([{ shotNumber: 3, url: 'https://cdn.example/move.mp4', source: 'link' }]);
  });
  it('非 http、缺镜号、内网地址都拒,且不落库', async () => {
    expect((await POST(jsonPost({ shotNumber: 3, url: 'ftp://x/a.mp4' }), params)).status).toBe(400);
    expect((await POST(jsonPost({ url: 'https://cdn.example/a.mp4' }), params)).status).toBe(400);
    m.ssrf = { ok: false, reason: '内网主机名被拒:localhost' };
    const blocked = await POST(jsonPost({ shotNumber: 3, url: 'http://localhost:3000/a.mp4' }), params);
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toContain('内网');
    expect(m.saved).toEqual([]);
  });
});

describe('v12.448 · POST 上传', () => {
  it('入库通过:落库为 source=upload,带时长、尺寸与截取信息', async () => {
    m.ingest = { ok: true, url: '/api/serve-file?key=k1', probe: { durationSec: 14.97, width: 640, height: 360, sizeBytes: 1234 }, trimmedFrom: 20.02 };
    const d = await (await POST(await filePost('2', new Blob([new Uint8Array(10)], { type: 'video/mp4' })), params)).json();
    expect(d.ok).toBe(true);
    expect(m.saved).toEqual([{ shotNumber: 2, url: '/api/serve-file?key=k1', source: 'upload', durationSec: 15, width: 640, height: 360, sizeBytes: 1234, trimmedFrom: 20 }]);
  });
  it('【第四轮】服务器自身故障(缺 ffprobe / 存储写不进)→ 500,不是 422 —— 不能把锅甩给用户的文件', async () => {
    m.ingest = { ok: false, errors: ['服务器处理不了视频(缺少或无法运行 ffprobe),请联系部署方'], server: true };
    const res = await POST(await filePost('3', new Blob([new Uint8Array(10)], { type: 'video/mp4' })), params);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('ffprobe');
    expect(m.saved).toEqual([]);
  });

  it('入库校验不过 → 422 并把每条原因带回,不落库', async () => {
    m.ingest = { ok: false, errors: ['太短了:1.0 秒,至少 2 秒'] };
    const res = await POST(await filePost('2', new Blob([new Uint8Array(10)], { type: 'video/mp4' })), params);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual(['太短了:1.0 秒,至少 2 秒']);
    expect(m.saved).toEqual([]);
  });
  it(`超过 ${REF_VIDEO_LIMITS.maxBytes / 1048576}MB 直接 413,不进入库流程`, async () => {
    m.ingest = { ok: true, url: 'should-not-be-used', probe: {} };
    const big = new Blob([new Uint8Array(REF_VIDEO_LIMITS.maxBytes + 1)], { type: 'video/mp4' });
    expect((await POST(await filePost('2', big), params)).status).toBe(413);
    expect(m.saved).toEqual([]);
  });
});

describe('v12.448 · 对抗复查补:请求体与报错', () => {
  it('声明的请求体超限:不解析直接 413(formData 会把整个请求体读进内存)', async () => {
    m.ingest = { ok: true, url: 'x', probe: {} };
    const r = await filePost('2', new Blob([new Uint8Array(10)], { type: 'video/mp4' }));
    const big = req('', { method: 'POST', headers: { 'Content-Type': r.headers.get('content-type')!, 'Content-Length': String(REF_VIDEO_LIMITS.maxBytes + 2 * 1048576) }, body: await r.arrayBuffer(), duplex: 'half' } as any);
    expect((await POST(big, params)).status).toBe(413);
    expect(m.saved).toEqual([]);
  });
  it('出错时只回固定文案,内部报错(可能带路径)只进服务端日志', async () => {
    m.ingest = { ok: true, url: '/api/serve-file?key=k1', probe: { durationSec: 3, width: 640, height: 360, sizeBytes: 1 } };
    const store: any = await import('@/lib/shot-ref-video-store');
    const spy = vi.spyOn(store, 'saveShotRefVideo').mockRejectedValueOnce(new Error('SQLITE_CANTOPEN: unable to open /app/data/secret.db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(await filePost('2', new Blob([new Uint8Array(10)], { type: 'video/mp4' })), params);
      expect(res.status).toBe(500);
      const body = JSON.stringify(await res.json());
      expect(body).not.toContain('/app/data');
      expect(body).toContain('保存失败');
    } finally { spy.mockRestore(); err.mockRestore(); }
  });
});

describe('v12.448 · 对抗复查第二轮:请求体上限、并发上限、内网地址不外泄', () => {
  it('分块上传(不带 Content-Length)超限:边读边计,超了立刻停读并 413 —— 不把整个请求体读进内存', async () => {
    const CHUNK = 1024 * 1024;
    const total = Math.ceil(REF_VIDEO_LIMITS.maxBytes / CHUNK) + 5;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) { if (pulled >= total) { ctrl.close(); return; } pulled++; ctrl.enqueue(new Uint8Array(CHUNK)); },
    });
    m.ingest = { ok: true, url: 'should-not-be-used', probe: {} };
    const r = new Request('http://localhost/api/projects/p1/ref-video', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: stream, duplex: 'half',
    } as any);
    expect(r.headers.get('content-length')).toBeNull();
    expect((await POST(r as any, params)).status).toBe(413);
    expect(pulled, '超限后还在继续读').toBeLessThan(total);
    expect(m.saved).toEqual([]);
  });

  it('同时处理的上传超过上限 → 429(在读请求体之前就拒);放行的照常完成', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    m.ingest = async () => { await gate; return { ok: true, url: '/api/serve-file?key=k', probe: { durationSec: 3, width: 640, height: 360, sizeBytes: 1 } }; };
    const blob = () => new Blob([new Uint8Array(10)], { type: 'video/mp4' });
    const a = POST(await filePost('1', blob()), params);
    const b = POST(await filePost('2', blob()), params);
    await new Promise((r) => setTimeout(r, 20)); // 让前两个进到入库那一步
    const c = await POST(await filePost('3', blob()), params);
    expect(c.status).toBe(429);
    release();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    // 名额释放后又能传
    expect((await POST(await filePost('4', blob()), params)).status).toBe(200);
  });

  it('JSON 链接分支同样封顶:分块发来的超大请求体边读边计,超了 413,不整个读进内存(对抗复查第三轮)', async () => {
    const CHUNK = 64 * 1024;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) { if (pulled >= 200) { ctrl.close(); return; } pulled++; ctrl.enqueue(new TextEncoder().encode(' '.repeat(CHUNK))); },
    });
    const r = new Request('http://localhost/api/projects/p1/ref-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    } as any);
    expect((await POST(r as any, params)).status).toBe(413);
    expect(pulled, '超限后还在继续读').toBeLessThan(200);
    // 声明了超大长度:一个字节都不读就拒
    const declared = new Request('http://localhost/api/projects/p1/ref-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(10 * 1024 * 1024) }, body: '{}',
    });
    expect((await POST(declared as any, params)).status).toBe(413);
    // 正常大小的链接请求不受影响
    expect((await POST(jsonPost({ shotNumber: 3, url: 'https://cdn.example/a.mp4' }), params)).status).toBe(200);
    expect(m.saved).toHaveLength(1);
  });

  it('multipart 空请求体 / 格式坏了 → 400(请求本身的问题),不是 500(让客户端白白重试)', async () => {
    const empty = new Request('http://localhost/api/projects/p1/ref-video', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } });
    const e = await POST(empty as any, params);
    expect(e.status).toBe(400);
    expect((await e.json()).error).toContain('为空'); // 说清楚是「没传东西」,而不是笼统的格式错
    const broken = new Request('http://localhost/api/projects/p1/ref-video', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'not a multipart body at all' });
    expect((await POST(broken as any, params)).status).toBe(400);
    // 名额没漏:之后照常能传
    m.ingest = { ok: true, url: '/api/serve-file?key=k', probe: { durationSec: 3, width: 640, height: 360, sizeBytes: 10 } };
    expect((await POST(await filePost('4', new Blob([new Uint8Array(10)], { type: 'video/mp4' })), params)).status).toBe(200);
  });

  it('链接被拦时,服务端解析出的内网 IP 不回给客户端(只进日志)', async () => {
    m.ssrf = { ok: false, reason: '域名 db.corp.internal 的解析结果含不可出站地址 10.0.0.5(全部:10.0.0.5)' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await POST(jsonPost({ shotNumber: 3, url: 'http://db.corp.internal/a.mp4' }), params);
      expect(res.status).toBe(400);
      const body = JSON.stringify(await res.json());
      expect(body).not.toContain('10.0.0.5');
      expect(body).toContain('内网');
      expect(warn.mock.calls.map((x) => String(x[0])).join()).toContain('10.0.0.5');
    } finally { warn.mockRestore(); }
  });
});

describe('v12.448 · DELETE', () => {
  it('取下该镜;镜号不合法 → 400', async () => {
    expect((await (await DELETE(req('?shot=4', { method: 'DELETE' }), params)).json()).removed).toBe(true);
    expect(m.deleted).toEqual([4]);
    expect((await DELETE(req('?shot=x', { method: 'DELETE' }), params)).status).toBe(400);
  });
});
