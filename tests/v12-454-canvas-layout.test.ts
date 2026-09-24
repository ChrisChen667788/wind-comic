/**
 * v12.454 · 画布节点位置存得住(纯逻辑 + 真库路由)。
 *
 * 病象:流水线画布拖一下节点,位置只写进内存 store(纯 zustand,无持久化)—— **刷新即回默认布局**。
 * 八个节点默认斜着排,想理顺一次就得每次重排。这是「自由画布」的第一步:先让布局是你的。
 *
 * 校验按白名单**直接拒**而不是静默丢弃:静默丢弃会让「保存成功」和「其实没存」长得一样。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { NextRequest } from 'next/server';
import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { signToken } from '@/app/api/auth/lib';
import {
  CANVAS_NODE_IDS, CANVAS_COORD_LIMIT, sanitizeCanvasPositions, parseCanvasPositions, applyCanvasPositions,
} from '@/lib/canvas-layout';
import { buildInitialNodes } from '@/components/pipeline-canvas';
import { GET, PATCH } from '@/app/api/projects/[id]/canvas-layout/route';
import { createLayoutSaver, saveCanvasLayout, roundPositions } from '@/lib/canvas-layout-client';

let owner = '', viewer = '', stranger = '', pid = '', other = '';
beforeAll(async () => {
  const mk = (n: string) => {
    const id = `u-${n}-` + nanoid(6);
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(id, `${id}@t.local`, 'x', n, now());
    return id;
  };
  owner = mk('owner'); viewer = mk('viewer'); stranger = mk('stranger');
  pid = (await createProject({ userId: owner, title: '画布', description: 'd', coverUrls: [] }) as any).id;
  // 真造一个**只读协作者** —— 只用「没被分享过的人」测 403,测到的是「不是这个项目的人」,
  // 而不是「只读的人不能改」:把 PATCH 的 edit 改成 view 也照样绿(变异 C6 当场漏网)。
  db.prepare(`INSERT INTO project_collaborators (id, project_id, user_id, role, joined_at) VALUES (?, ?, ?, 'viewer', ?)`)
    .run('col-' + nanoid(6), pid, viewer, now());
  other = (await createProject({ userId: owner, title: '别的项目', description: 'd', coverUrls: [] }) as any).id;
});

const req = (method: string, sub?: string, body?: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sub) headers.authorization = `Bearer ${signToken({ id: sub, role: 'user' } as any)}`;
  return new NextRequest(`http://localhost/api/projects/${pid}/canvas-layout`, {
    method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
};
const ctx = (id = pid) => ({ params: Promise.resolve({ id }) });

describe('v12.454 · 位置校验(白名单,非法直接拒)', () => {
  it('合法位置原样收下(负坐标要收 —— 导演节点默认就在 y=-300)', () => {
    const r = sanitizeCanvasPositions({ 'node-video': { x: 12.5, y: -300 } });
    expect(r).toEqual({ ok: true, positions: { 'node-video': { x: 12.5, y: -300 } } });
  });

  it.each([
    ['不认识的节点 id', { 'node-nope': { x: 0, y: 0 } }, /不认识的节点/],
    ['x 不是数字', { 'node-video': { x: '10', y: 0 } }, /必须是有限数字/],
    ['NaN', { 'node-video': { x: Number.NaN, y: 0 } }, /必须是有限数字/],
    ['Infinity', { 'node-video': { x: Number.POSITIVE_INFINITY, y: 0 } }, /必须是有限数字/],
    ['超出范围', { 'node-video': { x: CANVAS_COORD_LIMIT + 1, y: 0 } }, /超出/],
    ['位置不是对象', { 'node-video': [1, 2] }, /必须是 \{x,y\}/],
    ['整体是数组', [{ x: 1, y: 2 }], /必须是对象/],
    ['整体是 null', null, /必须是对象/],
  ])('%s → 拒,并说明原因', (_label, input, re) => {
    const r = sanitizeCanvasPositions(input as unknown);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });

  it('存库 JSON 读不出时当没存过(旧项目 NULL 零影响)', () => {
    expect(parseCanvasPositions(null)).toEqual({});
    expect(parseCanvasPositions('{坏')).toEqual({});
    expect(parseCanvasPositions(JSON.stringify({ 'node-nope': { x: 1, y: 2 } })), '脏数据整份作废,不半信半疑').toEqual({});
    expect(parseCanvasPositions(JSON.stringify({ 'node-video': { x: 1, y: 2 } }))).toEqual({ 'node-video': { x: 1, y: 2 } });
  });

  it('只覆盖存过的节点,没存过的保持默认(部分保存不会把别的节点挪到 0,0)', () => {
    const nodes = [{ id: 'node-video', position: { x: 1, y: 1 } }, { id: 'node-editor', position: { x: 9, y: 9 } }];
    expect(applyCanvasPositions(nodes, { 'node-video': { x: 50, y: 60 } })).toEqual([
      { id: 'node-video', position: { x: 50, y: 60 } },
      { id: 'node-editor', position: { x: 9, y: 9 } },
    ]);
  });

  it('白名单与画布实际节点**完全一致** —— 画布加了节点而白名单没跟上,新节点的位置会被接口静默拒掉', () => {
    const ids = buildInitialNodes([]).map((n) => n.id).sort();
    expect(ids).toEqual([...CANVAS_NODE_IDS].sort());
  });
});

describe('v12.454 · 路由(真库)', () => {
  it('存了再读,原样回来;**不动 updated_at** —— 拖个节点不该让项目在「最近修改」里窜到最前', async () => {
    const before = (db.prepare('SELECT updated_at FROM projects WHERE id = ?').get(pid) as any).updated_at;
    const positions = { 'node-writer': { x: 10, y: 20 }, 'node-video': { x: -30, y: 40 } };
    const p = await PATCH(req('PATCH', owner, { positions }), ctx());
    expect(p.status).toBe(200);
    const g = await GET(req('GET', owner), ctx());
    expect(await g.json()).toEqual({ positions });
    const after = (db.prepare('SELECT updated_at FROM projects WHERE id = ?').get(pid) as any).updated_at;
    expect(after, '布局保存改了 updated_at,项目列表排序会被污染').toBe(before);
  });

  it('没存过的项目读回空对象(旧项目零影响)', async () => {
    const g = await GET(req('GET', owner), ctx(other));
    expect(await g.json()).toEqual({ positions: {} });
  });

  it('未登录 401;不是本项目的人 403', async () => {
    expect((await GET(req('GET'), ctx())).status).toBe(401);
    expect((await GET(req('GET', stranger), ctx())).status).toBe(403);
    expect((await PATCH(req('PATCH', stranger, { positions: {} }), ctx())).status).toBe(403);
  });

  it('只读协作者:看得到,但改不了(改的是这个项目的布局,不是他的个人视图)', async () => {
    expect((await GET(req('GET', viewer), ctx())).status, '只读也能看').toBe(200);
    const p = await PATCH(req('PATCH', viewer, { positions: { 'node-video': { x: 1, y: 1 } } }), ctx());
    expect(p.status).toBe(403);
  });

  it('非法位置 400 并带原因,且**不落库**', async () => {
    const good = { 'node-writer': { x: 1, y: 2 } };
    await PATCH(req('PATCH', owner, { positions: good }), ctx());
    const bad = await PATCH(req('PATCH', owner, { positions: { 'node-writer': { x: 'x', y: 2 } } }), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/必须是有限数字/);
    expect(await (await GET(req('GET', owner), ctx())).json(), '库里还是上一次的好数据').toEqual({ positions: good });
  });

  it('空请求体 400、坏 JSON 400、超大 413', async () => {
    expect((await PATCH(req('PATCH', owner, ''), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', owner, '{坏'), ctx())).status).toBe(400);
    const huge = JSON.stringify({ positions: { 'node-writer': { x: 1, y: 2 } }, pad: 'x'.repeat(9000) });
    expect((await PATCH(req('PATCH', owner, huge), ctx())).status).toBe(413);
  });

  it('保存只动这个项目', async () => {
    await PATCH(req('PATCH', owner, { positions: { 'node-scene': { x: 7, y: 7 } } }), ctx());
    expect(await (await GET(req('GET', owner), ctx(other))).json()).toEqual({ positions: {} });
  });
});

describe('v12.454 · 拖完就存(浏览器侧这条线会悄悄断,必须测)', () => {
  it('连续拖动只发最后一次;发的是 PATCH、带 keepalive、坐标已取整', async () => {
    const sent: Array<{ url: string; init: any }> = [];
    const saver = createLayoutSaver(5, async (url, init) => { sent.push({ url, init }); });
    saver.schedule('p-9', roundPositions([{ id: 'node-video', position: { x: 10.4, y: -20.6 } }]));
    saver.schedule('p-9', roundPositions([{ id: 'node-video', position: { x: 99.5, y: 3.2 } }]));
    await new Promise(r => setTimeout(r, 40));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/api/projects/p-9/canvas-layout');
    expect(sent[0].init.method).toBe('PATCH');
    expect(sent[0].init.keepalive).toBe(true);
    expect(JSON.parse(sent[0].init.body).positions).toEqual({ 'node-video': { x: 100, y: 3 } });
  });

  it('明确取消(cancel)后不再发;而卸载走的 flush 要把没发出去的那次**立刻补发**(拖完就切页是常见操作)', async () => {
    const cancelled: any[] = [];
    const s1 = createLayoutSaver(50, async (url, init) => { cancelled.push({ url, init }); });
    s1.schedule('p-9', { 'node-video': { x: 1, y: 2 } });
    s1.cancel();
    await new Promise(r => setTimeout(r, 80));
    expect(cancelled).toEqual([]);

    const flushed: any[] = [];
    const s2 = createLayoutSaver(50, async (url, init) => { flushed.push({ url, init }); });
    s2.schedule('p-9', { 'node-video': { x: 7, y: 8 } });
    s2.flush(); // 相当于组件卸载
    await new Promise(r => setTimeout(r, 10));
    expect(flushed, '拖完立刻离开页面,这次拖动就丢了').toHaveLength(1);
    expect(JSON.parse(flushed[0].init.body).positions).toEqual({ 'node-video': { x: 7, y: 8 } });
    // 补发之后不会再发第二次(定时器已清)
    await new Promise(r => setTimeout(r, 80));
    expect(flushed).toHaveLength(1);
  });

  it('没有待发内容时 flush 什么都不做', async () => {
    const sent: any[] = [];
    const s = createLayoutSaver(5, async (url, init) => { sent.push({ url, init }); });
    s.flush();
    await new Promise(r => setTimeout(r, 30));
    expect(sent).toEqual([]);
  });

  it('接口挂了不抛,但要如实回报 —— 布局是增强项不能打挂画布,可也不能静默丢失', async () => {
    const r = await saveCanvasLayout('p-9', { 'node-video': { x: 1, y: 2 } }, async () => { throw new Error('网络断了'); });
    expect(r).toEqual({ ok: false, reason: '网络不通,画布布局没能保存' });
  });

  it('接口拒了(400 超范围)要把**接口给的原因**回报出来 —— 真机上就是这么静默丢失的', async () => {
    const reasons: string[] = [];
    const saver = createLayoutSaver(5, async () => ({ ok: false, status: 400, json: async () => ({ error: 'node-writer.x 超出 ±100000' }) }), (r) => reasons.push(r));
    saver.schedule('p-9', { 'node-writer': { x: 999999, y: 0 } });
    await new Promise(r => setTimeout(r, 40));
    expect(reasons).toEqual(['node-writer.x 超出 ±100000']);
  });

  it('接口拒了但没给话 → 带上状态码,不说空话;存成功不打扰用户', async () => {
    const reasons: string[] = [];
    const s1 = createLayoutSaver(5, async () => ({ ok: false, status: 403 }), (r) => reasons.push(r));
    s1.schedule('p-9', { 'node-video': { x: 1, y: 2 } });
    await new Promise(r => setTimeout(r, 40));
    expect(reasons[0]).toContain('403');
    const ok: string[] = [];
    const s2 = createLayoutSaver(5, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }), (r) => ok.push(r));
    s2.schedule('p-9', { 'node-video': { x: 1, y: 2 } });
    await new Promise(r => setTimeout(r, 40));
    expect(ok).toEqual([]);
  });

  it('存的位置能被接口收下(白名单 + 范围与真实拖动产物对得上)', () => {
    const positions = roundPositions([
      { id: 'node-director', position: { x: -300.2, y: -300.8 } },
      { id: 'node-producer', position: { x: 1200.6, y: 640.4 } },
    ]);
    const r = sanitizeCanvasPositions(positions);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
