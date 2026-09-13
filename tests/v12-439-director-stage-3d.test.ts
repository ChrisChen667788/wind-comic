/**
 * v12.439 —— 3D 导演台接线:画幅从项目一路走到提示词、草图、预览、3D 相机。
 *
 * 几何已按画幅修正(见 v12-439-stage-3d-parity)。但几何认画幅没用 —— **得有人把画幅递进来**。
 * 修前没有任何调用方传画幅:编排器注入提示词、服务端体检、PNG 草图、弹窗预览,
 * 四处全按 36×24 横向底片算,而真库 32 个项目里 27 个是 9:16。
 *
 * 画幅注入口只有一处:`withProjectAspect`(`getStageScene` 内部也走它)。
 * 这里每一条都**真跑**那条路径,而不是 grep 出现过 `aspect`:
 *   同一个站位(人在机位右侧 22°),9:16 项目里必须出画、16:9 项目里必须在画内。
 * 若哪条路径漏接画幅,它就会在 9:16 下把这个人当成在画内 —— 断言就红。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';

const project = { aspect: '9:16' as string | undefined, throws: false };
vi.mock('@/lib/repos/project-repo', () => ({
  getProject: vi.fn(async () => {
    if (project.throws) throw new Error('db down');
    return project.aspect === undefined ? null : { id: 'p1', aspect: project.aspect };
  }),
  getOwnedProject: vi.fn(), deleteProjectCascade: vi.fn(), setProjectArchived: vi.fn(),
}));

const stored: { rows: any[] } = { rows: [] };
vi.mock('@/lib/repos/asset-repo', () => ({
  listAssetsByType: vi.fn(async (_pid: string, type: string) => (type === 'stage-scene' ? stored.rows : [])),
  createAsset: vi.fn(async () => ({ id: 'a1' })),
  listProjectAssets: vi.fn(async () => []), getAsset: vi.fn(), updateAssetDataInProject: vi.fn(),
}));

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u1' })) }));

// shot-sketch 路由的依赖
const put: { png: Buffer | null } = { png: null };
vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: vi.fn(() => ({ sub: 'u1' })) }));
vi.mock('@/lib/db', () => ({
  db: {
    prepare: vi.fn(() => ({
      get: () => ({ id: 'p1', user_id: 'u1', style_id: null, title: 't', status: 'completed', aspect: project.aspect }),
      run: () => ({}),
    })),
  },
  now: () => new Date().toISOString(),
}));
vi.mock('@/lib/project-share', () => ({ canEditProject: vi.fn(async () => true) }));
vi.mock('@/lib/storage', () => ({
  storagePut: vi.fn(async (buf: Buffer) => { put.png = buf; return { url: 'http://local/sketch.png' }; }),
}));
vi.mock('@/lib/asset-storage', () => ({
  persistAsset: vi.fn(async (u: string) => ({ url: u })),
  normalizeAssetRow: vi.fn(() => ({ mediaUrls: [], persistentUrl: null })),
}));

import {
  frameSize, sensorDims, projectScene, stageDirectiveForShot, verticalFovDeg, type StageScene,
} from '@/lib/stage-blocking';
import { withProjectAspect, getStageScene } from '@/lib/stage-scene-store';

const rad = (d: number) => (d * Math.PI) / 180;
/** 机位在原点朝正前,35mm;林晚在右侧 22°、5 米外 —— 9:16 半视角 16.1° 出画,16:9 半视角 27.2° 在画内 */
const EDGE: StageScene = {
  camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 },
  actors: [{ id: 'a', name: '林晚', x: 5 * Math.tan(rad(22)), z: 5 }],
};

beforeEach(() => {
  project.aspect = '9:16';
  project.throws = false;
  stored.rows = [{ id: 's1', shot_number: 3, data: JSON.stringify({ actors: EDGE.actors, camera: EDGE.camera }) }];
  put.png = null;
});

describe('v12.439 · 同一站位,画幅决定进不进画(前提自证)', () => {
  it('9:16 出画、16:9 在画内、不带画幅在画内(修前口径)', () => {
    expect(projectScene({ ...EDGE, aspect: '9:16' })[0].inFrame).toBe(false);
    expect(projectScene({ ...EDGE, aspect: '16:9' })[0].inFrame).toBe(true);
    expect(projectScene(EDGE)[0].inFrame).toBe(true);
    expect(stageDirectiveForShot({ ...EDGE, aspect: '9:16' })).toBe('');
    expect(stageDirectiveForShot({ ...EDGE, aspect: '16:9' })).toContain('林晚');
  });
});

describe('v12.439 · frameSize:画面像素比 = 投影用的底片比', () => {
  it('三档旧尺寸保持不变(草图零回归)', () => {
    expect(frameSize('16:9')).toEqual({ width: 960, height: 540 });
    expect(frameSize('9:16')).toEqual({ width: 540, height: 960 });
    expect(frameSize('1:1')).toEqual({ width: 720, height: 720 });
  });

  it('任意画幅与脏值:宽高比都与 sensorDims 一致(否则草图里人被拉伸)', () => {
    for (const a of [undefined, null, '16:9', '9:16', '1:1', '2.35:1', '4:3', 'wide', '0:1', '']) {
      const { width, height } = frameSize(a);
      const { sW, sH } = sensorDims(a);
      expect(Math.abs(width / height - sW / sH), `aspect=${a}`).toBeLessThan(0.005);
    }
    const { width, height } = frameSize('9:16', 320 * 180);
    expect([width, height]).toEqual([180, 320]);
  });
});

describe('v12.439 · 注入口:withProjectAspect / getStageScene', () => {
  it('挂上项目画幅', async () => {
    expect((await withProjectAspect('p1', EDGE)).aspect).toBe('9:16');
    project.aspect = '16:9';
    expect((await withProjectAspect('p1', EDGE)).aspect).toBe('16:9');
  });

  it('项目画幅覆盖场景里带进来的旧值', async () => {
    expect((await withProjectAspect('p1', { ...EDGE, aspect: '16:9' })).aspect).toBe('9:16');
  });

  it('查项目失败 / 项目不存在 / 画幅空串:舞台原样返回,不丢站位', async () => {
    project.throws = true;
    const a = await withProjectAspect('p1', EDGE);
    expect(a.actors).toHaveLength(1);
    expect(a.aspect).toBeUndefined();
    project.throws = false;
    project.aspect = undefined;
    expect((await withProjectAspect('p1', EDGE)).aspect).toBeUndefined();
    project.aspect = '  ';
    expect((await withProjectAspect('p1', EDGE)).aspect).toBeUndefined();
  });

  it('**编排器那条路**:getStageScene 读出来就带画幅,竖屏项目提示词不再写画外的人', async () => {
    const scene = await getStageScene('p1', 3);
    expect(scene?.aspect).toBe('9:16');
    expect(stageDirectiveForShot(scene), '9:16 下林晚在画外,不该进提示词').toBe('');
    project.aspect = '16:9';
    expect(stageDirectiveForShot(await getStageScene('p1', 3))).toContain('林晚');
  });

  it('画幅不落进舞台数据(改项目画幅,舞台要跟着变)', () => {
    const src = fs.readFileSync('lib/stage-scene-store.ts', 'utf-8');
    const i = src.indexOf('export async function saveStageScene');
    const payloadLine = src.slice(i).split('\n').find((l) => l.includes('const payload ='))!;
    expect(payloadLine).toBeTruthy();
    expect(payloadLine).not.toMatch(/aspect/);
  });
});

describe('v12.439 · 项目详情接口吐画幅(导演台与项目页竖屏 UI 的源头)', () => {
  // 真浏览器里抓到的:单测里弹窗吃 aspect 全绿,打开竖屏项目却显示「画幅 未设」、视角 54° ——
  // 项目页的 project 来自这个接口,而它从 v10.6.0 起就没返回过 aspect。
  const get = async () => {
    const { GET } = await import('@/app/api/projects/[id]/route');
    return (await GET(new Request('http://t/api/projects/p1'), { params: Promise.resolve({ id: 'p1' }) })).json();
  };

  it('竖屏项目返回 9:16', async () => {
    expect((await get()).aspect).toBe('9:16');
  });

  it('横屏返回 16:9;列为空时按库默认 16:9', async () => {
    project.aspect = '16:9';
    expect((await get()).aspect).toBe('16:9');
    project.aspect = '';
    expect((await get()).aspect).toBe('16:9');
  });
});

describe('v12.439 · /stage 路由的体检与提示词按项目画幅算', () => {
  const req = (body: unknown) =>
    new Request('http://t/api/projects/p1/stage', { method: 'POST', body: JSON.stringify(body) }) as any;
  const params = { params: Promise.resolve({ id: 'p1' }) };

  it('POST dryRun:9:16 项目报出画、提示词为空;请求体带 16:9 也不改口径', async () => {
    const { POST } = await import('@/app/api/projects/[id]/stage/route');
    const res = await POST(req({ shotNumber: 3, dryRun: true, actors: EDGE.actors, camera: EDGE.camera, aspect: '16:9' }), params);
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b.directive).toBe('');
    expect(JSON.stringify(b.issues)).toContain('林晚');
  });

  it('POST dryRun:16:9 项目同一站位在画内(正常侧)', async () => {
    project.aspect = '16:9';
    const { POST } = await import('@/app/api/projects/[id]/stage/route');
    const b = await (await POST(req({ shotNumber: 3, dryRun: true, actors: EDGE.actors, camera: EDGE.camera }), params)).json();
    expect(b.directive).toContain('林晚');
  });

  it('GET:读回的场景带画幅,directive 与之一致', async () => {
    const { GET } = await import('@/app/api/projects/[id]/stage/route');
    const b = await (await GET(new Request('http://t/api/projects/p1/stage?shot=3') as any, params)).json();
    expect(b.scene.aspect).toBe('9:16');
    expect(b.directive).toBe('');
  });
});

describe('v12.439 · 舞台草图 PNG 尺寸按项目画幅', () => {
  const pngDims = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  const call = async (body: unknown) => {
    const { POST } = await import('@/app/api/projects/[id]/shot-sketch/route');
    return POST(
      new Request('http://t/api/projects/p1/shot-sketch', { method: 'POST', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: 'p1' }) },
    );
  };

  it('竖屏项目:导演台不传 aspectRatio(它从来不传)→ 仍出 540×960', async () => {
    const res = await call({ shotNumber: 3, mode: 'stage' });
    expect(res.status).toBe(200);
    expect(put.png).toBeTruthy();
    expect(pngDims(put.png!)).toEqual({ w: 540, h: 960 });
  });

  it('请求体 aspectRatio 与项目冲突时以项目为准', async () => {
    await call({ shotNumber: 3, mode: 'stage', aspectRatio: '16:9' });
    expect(pngDims(put.png!)).toEqual({ w: 540, h: 960 });
  });

  it('横屏项目出 960×540(正常侧)', async () => {
    project.aspect = '16:9';
    await call({ shotNumber: 3, mode: 'stage' });
    expect(pngDims(put.png!)).toEqual({ w: 960, h: 540 });
  });
});

describe('v12.439 · 3D 视锥与出片相机同一张角', () => {
  it('视锥四个角点经 three 相机投影恰在画面四角(各画幅、各朝向)', async () => {
    const { frustumSegments } = await import('@/components/project/stage3d-viewport');
    for (const aspect of ['9:16', '16:9', '1:1', '2.35:1', undefined]) {
      for (const yawDeg of [0, 37, -120]) {
        const scene: StageScene = { ...EDGE, aspect, camera: { x: 1, z: -0.5, yawDeg, lens: '24', heightM: 1.2 } };
        const { sW, sH } = sensorDims(aspect);
        const cam = new THREE.PerspectiveCamera(verticalFovDeg('24', aspect), sW / sH, 0.01, 100);
        cam.position.set(1, 1.2, 0.5);
        cam.rotation.set(0, -rad(yawDeg), 0);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        const segs = frustumSegments(scene);
        // 前 8 个点是 4 对 (apex, corner)
        const corners = [1, 3, 5, 7].map((k) => new THREE.Vector3(...segs[k]).project(cam));
        const want = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
        corners.forEach((c, k) => {
          expect(c.x, `aspect=${aspect} yaw=${yawDeg} corner ${k}`).toBeCloseTo(want[k][0], 4);
          expect(c.y, `aspect=${aspect} yaw=${yawDeg} corner ${k}`).toBeCloseTo(want[k][1], 4);
        });
      }
    }
  });

  it('机位视角相机:竖向 fov 取 verticalFovDeg、绕 Y 转 −yaw(与上面对拍用的是同一组参数)', () => {
    const src = fs.readFileSync('components/project/stage3d-viewport.tsx', 'utf-8');
    const i = src.indexOf("view === 'lens' ? (");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, src.indexOf('/>', i));
    expect(block).toContain('fov={vfov}');
    expect(block).toMatch(/rotation=\{\[0, \(-cam\.yawDeg \* Math\.PI\) \/ 180, 0\]\}/);
    expect(src).toMatch(/const vfov = verticalFovDeg\(cam\.lens, scene\.aspect\)/);
  });
});

describe('v12.439 · 弹窗与项目页接线', () => {
  const MODAL = fs.readFileSync('components/project/director-stage-modal.tsx', 'utf-8');
  const PAGE = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');

  it('项目页把画幅传给导演台(锚在 JSX 上,不是 import 那行)', () => {
    const i = PAGE.indexOf('<DirectorStageModal');
    expect(i).toBeGreaterThan(0);
    const block = PAGE.slice(i, PAGE.indexOf('/>', i));
    expect(block).toMatch(/aspect=\{project\?\.aspect\}/);
  });

  it('three 不进项目页首包:弹窗不静态导入 3D 视口', () => {
    const imports = MODAL.split('\n').filter((l) => /^import\s/.test(l));
    expect(imports.some((l) => l.includes('stage3d-viewport'))).toBe(false);
    expect(MODAL).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\('\.\/stage3d-viewport'\)/);
    expect(MODAL).toMatch(/ssr:\s*false/);
  });

  describe('真渲染(jsdom 无 WebGL → 只有平面预览)', () => {
    let restore: (() => void) | null = null;
    afterEach(async () => {
      const { cleanup } = await import('@testing-library/react');
      cleanup();
      restore?.();
      restore = null;
    });

    const open = async (aspect?: string) => {
      const { render } = await import('@testing-library/react');
      const React = (await import('react')).default;
      const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
      render(React.createElement(DirectorStageModal, {
        projectId: 'p1', shotNumber: 3, onClose: () => {}, aspect, initialScene: EDGE,
      }));
      return document.body;
    };
    const redDot = (root: HTMLElement) =>
      [...root.querySelectorAll('circle')].some((c) => c.getAttribute('fill') === 'rgba(180,60,60,0.7)');

    it('9:16:预览画布竖向、视角 32°、林晚标红(出画)', async () => {
      const root = await open('9:16');
      expect(root.querySelector('svg[viewBox="0 0 180 320"]'), '平面预览按 9:16').toBeTruthy();
      expect(root.textContent).toMatch(/32° 视角/);
      expect(redDot(root)).toBe(true);
      expect(root.textContent).toContain('画幅 9:16');
    });

    it('竖屏平面预览的盒子按画幅收窄,不留大片白底冒充画面(浏览器实测抓到)', async () => {
      const root = await open('9:16');
      const svg = root.querySelector('svg[viewBox="0 0 180 320"]') as SVGElement;
      expect(svg.style.maxWidth).toBe('236.25px');
    });

    it('渲出的竖屏草图限高显示,不把弹窗撑成整屏(浏览器实测抓到)', async () => {
      const calls: string[] = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: any) => {
        calls.push(String(url));
        const body = String(url).includes('shot-sketch') ? { sketchUrl: 'http://local/s.png' } : { saved: true };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as any;
      restore = () => { globalThis.fetch = origFetch; };
      const root = await open('9:16');
      const { fireEvent, waitFor } = await import('@testing-library/react');
      fireEvent.click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('渲布局草图'))!);
      await waitFor(() => expect(root.querySelector('img[alt*="布局草图"]')).toBeTruthy());
      const img = root.querySelector('img[alt*="布局草图"]')!;
      expect(img.className).toMatch(/max-h-\[/);
      expect(img.className, 'w-full 会让竖图按宽度撑满、高度失控').not.toMatch(/(^|\s)w-full(\s|$)/);
      expect(calls.some((u) => u.includes('/stage')) && calls.some((u) => u.includes('shot-sketch'))).toBe(true);
    });

    it('只有一个关闭按钮(DialogContent 自带,弹窗别再画一个)', async () => {
      const root = await open('9:16');
      expect(root.querySelectorAll('button[aria-label="关闭"]').length).toBe(1);
    });

    it('16:9:同一站位在画内、视角 54°(正常侧)', async () => {
      const root = await open('16:9');
      expect(root.querySelector('svg[viewBox="0 0 320 180"]')).toBeTruthy();
      expect(root.textContent).toMatch(/54° 视角/);
      expect(redDot(root)).toBe(false);
    });

    it('没有 WebGL2 时不出现 3D 选项(不给点了才坏的按钮)', async () => {
      const root = await open('9:16');
      expect(root.textContent).not.toContain('3D 机位视角');
      expect(root.textContent).toContain('平面');
    });

    it('有 WebGL2 时默认进 3D 机位视角,画布宽高比 = 项目画幅', async () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      // 只骗过弹窗的探测。jsdom 画布尺寸为 0,r3f 不会真建 WebGL 上下文 —— 3D 起不来的退回路径
      // 在下一条单测 GlBoundary、并在真浏览器里强制 getContext 失败实测过。
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
        return id === 'webgl2' ? ({} as any) : null;
      } as any;
      restore = () => { HTMLCanvasElement.prototype.getContext = orig; };
      const root = await open('9:16');
      const { waitFor } = await import('@testing-library/react');
      await waitFor(() => {
        const tab = [...root.querySelectorAll('[role="tab"]')].find((t) => t.textContent === '3D 机位视角');
        expect(tab?.getAttribute('aria-selected')).toBe('true');
      });
      await waitFor(() => expect(root.querySelector('[data-stage3d-view="lens"]')).toBeTruthy(), { timeout: 4000 });
      const box = root.querySelector('[data-stage3d-view="lens"]') as HTMLElement;
      expect(box.style.aspectRatio.replace(/\s/g, ''), 'three 的 aspect 取自画布尺寸').toBe('540/960');
      expect(box.querySelector('canvas')).toBeTruthy();
    }, 10000);

    it('渲染器建不起来:通知退回 2D,且不抛(r3f 的 async configure 里抛错谁都接不住)', async () => {
      const { makeRendererFactory } = await import('@/components/project/stage3d-viewport');
      const fails: unknown[] = [];
      const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
      const factory = makeRendererFactory((e) => fails.push(e));
      let out: unknown;
      expect(() => { out = factory({ canvas: document.createElement('canvas') }); }).not.toThrow();
      warn.mockRestore();
      expect(fails, 'jsdom 没有 WebGL,必须报失败').toHaveLength(1);
      expect(out).toBeInstanceOf(Promise);
      const settled = await Promise.race([
        (out as Promise<unknown>).then(() => 'resolved', () => 'rejected'),
        new Promise((r) => setTimeout(() => r('pending'), 50)),
      ]);
      expect(settled, '拒绝会变成未处理的 Promise 错误;要悬着等调用方卸载').toBe('pending');
    });

    it('GlBoundary:3D 子树抛错时显示 fallback,而不是把整个弹窗打白', async () => {
      const { render } = await import('@testing-library/react');
      const React = (await import('react')).default;
      const { GlBoundary } = await import('@/components/project/stage3d-viewport');
      const Boom = () => { throw new Error('WebGL context lost'); };
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(React.createElement(GlBoundary, { fallback: React.createElement('p', null, '已退回平面预览') },
        React.createElement(Boom)));
      expect(document.body.textContent).toContain('已退回平面预览');
      spy.mockRestore(); warn.mockRestore();
    });
  });
});
