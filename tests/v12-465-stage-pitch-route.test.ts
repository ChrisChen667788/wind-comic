/**
 * v12.465 · 只动了相机(俯仰在 ±8° 内)也算站位变了:导演台草图跟着重渲、已出的分镜图标待重渲。
 *
 * 对抗复审撞到:「变没变」原来只看会进提示词的那句话。俯仰 0→5° 时那句话一字不差(±8° 内都说「平视」),
 * 而草图的地平线已经移了 —— 存了站位,导演台草图却还是旧地平线,草图锁锁的是旧构图。
 * 真库、真存储、真渲 PNG(同 v12-462-stage-route-db 的搭法)。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u-465' })) }));

import { db, now } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';

const PID = `p465-${Date.now()}`;
const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 3 };
const ACTORS = [{ id: 'a0', name: '林晚', x: -0.7, z: 9 }, { id: 'a1', name: '陆沉', x: 0.7, z: 9 }];

beforeAll(() => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run('u-465', 'u465@test.local', 'x', 'u465', now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, 'v12.465', 'draft', '16:9', ?, ?)`)
    .run(PID, 'u-465', now(), now());
});

const req = (url: string, body?: unknown) => new Request(`http://t${url}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }) as any;
const params = { params: Promise.resolve({ id: PID }) };
async function postStage(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/stage/route');
  const res = await POST(req(`/api/projects/${PID}/stage`, body), params);
  return { status: res.status, body: await res.json() };
}
async function renderSketch(shot: number) {
  vi.doMock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-465' }) }));
  const { POST } = await import('@/app/api/projects/[id]/shot-sketch/route');
  return (await POST(req(`/api/projects/${PID}/shot-sketch`, { shotNumber: shot, mode: 'stage' }), params)).json();
}
const staleOf = (shot: number) => (db.prepare(`SELECT stale FROM project_assets WHERE project_id = ? AND shot_number = ? AND type = 'storyboard'`).get(PID, shot) as any)?.stale;

describe('v12.465 · 俯仰 ±8° 内的改动也触发草图重渲', () => {
  it('**俯仰 0 → 5°:提示词一字不差,但算「变了」—— 草图重渲、分镜图标待重渲**', async () => {
    await postStage({ shotNumber: 1, camera: CAM, actors: ACTORS });
    await renderSketch(1);
    await createAsset({ projectId: PID, type: 'storyboard', name: 'sb1', shotNumber: 1, data: {} });
    const a = await postStage({ shotNumber: 1, camera: { ...CAM, pitchDeg: 5 }, actors: ACTORS });
    expect(a.status).toBe(200);
    const b = await postStage({ shotNumber: 1, camera: CAM, actors: ACTORS });
    expect(a.body.directive, '窗口自证:±8° 内提示词那句话确实一样').toBe(b.body.directive);
    expect(a.body.changed).toBe(true);
    expect(a.body.sketchRerendered).toBe(true);
    expect(a.body.staleMarked).toBe(1);
  });

  it('原样再存 → 不算变(正常侧);没设俯仰与俯仰 0 视为同一台相机', async () => {
    await postStage({ shotNumber: 2, camera: CAM, actors: ACTORS });
    await renderSketch(2);
    db.prepare(`UPDATE project_assets SET stale = 0 WHERE project_id = ?`).run(PID);
    await createAsset({ projectId: PID, type: 'storyboard', name: 'sb2', shotNumber: 2, data: {} });
    const same = await postStage({ shotNumber: 2, camera: CAM, actors: ACTORS });
    expect(same.body.changed).toBe(false);
    expect(same.body.sketchRerendered).toBe(false);
    const zero = await postStage({ shotNumber: 2, camera: { ...CAM, pitchDeg: 0 }, actors: ACTORS });
    expect(zero.body.changed, 'pitchDeg 0 与未设是同一台相机').toBe(false);
    expect(staleOf(2)).toBe(0);
  });
});
