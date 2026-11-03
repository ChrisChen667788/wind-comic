/**
 * v13.17 · 剪映草稿的画布 = 项目成片画布 —— 修前竖屏项目导出的草稿是 1920×1080 横屏。
 *
 * ── 来龙去脉 ──────────────────────────────────────────────────────────
 * v13.13 把剪映草稿的帧率接到了项目成片帧率,画布这一半没接:GET(服务端组装,监看页的「导出剪映草稿」)
 * 调 `buildJianYingDraft` 不传宽高,lib/jianying-export 缺省 1920×1080,每个视频素材也跟着写 1920×1080;
 * POST 只认 body 给的宽高,缺省同上。而成片画布由 `projects.aspect`(v12.464 起唯一来源)经合成器的
 * `buildCanvasFit` 决定:9:16 → 720×1280,16:9 → 1280×720,1:1 → 1024×1024。
 * 所以 9:16 项目的草稿在剪映里打开是横屏,和成片对不上。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. GET(真路由 + 真库):9:16 项目 → canvas_config 720×1280(竖),视频素材同;16:9 → 1280×720;
 *    都等于合成器的 `buildCanvasFit(aspect)`;
 * 2. POST:body 没给宽高 → 项目成片画布;给了照用。
 * 期望值都避开修前缺省 1920×1080 —— 撞上缺省的话改没改都绿。
 */
import { describe, it, expect, vi } from 'vitest';

// 剪映导出路由要登录:测试用户就是 project() 建项目时用的 u-v1317(属主守卫照常生效)
vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: 'u-v1317' }) };
});

import { NextRequest } from 'next/server';
import { createAsset } from '@/lib/repos/asset-repo';
import { db, now } from '@/lib/db';
import { buildCanvasFit } from '@/lib/video-reframe';
import { GET as jianyingGET, POST as jianyingPOST } from '@/app/api/projects/[id]/export-jianying/route';

const PID = `v1317-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
// 每次调用一个新项目:vitest 配了 retry,重试若复用同一项目会多插一镜,报错就变成「窗口自证」那条、盖住真正的断言
let seq = 0;
const project = (aspect: string) => {
  const id = `${PID}-${++seq}`;
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-v1317', 'u-v1317@t.local', 'x', 't', 'user', ?)`).run(now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, 'u-v1317', 'v13.17', 'draft', ?, ?, ?)`).run(id, aspect, now(), now());
  return id;
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('v13.17 · 剪映草稿的画布 = 项目成片画布', () => {
  const exportGET = async (aspect: string) => {
    const id = project(aspect);
    await createAsset({ projectId: id, type: 'video', name: 'Shot 1', shotNumber: 1, data: { duration: 2 }, persistentUrl: `/tmp/${id}.mp4` });
    const r = await jianyingGET(new NextRequest(`http://localhost/api/projects/${id}/export-jianying?file=content`), params(id));
    expect(r.status, await r.clone().text()).toBe(200);
    const d = await r.json();
    expect((d.materials?.videos ?? []).length, '窗口自证:草稿里确实排上了那一镜').toBe(1);
    return d;
  };

  it('**GET · 9:16 项目 → 竖屏 720×1280**(修前 1920×1080 横屏),视频素材同', async () => {
    const d = await exportGET('9:16');
    expect(d.canvas_config).toMatchObject({ width: 720, height: 1280 });
    expect(d.materials.videos[0]).toMatchObject({ width: 720, height: 1280 });
  });

  it('**GET · 16:9 项目 → 1280×720**(成片画布,不是修前缺省的 1920×1080)', async () => {
    const d = await exportGET('16:9');
    expect(d.canvas_config).toMatchObject({ width: 1280, height: 720 });
    expect(d.materials.videos[0]).toMatchObject({ width: 1280, height: 720 });
  });

  it('GET 的画布与合成器同一个 buildCanvasFit(9:16 / 16:9 / 1:1)', async () => {
    for (const aspect of ['9:16', '16:9', '1:1']) {
      const { w, h } = buildCanvasFit(aspect);
      const d = await exportGET(aspect);
      expect(d.canvas_config, aspect).toMatchObject({ width: w, height: h });
    }
  });

  it('**POST 没给宽高** → 项目成片画布;显式给了照用', async () => {
    const id = project('9:16');
    const post = (body: object) => jianyingPOST(new NextRequest(`http://localhost/api/projects/${id}/export-jianying`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), params(id));
    const clips = [{ path: '/tmp/v1317-jy-a.mp4', durationSec: 2 }];
    const r1 = await post({ clips });
    expect(r1.status, await r1.clone().text()).toBe(200);
    expect((await r1.json()).draftContent.canvas_config).toMatchObject({ width: 720, height: 1280 });
    // 显式值避开成片画布和修前缺省两者,才看得出确实是照 body 用的
    const r2 = await post({ clips, width: 1080, height: 1920 });
    expect((await r2.json()).draftContent.canvas_config).toMatchObject({ width: 1080, height: 1920 });
  });
});
