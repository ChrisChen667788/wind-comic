/**
 * v12.441 —— 姿态预设进提示词。
 *
 * 朝向(v12.440)说的是「身子朝哪」,姿态说的是「在干什么」。两件事分开存、分开进提示词:
 * 朝向是连续角度、要跟机位一起算;姿态是固定词表、与机位无关。
 *
 * 为什么不给自由文本:提示词全链路是英文(v12.6.1),用户填中文动作会被视频模型
 * 当画面文字渲染出来(v2.22 的 CJK 乱码)。词表每项对应一句写死的英文,顺带保证
 * 同一个动作在每一镜的说法一致。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u1' })) }));
vi.mock('@/lib/repos/project-repo', () => ({ getProject: vi.fn(async () => ({ id: 'p1', aspect: '16:9' })) }));
const stored: { rows: any[] } = { rows: [] };
vi.mock('@/lib/repos/asset-repo', () => ({
  listAssetsByType: vi.fn(async () => stored.rows),
  createAsset: vi.fn(async () => ({ id: 'x' })),
}));

import {
  POSE_PRESETS, poseOf, projectScene, stageDirectiveForShot, describeStaging,
  type StageScene, type StageCamera, type PosePresetId,
} from '@/lib/stage-blocking';

const CAM: StageCamera = { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 };
const scene = (posePreset?: unknown, facingDeg?: number): StageScene => ({
  camera: CAM, aspect: '16:9',
  actors: [{ id: 'a', name: '林晚', x: 0, z: 5, facingDeg, posePreset: posePreset as PosePresetId }],
});

describe('v12.441 · 词表本身', () => {
  it('每一项都有中文界面名与英文提示词,英文不含中日韩字符', () => {
    const ids = Object.keys(POSE_PRESETS) as PosePresetId[];
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const id of ids) {
      const p = POSE_PRESETS[id];
      expect(p.cn.length, id).toBeGreaterThan(0);
      expect(p.en, id).toMatch(/^[\x20-\x7E]+$/);
      expect(p.en, `${id} 的英文不该带情绪/镜头语言`).not.toMatch(/angry|sad|close-up|camera/i);
    }
    expect(new Set(ids.map((i) => POSE_PRESETS[i].en)).size, '英文短语不得重复').toBe(ids.length);
  });

  it('未设 / 不认识的 id / 非字符串 → 当未设,不抛错', () => {
    expect(poseOf({})).toBeNull();
    expect(poseOf({ posePreset: undefined })).toBeNull();
    expect(poseOf({ posePreset: 'moonwalk' as PosePresetId })).toBeNull();
    expect(poseOf({ posePreset: 42 as unknown as PosePresetId })).toBeNull();
    expect(poseOf({ posePreset: 'toString' as PosePresetId }), '原型链上的键不算词表项').toBeNull();
    expect(poseOf({ posePreset: 'sitting' })!.en).toBe('seated');
  });
});

describe('v12.441 · 进提示词与中文描述', () => {
  it('设了姿态:英文短语接在朝向之后', () => {
    expect(stageDirectiveForShot(scene('arm-raised', 180)))
      .toBe('. Staging: 林晚 at frame center in full shot, facing camera, one arm raised overhead');
    expect(describeStaging(scene('arm-raised', 180))).toContain('正面朝镜头,举手');
  });

  it('只设姿态不设朝向:只多出姿态那一段', () => {
    expect(stageDirectiveForShot(scene('running')))
      .toBe('. Staging: 林晚 at frame center in full shot, running at full stride');
    expect(describeStaging(scene('running'))).toContain('米,奔跑)');
  });

  it('没设姿态:与 v12.440 逐字相同(旧数据零影响)', () => {
    expect(stageDirectiveForShot(scene())).toBe('. Staging: 林晚 at frame center in full shot');
    expect(stageDirectiveForShot(scene('moonwalk')), '脏值与未设同样处理').toBe('. Staging: 林晚 at frame center in full shot');
    expect(describeStaging(scene())).toBe('平视机位,54° 水平视角;林晚位于画面中央(全景,距机位约 5.0 米)。');
  });

  it('画外的人不进提示词,他的姿态也不进', () => {
    const s: StageScene = {
      camera: CAM, aspect: '16:9',
      actors: [
        { id: 'a', name: '林晚', x: 0, z: 5, posePreset: 'sitting' },
        { id: 'b', name: '陆沉', x: 9, z: 5, posePreset: 'running' },
      ],
    };
    expect(projectScene(s).find((p) => p.id === 'b')!.inFrame).toBe(false);
    const d = stageDirectiveForShot(s);
    expect(d).toContain('seated');
    expect(d).not.toContain('running');
  });

  it('多人各自的姿态挂在各自那一段上(不是笼统追在末尾)', () => {
    const s: StageScene = {
      camera: CAM, aspect: '16:9',
      actors: [
        { id: 'a', name: '林晚', x: -1.5, z: 5, posePreset: 'kneeling' },
        { id: 'b', name: '陆沉', x: 1.5, z: 5, posePreset: 'pointing' },
      ],
    };
    const d = stageDirectiveForShot(s);
    expect(d).toMatch(/林晚[^;]*kneeling on one knee/);
    expect(d).toMatch(/陆沉[^;]*pointing with one arm extended/);
    expect(d.indexOf('kneeling'), '各自的姿态必须在各自那半句里').toBeLessThan(d.indexOf('陆沉'));
  });
});

describe('v12.441 · 落库与出片路径', () => {
  const post = async (actor: Record<string, unknown>, dryRun = true) => {
    const { POST } = await import('@/app/api/projects/[id]/stage/route');
    const res = await POST(new Request('http://t/api/projects/p1/stage', {
      method: 'POST', body: JSON.stringify({ shotNumber: 1, dryRun, camera: CAM, actors: [actor] }),
    }) as any, { params: Promise.resolve({ id: 'p1' }) });
    return { status: res.status, body: await res.json() };
  };

  it('词表外的 posePreset → 400(不落库后再被几何层静默忽略)', async () => {
    const r = await post({ id: 'a', x: 0, z: 5, posePreset: 'moonwalk' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('posePreset');
  });

  it('null / 空串视同清除;合法值照常通过', async () => {
    const { createAsset } = await import('@/lib/repos/asset-repo');
    (createAsset as any).mockClear();
    stored.rows = [];
    const cleared = await post({ id: 'a', name: '林晚', x: 0, z: 5, posePreset: null }, false);
    expect(cleared.status).toBe(200);
    expect('posePreset' in (createAsset as any).mock.calls.at(-1)[0].data.actors[0]).toBe(false);
    const ok = await post({ id: 'a', name: '林晚', x: 0, z: 5, posePreset: 'crouching' });
    expect(ok.status).toBe(200);
    expect(ok.body.directive).toContain('crouching low');
    expect(ok.body.description).toContain('蹲下');
  });

  it('**编排器与单镜重生那条路**:落库的姿态读回来就在提示词里', async () => {
    stored.rows = [{ id: 's', shot_number: 7, data: JSON.stringify({ camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5, posePreset: 'covering-face' }] }) }];
    const { getStageScene, withStageDirective } = await import('@/lib/stage-scene-store');
    expect(stageDirectiveForShot(await getStageScene('p1', 7))).toContain('hands covering the face');
    expect(await withStageDirective('p1', 7, 'she sobs')).toContain('she sobs. Staging: ');
  });
});

describe('v12.441 · 导演台能选姿态', () => {
  it('每个人物一行下拉,默认「未设」,选完描述与提示词都跟着变', async () => {
    const { render, cleanup } = await import('@testing-library/react');
    const { fireEvent } = await import('@testing-library/react');
    const React = (await import('react')).default;
    const { DirectorStageModal } = await import('@/components/project/director-stage-modal');
    cleanup();
    render(React.createElement(DirectorStageModal, {
      projectId: 'p1', shotNumber: 1, onClose: () => {}, aspect: '16:9',
      initialScene: { camera: CAM, actors: [{ id: 'a', name: '林晚', x: 0, z: 5 }, { id: 'b', name: '陆沉', x: 1.2, z: 6 }] },
    }));
    const rows = document.querySelectorAll('[data-pose-row]');
    expect(rows.length, '每个人物一行').toBe(2);
    const sel = document.querySelector('[data-pose-row="a"] select') as HTMLSelectElement;
    expect(sel.value).toBe('');
    // 别拿整个弹窗的文本判 —— 下拉里本来就列着「举手」这一项。只看构图描述那一段。
    const desc = () => [...document.querySelectorAll('p')].map((e) => e.textContent || '').find((t) => t.includes('平视机位')) || '';
    expect(desc()).not.toContain('举手');
    fireEvent.change(sel, { target: { value: 'arm-raised' } });
    expect(desc()).toContain('举手');
    const code = document.querySelector('details code')!.textContent!;
    expect(code).toContain('one arm raised overhead');
    expect(code).not.toContain('pointing');
    fireEvent.change(sel, { target: { value: '' } });
    expect(sel.value, '清除后回到「未设」,不能落到某个默认姿态').toBe('');
    expect(document.querySelector('details code')!.textContent, '清除后与没设过时逐字相同')
      .toBe('. Staging: 林晚 at frame center in full shot; 陆沉 right of center in full shot');
    expect(desc()).toBe('平视机位,54° 水平视角;林晚位于画面中央(全景,距机位约 5.0 米);陆沉位于中偏右(全景,距机位约 6.1 米)。');
    cleanup();
  });
});
