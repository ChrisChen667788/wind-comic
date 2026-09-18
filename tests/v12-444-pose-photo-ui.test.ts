/**
 * v12.444 —— 「照片识别」按钮:失败要说人话,资产要真的进得了镜像。
 *
 * 纯函数那一半在 v12-444-pose-from-photo 里验;这里验的是**接线与失败面**:
 * 识别成功要真的写回人物;三种失败(设备不支持 / 部署缺模型 / 照片里没人)要给三种不同的话,
 * 而不是一个转圈的按钮 —— 这是本仓对「静默失效」的一贯口径。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mock = { landmarks: [] as any[], throwOn: null as null | string };
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async (base: string) => { if (mock.throwOn === 'wasm') throw new Error('WebAssembly SIMD not supported'); return { base }; }) },
  PoseLandmarker: {
    createFromOptions: vi.fn(async () => {
      if (mock.throwOn === 'model') throw new Error('Failed to load model: 404');
      return { detect: () => ({ landmarks: mock.landmarks }), close: () => {} };
    }),
  },
}));
vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: () => {} })));

const IDX = { nose: 0, lShoulder: 11, rShoulder: 12, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 };
function standing(extra: Partial<Record<keyof typeof IDX, [number, number, number?]>> = {}) {
  const base: Record<string, [number, number, number?]> = {
    nose: [0.5, 0.22], lShoulder: [0.38, 0.3], rShoulder: [0.62, 0.3], lWrist: [0.36, 0.55], rWrist: [0.64, 0.55],
    lHip: [0.43, 0.5], rHip: [0.57, 0.5], lKnee: [0.43, 0.7], rKnee: [0.57, 0.7], lAnkle: [0.43, 0.9], rAnkle: [0.57, 0.9],
    ...extra as any,
  };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  for (const [k, v] of Object.entries(base)) lm[(IDX as any)[k]] = { x: v[0], y: v[1], visibility: v[2] ?? 1 };
  return lm;
}

const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35' as const, heightM: 1.6 };
const open = async () => {
  const { render, cleanup } = await import('@testing-library/react');
  cleanup();
  const React = (await import('react')).default;
  const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
  render(React.createElement(DirectorStageModal, {
    projectId: 'p1', shotNumber: 1, onClose: () => {}, aspect: '16:9',
    initialScene: { camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }] },
  }));
};
const pick = async () => {
  const { fireEvent, waitFor } = await import('@testing-library/react');
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'ref.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(document.querySelector('[data-pose-photo-msg]')).toBeTruthy(), { timeout: 4000 });
  return document.querySelector('[data-pose-photo-msg]')!.textContent || '';
};

beforeEach(() => { mock.landmarks = [standing({ rWrist: [0.68, 0.12] })]; mock.throwOn = null; });
afterEach(async () => { (await import('@testing-library/react')).cleanup(); });

describe('v12.444 · 识别成功就写回人物', () => {
  it('举手的照片 → 姿态填「举手」、朝向填正面,描述与提示词跟着变', async () => {
    await open();
    const msg = await pick();
    expect(msg).toContain('举手');
    const sel = document.querySelector('[data-pose-row="a"] select') as HTMLSelectElement;
    expect(sel.value).toBe('arm-raised');
    const desc = [...document.querySelectorAll('p')].map((e) => e.textContent || '').find((t) => t.includes('水平视角'))!;
    expect(desc).toContain('举手');
    expect(desc).toContain('正面朝镜头');
    expect(document.querySelector('details code')!.textContent).toContain('one arm raised overhead');
  });

  it('置信度低时明确要用户自己核对(猜错会直接影响出片)', async () => {
    // 侧身 + 看不见脸 → 朝向置信度 0.45,整体判低
    mock.landmarks = [standing({ lShoulder: [0.49, 0.3], rShoulder: [0.53, 0.3], nose: [0.5, 0.22, 0.1] })];
    await open();
    const msg = await pick();
    expect(msg).toContain('不太确定');
    expect(msg).toContain('请自己核对');
  });
});

describe('v12.444 · 三种失败三种话', () => {
  it('设备/浏览器不支持 wasm', async () => {
    mock.throwOn = 'wasm';
    await open();
    expect(await pick()).toContain('这台设备');
  });

  it('这份部署没带模型文件', async () => {
    mock.throwOn = 'model';
    await open();
    expect(await pick()).toContain('没带姿态模型');
  });

  it('照片里没认出人', async () => {
    mock.landmarks = [];
    await open();
    const msg = await pick();
    expect(msg).toContain('没认出人');
    expect(msg, '真机实测:背面照最常触发这条,直接给出路').toContain('背面照');
  });

  it('认出人但关键部位被挡 → 说清是判不准,不是没人', async () => {
    const blurred = standing();
    blurred[IDX.lShoulder] = { ...blurred[IDX.lShoulder], visibility: 0.1 };
    mock.landmarks = [blurred];
    await open();
    const msg = await pick();
    expect(msg).toContain('判不准');
    expect(document.querySelector('[data-pose-row="a"] select')!.getAttribute('value') ?? (document.querySelector('[data-pose-row="a"] select') as HTMLSelectElement).value).toBe('');
  });
});

describe('v12.444 · 资产与打包', () => {
  const REPO = process.cwd();
  it('模型随仓库提交(构建期不联网),wasm 由脚本从 node_modules 拷且只拷 SIMD 版', () => {
    const model = path.join(REPO, 'public/vendor/mediapipe/pose_landmarker_lite.task');
    expect(fs.existsSync(model), '模型文件应随仓库提交,构建期不下载').toBe(true);
    expect(fs.statSync(model).size).toBeGreaterThan(1_000_000);
    // wasm 是可再生产物(12MB),不入库 —— 所以这里锁的是「脚本会拷、且只拷 SIMD 那两个」
    const script = fs.readFileSync(path.join(REPO, 'scripts/fetch-pose-model.mjs'), 'utf-8');
    const list = script.slice(script.indexOf('const WASM_FILES'), script.indexOf(';', script.indexOf('const WASM_FILES')));
    expect(list).toContain('vision_wasm_internal.wasm');
    expect(list, 'non-SIMD 回退版再要 11MB,不带').not.toContain('nosimd');
    const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf-8');
    expect(ignore, 'wasm 不入库').toContain('/public/vendor/mediapipe/*.wasm');
    expect(ignore, '模型要入库(别被同目录规则误伤)').not.toContain('/public/vendor/mediapipe/*.task');
    // Dockerfile 整目录 COPY public/,所以这些文件天然进镜像;顺手锁住这个前提
    expect(fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8')).toMatch(/COPY .*\/app\/public \.\/public/);
  });

  it('MediaPipe 只在点按钮时才加载(600KB JS + 12MB wasm 不能进项目页首包)', () => {
    const btn = fs.readFileSync(path.join(REPO, 'components/project/pose-photo-button.tsx'), 'utf-8');
    const statics = btn.split('\n').filter((l) => /^import\s/.test(l));
    expect(statics.some((l) => l.includes('@mediapipe')), '不得静态导入').toBe(false);
    expect(btn).toMatch(/await import\('@mediapipe\/tasks-vision'\)/);
  });

  it('构建前自动把 wasm 从 node_modules 拷过来(换机器/CI 也不会缺)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf-8'));
    expect(pkg.scripts.prebuild).toContain('fetch-pose-model');
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBeTruthy();
  });
});
