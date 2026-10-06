/**
 * v12.467 · 出图入口(分镜图重生 / 九宫格候选 / AI 草图 / cameo 重试)按项目画幅。
 *
 * 这几张图是 I2V 的首帧:首帧横了,后面视频按 9:16 出也只能裁或补边。
 * 修前:三条路由不传 aspectRatio 时一律 16:9(一键成片面板的自动重拍从不传);
 * cameo 重试的编排器停在默认 16:9;镜头工坊的两个弹窗没拿到项目画幅,打开就选着 16:9。
 *
 * 路由用真测试库 + 真路由,编排器换成记录入参的假对象(真编排器的出图链路由 v12-467-regen-aspect 之外的
 * 既有用例守着,这里只关心「交给编排器的画幅对不对」)。弹窗用真渲染 + 真点击,断言**发出去的请求体**。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  uid: 'u-v12467-img',
  setAspect: [] as string[],
  images: [] as Array<Record<string, unknown>>,
  cameoAspect: [] as string[],
}));

vi.mock('@/services/hybrid-orchestrator', () => {
  class HybridOrchestrator {
    private aspect = '16:9';
    onProgress: unknown = null;
    setUserStyle() {}
    setPrimaryCharacterRef() {}
    setLockedCharacters() {}
    setAspect(a: string) { h.setAspect.push(a); if (/^\d+:\d+$/.test(a)) this.aspect = a; }
    async generateImage(_p: string, opts: Record<string, unknown>) { h.images.push(opts); return 'https://cdn.example/img.png'; }
    async cameoRetrySingleShot() {
      h.cameoAspect.push(this.aspect);
      return { imageUrl: 'https://cdn.example/cameo.png', cameoScore: 80, cameoRetried: true, finalCw: 125, reasoning: 'ok' };
    }
  }
  return { HybridOrchestrator };
});
vi.mock('@/lib/auth-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/auth-guard')>();
  return { ...m, requireProjectAccess: async () => ({ ok: true, userId: h.uid }) };
});
vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: h.uid }) };
});
vi.mock('@/lib/budget-enforce', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/budget-enforce')>();
  return { ...m, assertBudget: async () => ({ allow: true, guard: {} }) };
});
vi.mock('@/lib/asset-storage', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/asset-storage')>();
  return { ...m, persistAsset: async (u: string) => ({ url: u }) };
});

import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { createAsset } from '@/lib/repos/asset-repo';

const projects: Record<'9:16' | '16:9', string> = { '9:16': '', '16:9': '' };

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '画幅', now());
  for (const aspect of ['9:16', '16:9'] as const) {
    const pid = (await createProject({ userId: h.uid, title: `出图 ${aspect}`, description: 'd', coverUrls: [] }) as { id: string }).id;
    db.prepare('UPDATE projects SET aspect = ? WHERE id = ?').run(aspect, pid);
    await createAsset({ projectId: pid, type: 'character', name: '林晚', mediaUrls: ['https://cdn.example/lin.png'], data: {} });
    await createAsset({ projectId: pid, type: 'storyboard', name: 'Shot 1', shotNumber: 1, mediaUrls: ['https://cdn.example/sb1.png'], data: { description: '她回头' } });
    projects[aspect] = pid;
  }
});
beforeEach(() => { h.setAspect.length = 0; h.images.length = 0; h.cameoAspect.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

const jsonReq = (url: string, body: unknown) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.each(['9:16', '16:9'] as const)('v12.467 · 出图路由 · %s 项目', (aspect) => {
  it('分镜图重生(regenerate-storyboard)不传画幅 → 用项目画幅', async () => {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-storyboard/route');
    const pid = projects[aspect];
    const text = await (await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-storyboard`, {
      shotNumber: 1, customPrompt: '她回头看向门口,逆光', useStyleBible: true, useCref: true,
    }), params(pid))).text();
    expect(text).toContain('"type":"complete"');
    expect(h.images).toHaveLength(1);
    expect(h.images[0].aspectRatio).toBe(aspect);
    expect(h.setAspect).toEqual([aspect]);
  });

  it('九宫格候选(candidates)不传画幅 → 每一格都用项目画幅', async () => {
    const { POST } = await import('@/app/api/projects/[id]/candidates/route');
    const pid = projects[aspect];
    await (await POST(jsonReq(`http://localhost/api/projects/${pid}/candidates`, {
      shotNumber: 1, basePrompt: '她回头看向门口,逆光', count: 4,
    }), params(pid))).text();
    expect(h.images).toHaveLength(4);
    expect(new Set(h.images.map((o) => o.aspectRatio))).toEqual(new Set([aspect]));
  });

  it('AI 草图(shot-sketch generate)不传画幅 → 用项目画幅', async () => {
    const { POST } = await import('@/app/api/projects/[id]/shot-sketch/route');
    const pid = projects[aspect];
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/shot-sketch`, {
      shotNumber: 1, mode: 'generate', sceneDescription: '她站在门口回头',
    }), params(pid));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(h.images).toHaveLength(1);
    expect(h.images[0].aspectRatio).toBe(aspect);
  });

  it('cameo 一致性重画(cameo-retry-storyboard)的编排器是项目画幅', async () => {
    const { POST } = await import('@/app/api/projects/[id]/cameo-retry-storyboard/route');
    const pid = projects[aspect];
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/cameo-retry-storyboard`, { shotNumbers: [1] }), params(pid));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(h.cameoAspect).toEqual([aspect]);
  });
});

describe('v12.467 · 出图路由 · 显式传了画幅仍以请求为准(弹窗里用户手选的)', () => {
  it('9:16 项目里手选 1:1 → 1:1', async () => {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-storyboard/route');
    const pid = projects['9:16'];
    await (await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-storyboard`, {
      shotNumber: 1, customPrompt: '她回头看向门口,逆光', aspectRatio: '1:1',
    }), params(pid))).text();
    expect(h.images[0].aspectRatio).toBe('1:1');
  });
});

describe('v12.467 · 镜头工坊的两个出图弹窗默认选中项目画幅', () => {
  const bodies: Array<{ url: string; body: any }> = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('', { status: 500 }); // 只看发出去的请求;回什么不重要
    }));
  });

  const mount = async (aspect?: string) => {
    const { ShotWorkshopTab } = await import('@/components/project/shot-workshop-tab');
    render(
      <ShotWorkshopTab
        projectId="p-ws"
        aspect={aspect}
        videos={[{ shotNumber: 1, videoUrl: 'https://cdn.example/v1.mp4', meta: { prompt: '她回头看向门口,逆光' } }]}
        storyboards={[{ shotNumber: 1, imageUrl: 'https://cdn.example/sb1.png' }]}
      />,
    );
  };
  const sent = (path: string) => bodies.find((b) => b.url.endsWith(path))?.body;

  it.each([['9:16', '9:16'], [undefined, '16:9']] as const)('项目画幅 %s → 改 prompt 重生发出 %s', async (aspect, want) => {
    await mount(aspect);
    fireEvent.click(screen.getByText('改 prompt 重生'));
    fireEvent.click(await screen.findByText('重生这一镜'));
    await waitFor(() => expect(sent('/regenerate-storyboard')).toBeTruthy());
    expect(sent('/regenerate-storyboard').aspectRatio).toBe(want);
  });

  it.each([['9:16', '9:16'], [undefined, '16:9']] as const)('项目画幅 %s → 九宫格生成候选发出 %s', async (aspect, want) => {
    await mount(aspect);
    fireEvent.click(screen.getByText('九宫格选帧'));
    fireEvent.click(await screen.findByText('生成候选'));
    await waitFor(() => expect(sent('/candidates')).toBeTruthy());
    expect(sent('/candidates').aspectRatio).toBe(want);
  });
});
