/**
 * v12.318 — 导演台第三版:界面接上(摆位 → 实时体检 → 存 → 渲草图)。
 *
 * ── 预览为什么在客户端画 ──────────────────────────────────────────
 * `lib/stage-blocking` 是零依赖纯几何,浏览器里能直接跑 —— 拖动要跟手就不能有往返。
 * 关键在于**用的是同一个 `projectScene`**:实时预览、构图体检、提示词描述、
 * 服务端渲的 PNG 草图,四处同源。若前端另画一套「差不多」的预览,
 * 用户看到的构图就会和最终出片对不上 —— 那正是本仓栽过五次的「同一语义两套口径」。
 *
 * 服务端只做两件事:落库、渲 PNG。dryRun 是 v12.316 给这个界面预留的,
 * 但真做出来才发现**用不上** —— 既然几何在前端能跑,预览就该完全本地,连 dryRun 都不必发。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MODAL = strip(fs.readFileSync('components/project/director-stage-modal.tsx', 'utf-8'));
const PAGE = strip(fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8'));

describe('v12.318 · 预览与出片同源', () => {
  it('界面直接用 projectScene / auditStaging,不另画一套', () => {
    expect(MODAL).toContain('projectScene');
    expect(MODAL).toContain('auditStaging');
    expect(MODAL).toContain('describeStaging');
  });

  it('**不自己算几何**(与 v12.315/317 立的分工同一条)', () => {
    expect(MODAL, '不该自己算视角').not.toMatch(/Math\.atan\(/);
    expect(MODAL, '不该自己算距离').not.toMatch(/Math\.hypot\(/);
  });

  it('相机预览按 screenTop/screenBottom 画 —— 与 PNG 草图同一套纵向投影', () => {
    expect(MODAL).toContain('p.screenTop');
    expect(MODAL).toContain('p.screenBottom');
  });

  it('远的先画近的后画,遮挡关系与草图一致', () => {
    expect(MODAL).toContain('sort((a, b) => b.distanceM - a.distanceM)');
  });

  it('把**会进提示词的那句**摆在界面上(所见即所得)', () => {
    expect(MODAL).toContain('stageDirectiveForShot');
  });
});

describe('v12.318 · 交互该有的样子', () => {
  it('人和机位都能拖', () => {
    expect(MODAL).toMatch(/kind: 'actor'/);
    expect(MODAL).toMatch(/kind: 'camera'/);
    expect(MODAL).toContain('onPointerMove');
  });

  it('拖动范围夹住,拖不出世界外', () => {
    expect(MODAL).toContain('clamp(');
  });

  it('出画的人在俯视图里变色 —— 不用读文字就知道谁掉出去了', () => {
    expect(MODAL).toMatch(/p\?\.inFrame \?/);
  });

  it('画视野扇形,一眼看出谁在画面里', () => {
    expect(MODAL).toContain('polygon');
    expect(MODAL).toContain('frustum');
  });

  it('**渲草图前先存** —— 服务端按库里的舞台渲,不存就渲的是上一次的位置', () => {
    const i = MODAL.indexOf('async function renderSketch');
    const block = MODAL.slice(i, MODAL.indexOf("mode: 'stage'", i));
    expect(block, '必须先 POST /stage').toContain('/stage`');
  });

  it('角色名直接取剧本,不让用户再敲一遍', () => {
    expect(MODAL).toContain('characterNames');
    expect(PAGE).toContain('scriptShot?.characters');
  });

  it('失败给人话,不是把 HTTP 码甩给用户就完事', () => {
    expect(MODAL).toMatch(/保存失败:/);
    expect(MODAL).toMatch(/渲草图失败:/);
  });
});

describe('v12.318 · 接进项目页(不接就还是孤岛)', () => {
  it('弹窗真的挂上了', () => {
    expect(PAGE).toContain('DirectorStageModal');
    expect(PAGE).toContain('setStageShot');
  });

  it('每个分镜卡片上有入口', () => {
    expect(PAGE).toMatch(/导演台 · 摆位/);
  });

  it('开台前先读该镜已有舞台(否则每次打开都从头摆)', () => {
    const i = PAGE.indexOf('setStageShot({');
    const block = PAGE.slice(Math.max(0, i - 600), i);
    expect(block).toMatch(/\/stage\?shot=/);
  });

  it('读不到舞台也能开台,不因此拦住用户', () => {
    const i = PAGE.indexOf('/stage?shot=');
    const block = PAGE.slice(i, i + 300);
    expect(block).toContain('catch');
  });

  it('已摆位的镜在卡片上标出来', () => {
    expect(PAGE).toContain('stagedShots');
    expect(PAGE).toMatch(/已摆位/);
  });
});

/**
 * 真渲染 —— 这一组是**踩出来的**。
 *
 * 上面 17 条源码断言全绿、tsc 也干净,而项目页在浏览器里直接 500:
 * `stage-scene-store` 里的 `await import('./db-driver')` 看似 client-safe,
 * **webpack 仍会静态分析动态 import**,把 better-sqlite3 打进客户端包 →
 * `Module not found: Can't resolve 'fs'`。修法是把纯函数移回 `stage-blocking`。
 *
 * 教训是:**读源码的断言证明不了组件能打开**。所以把这个风险固化成常驻测试。
 */
describe('v12.318 · 组件真的能渲染(源码断言证明不了这件事)', () => {
  it('导演台弹窗渲得出来,且画出了俯视图与相机预览', async () => {
    const { render, cleanup } = await import('@testing-library/react');
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    const { container, unmount } = render(
      React.createElement(DirectorStageModal, {
        projectId: 'p1', shotNumber: 3, shotTitle: '雨夜对峙',
        characterNames: ['林晚', '陆沉'],
        onClose: () => {},
      }),
    );
    const root = document.body;
    expect(root.textContent).toContain('导演台');
    expect(root.textContent).toContain('林晚');
    expect(root.querySelectorAll('svg').length, '俯视图 + 相机预览两张图').toBeGreaterThanOrEqual(2);
    expect(root.textContent).toContain('渲布局草图');
    unmount(); cleanup(); void container;
  });

  it('**没有任何角色时也不崩**(新项目/没解析出角色的镜)', async () => {
    const { render, cleanup } = await import('@testing-library/react');
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    const { unmount } = render(
      React.createElement(DirectorStageModal, {
        projectId: 'p1', shotNumber: 1, characterNames: [], onClose: () => {},
      }),
    );
    expect(document.body.textContent).toContain('导演台');
    unmount(); cleanup();
  });

  it('带已存舞台打开时,用的是存下来的位置而不是重新铺一遍', async () => {
    const { render, cleanup } = await import('@testing-library/react');
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    const { unmount } = render(
      React.createElement(DirectorStageModal, {
        projectId: 'p1', shotNumber: 2, onClose: () => {},
        initialScene: {
          camera: { x: 0, z: 0, yawDeg: 0, lens: '85', heightM: 0.5 },
          actors: [{ id: 'x', name: '沈青梧', x: 0, z: 4 }],
        },
      }),
    );
    expect(document.body.textContent).toContain('沈青梧');
    expect(document.body.textContent, '85mm 该被选中并显示其视角').toMatch(/24° 视角/);
    expect(document.body.textContent, '0.5m 机位应判为仰拍').toMatch(/仰拍/);
    unmount(); cleanup();
  });

  it('**客户端不得引入服务端模块**(打包炸掉的根因,锁死)', () => {
    expect(MODAL, '导演台不该引用碰数据库的 stage-scene-store').not.toContain('stage-scene-store');
    const blocking = fs.readFileSync('lib/stage-blocking.ts', 'utf-8');
    expect(blocking, '纯几何层不该引入任何服务端依赖').not.toMatch(/from '\.\/db|repos\/|node:fs/);
  });
});
