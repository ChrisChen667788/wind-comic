/**
 * v12.462 · 导演台补全 —— 接口与库(真库、真存储、真渲 PNG)。
 *
 *   ① 站位真的变了 → 这一镜已出的分镜图 / 视频标 stale(待重渲);没变就不打扰;
 *   ② 这一镜当前草图是导演台渲的 → 保存站位时跟着重渲;AI 画的 / 用户上传的不动;
 *   ③ GET /stage 把当前草图带回来(重开导演台时显示);
 *   ④ 分镜图「整张重生」带上站位句,且落在 `--no text …` 参数之前(修前这条路完全不看导演台);
 *   ⑤ 保存时焦距 / 机高校验不过 → 400,且什么都没存。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u-462' })) }));

const captured: string[] = [];
vi.mock('@/services/hybrid-orchestrator', () => ({
  HybridOrchestrator: class {
    setUserStyle() {}
    setPrimaryCharacterRef() {}
    setAspect() {}
    async generateImage(prompt: string) { captured.push(prompt); return '/api/serve-file?key=00000000000000000000000000000462'; }
  },
}));

import { db, now } from '@/lib/db';
import { createAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { storagePut } from '@/lib/storage';
import { storeShotSketch } from '@/lib/stage-sketch-store';

const PID = `p462-${Date.now()}`;
const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 };
const ACTORS = [{ id: 'a0', name: '林晚', x: -0.7, z: 5 }, { id: 'a1', name: '陆沉', x: 0.7, z: 5 }];

beforeAll(() => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run('u-462', 'u462@test.local', 'x', 'u462', now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, 'v12.462', 'draft', '9:16', ?, ?)`)
    .run(PID, 'u-462', now(), now());
});

const req = (url: string, body?: unknown) => new Request(`http://t${url}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }) as any;
const params = { params: Promise.resolve({ id: PID }) };
async function postStage(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/stage/route');
  const res = await POST(req(`/api/projects/${PID}/stage`, body), params);
  return { status: res.status, body: await res.json() };
}
async function getStage(shot: number) {
  const { GET } = await import('@/app/api/projects/[id]/stage/route');
  return (await GET(req(`/api/projects/${PID}/stage?shot=${shot}`), params)).json();
}
async function stageSketch(shot: number) {
  vi.doMock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-462' }) }));
  const { POST } = await import('@/app/api/projects/[id]/shot-sketch/route');
  const res = await POST(req(`/api/projects/${PID}/shot-sketch`, { shotNumber: shot, mode: 'stage' }), params);
  return { status: res.status, body: await res.json() };
}
const staleOf = (shot: number) => (db.prepare(`SELECT type, stale FROM project_assets WHERE project_id = ? AND shot_number = ? AND type IN ('storyboard','video') ORDER BY type`).all(PID, shot) as any[])
  .map((r) => `${r.type}:${r.stale}`);
const sketchRows = async (shot: number) => (await listAssetsByType(PID, 'storyboard-sketch')).filter((r: any) => Number(r.shot_number) === shot);

describe('v12.462 · 站位变了才标「待重渲」', () => {
  it('第一次摆位:这镜已出的分镜图与视频都是没按站位出的 → 标 stale,并如实回报', async () => {
    await createAsset({ projectId: PID, type: 'storyboard', name: 'sb1', shotNumber: 1, data: {} });
    await createAsset({ projectId: PID, type: 'video', name: 'v1', shotNumber: 1, data: {} });
    const { status, body } = await postStage({ shotNumber: 1, camera: CAM, actors: ACTORS });
    expect(status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.staleMarked).toBe(2);
    expect(staleOf(1)).toEqual(['storyboard:1', 'video:1']);
  });

  it('**原样再存一次 → 不再标**(只是点了保存,没改站位,不该把用户已确认的画面又打成待重渲)', async () => {
    db.prepare(`UPDATE project_assets SET stale = 0 WHERE project_id = ? AND shot_number = 1`).run(PID);
    const { body } = await postStage({ shotNumber: 1, camera: CAM, actors: ACTORS });
    expect(body.changed).toBe(false);
    expect(body.staleMarked).toBe(0);
    expect(staleOf(1)).toEqual(['storyboard:0', 'video:0']);
  });

  it('别的镜不受影响', async () => {
    await createAsset({ projectId: PID, type: 'video', name: 'v2', shotNumber: 2, data: {} });
    await postStage({ shotNumber: 1, camera: { ...CAM, lens: '85' }, actors: ACTORS });
    expect(staleOf(2)).toEqual(['video:0']);
  });
});

describe('v12.462 · 草图跟着站位走', () => {
  it('GET /stage 带回当前草图(没有时为 null)', async () => {
    await postStage({ shotNumber: 3, camera: CAM, actors: ACTORS });
    expect((await getStage(3)).sketch).toBeNull();
    const r = await stageSketch(3);
    expect(r.status).toBe(200);
    const g = await getStage(3);
    expect(g.sketch?.mode).toBe('stage');
    expect(g.sketch?.url).toBeTruthy();
  });

  it('**当前草图是导演台渲的 → 存站位时按新站位重渲**,同镜只留一张', async () => {
    const before = (await getStage(3)).sketch.url;
    const { body } = await postStage({ shotNumber: 3, camera: CAM, actors: [{ ...ACTORS[0], x: -2.5 }, ACTORS[1]] });
    expect(body.sketchRerendered).toBe(true);
    expect(body.sketch.mode).toBe('stage');
    expect(body.sketch.url, '内容寻址:人挪了,图就变了').not.toBe(before);
    expect((await getStage(3)).sketch.url).toBe(body.sketch.url);
    expect(await sketchRows(3)).toHaveLength(1);
  });

  it('站位没变 → 不重渲(省一次渲染,草图也确实没过时)', async () => {
    const before = (await getStage(3)).sketch.url;
    const { body } = await postStage({ shotNumber: 3, camera: CAM, actors: [{ ...ACTORS[0], x: -2.5 }, ACTORS[1]] });
    expect(body.changed).toBe(false);
    expect(body.sketchRerendered).toBe(false);
    expect((await getStage(3)).sketch.url).toBe(before);
  });

  it('**用户上传 / AI 画的草图不动** —— 那是用户自己的选择', async () => {
    const put = await storagePut(Buffer.from('user-sketch'), 'image/png', 'png');
    await storeShotSketch(PID, 4, put.url, { mode: 'set' });
    await postStage({ shotNumber: 4, camera: CAM, actors: ACTORS });
    const { body } = await postStage({ shotNumber: 4, camera: CAM, actors: [{ ...ACTORS[0], x: 2 }, ACTORS[1]] });
    expect(body.changed).toBe(true);
    expect(body.sketchRerendered).toBe(false);
    expect(body.sketch).toEqual({ url: put.url, mode: 'set' });
  });
});

describe('v12.462 · 分镜图整张重生带站位', () => {
  async function regen(shot: number) {
    captured.length = 0;
    const { POST } = await import('@/app/api/projects/[id]/regenerate-storyboard/route');
    const res = await POST(req(`/api/projects/${PID}/regenerate-storyboard`, { shotNumber: shot, customPrompt: 'a rainy street at night, two people facing off' }), params);
    await res.text();   // 读完 SSE 流,生成才算跑完
    return captured[0] || '';
  }

  it('**摆过位的镜:提示词带站位句,且在 --no 参数之前**', async () => {
    // 单独一镜:35mm 下两人都在画内(85mm、9:16 水平视角只有约 14°,前面那几镜的人已出画,站位句本就为空)
    await postStage({ shotNumber: 5, camera: CAM, actors: ACTORS });
    const p = await regen(5);
    expect(p).toContain('. Staging:');
    expect(p).toContain('林晚');
    expect(p.indexOf('. Staging:'), '站位句落在 --no 参数后面会被当成参数的一部分').toBeLessThan(p.indexOf('--no text'));
  });

  it('没摆过位的镜:原样(正常侧)', async () => {
    const p = await regen(9);
    expect(p).toBeTruthy();
    expect(p).not.toContain('Staging');
  });
});

describe('v12.462 · 校验不过什么都不存', () => {
  it('焦距不在档位里 → 400,库里还是上一次的站位', async () => {
    const before = (await getStage(1)).scene.camera.lens;
    const { status, body } = await postStage({ shotNumber: 1, camera: { ...CAM, lens: 'notALens' }, actors: ACTORS });
    expect(status).toBe(400);
    expect(body.error).toContain('焦距');
    expect((await getStage(1)).scene.camera.lens).toBe(before);
  });

  it('机位高度越界 → 400', async () => {
    expect((await postStage({ shotNumber: 1, camera: { ...CAM, heightM: 12 }, actors: ACTORS })).status).toBe(400);
  });
});
