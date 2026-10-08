/**
 * v12.466 · 项目色彩空间进分镜出图 —— 编排器里的两条路(真编排器,只把出图这一步换成按实例打桩)。
 *
 *   ① 整片生成 `runStoryboardRenderer`:每镜出图的提示词带项目色彩,且在 `--no …` 参数之前;
 *      没保存过格式的项目一个字都不多(正常侧);
 *   ② 导演复审后重出分镜 `executeReviewFeedback`:同样带上。
 *
 * 路由那三条(整张重生 / 九宫格候选 / 批量 Cameo 重试)在 v12-466-color-space —— 那边要把编排器整个打桩,
 * 与这里要的真编排器冲突,所以分两个文件。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: { apiKey: '', baseURL: '', model: 'test' },
    minimax: { apiKey: 'test-key', groupId: 'test-group', baseURL: 'https://test.local' },
    veo: { apiKey: '', baseURL: '', model: '', format: 'openai' },
    keling: { apiKey: '', baseURL: '' },
    vidu: { apiKey: '', baseURL: '' },
    fal: { apiKey: '' },
    comfyui: { baseURL: '' },
  },
}));
vi.mock('@/services/minimax.service', () => {
  class MinimaxService {
    generateVideo = vi.fn().mockResolvedValue('https://example.com/video.mp4');
    generateImage = vi.fn().mockResolvedValue('https://example.com/img.png');
    isVideoAvailable = () => true;
    isImageAvailable = () => true;
  }
  return { MinimaxService, hasMinimax: () => true };
});
vi.mock('@/services/midjourney.service', () => ({ MidjourneyService: vi.fn(), hasMidjourney: () => false }));

import { db, now } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';

const T = Date.now();
const PID = `p465o-${T}`;        // 保存了 DCI-P3
const PID_NONE = `p465on-${T}`;  // 从没保存过格式
const P3 = '. Color: DCI-P3 wide gamut';

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run('u-465o', 'u465o@test.local', 'x', 'u465o', now());
  for (const id of [PID, PID_NONE]) {
    db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, 'v12.466', 'draft', '16:9', ?, ?)`)
      .run(id, 'u-465o', now(), now());
  }
  await createAsset({ projectId: PID, type: 'project-format', name: 'project-format', data: { colorSpaceId: 'p3', fps: 24, safeArea: false } });
});

const script = {
  title: '测试', synopsis: '测试剧本',
  shots: [
    { shotNumber: 1, sceneDescription: 'a rainy street at night', characters: ['林晚'], dialogue: '', action: '走', emotion: '平静' },
    { shotNumber: 2, sceneDescription: 'a lit window across the street', characters: ['林晚'], dialogue: '', action: '看', emotion: '紧张' },
  ],
};
const chars = [{ character: '林晚', imageUrl: 'https://example.com/char.png', prompt: 'heroine' }];

/** 真编排器,出图换成按实例的桩:记下送进出图的每一句提示词 */
async function orchestratorFor(projectId: string) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
  const orch = new HybridOrchestrator() as any;
  orch.setProjectId(projectId);
  const prompts: string[] = [];
  orch.generateImage = vi.fn(async (prompt: string) => { prompts.push(prompt); return `https://example.com/sb-${prompts.length}.png`; });
  return { orch, prompts };
}

describe('v12.466 · 整片生成:runStoryboardRenderer', () => {
  async function render(projectId: string) {
    const { orch, prompts } = await orchestratorFor(projectId);
    const plans = script.shots.map((s) => ({ shotNumber: s.shotNumber, prompt: s.sceneDescription, planData: {} }));
    const out = await orch.runStoryboardRenderer(plans, script, chars);
    expect(out.length, '两镜都渲出来了').toBe(2);
    return { out, prompts };
  }

  it('**保存了 DCI-P3:每镜出图提示词都带,且在 --no 参数之前**', async () => {
    const { out, prompts } = await render(PID);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const p of prompts) {
      expect(p).toContain(P3);
      expect(p.split(P3).length - 1, '只出现一次').toBe(1);
      expect(p.indexOf(P3), '落在参数后面会被当成参数的一部分').toBeLessThan(p.indexOf('--no text'));
    }
    // 落库的分镜提示词就是出图那句 —— 之后整张重生拿它当底稿,色彩段会被换掉而不是叠加(v12-466-color-space 锁)
    expect(out[0].prompt).toContain(P3);
  });

  it('没保存过格式的项目:一个字都不多(正常侧)', async () => {
    const { prompts } = await render(PID_NONE);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const p of prompts) {
      expect(p, '窗口自证:是这一镜的出图提示词').toMatch(/rainy street|lit window/);
      expect(p).not.toContain('. Color:');
    }
  });
});

describe('v12.466 · 导演复审后重出分镜:executeReviewFeedback', () => {
  async function reviewRegen(projectId: string) {
    const { orch, prompts } = await orchestratorFor(projectId);
    const storyboards = script.shots.map((s) => ({ shotNumber: s.shotNumber, imageUrl: `https://example.com/old-${s.shotNumber}.png`, prompt: s.sceneDescription }));
    const review = { items: [{ shotNumber: 1, severity: 'major', stage: 'storyboard', issue: '构图太空', suggestion: 'closer framing on her face' }] };
    await orch.executeReviewFeedback(review, script, storyboards, []);
    return prompts;
  }

  it('**保存了 DCI-P3:重出那张的提示词带上**', async () => {
    const prompts = await reviewRegen(PID);
    expect(prompts.length, '确实重出了第 1 镜').toBe(1);
    expect(prompts[0]).toContain('closer framing');
    expect(prompts[0]).toContain(P3);
  });

  it('没保存过格式的项目:不带(正常侧)', async () => {
    const prompts = await reviewRegen(PID_NONE);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain('closer framing');
    expect(prompts[0]).not.toContain('. Color:');
  });
});
