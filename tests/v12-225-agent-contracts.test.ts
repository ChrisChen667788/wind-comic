/**
 * v12.225 — Agent 契约漂移锁(神类拆分第一刀 · 🔴-5)。
 *
 * 病根:hybrid-orchestrator 的 6 个公开方法签名长期是 `any`,于是**声明的接口与实际实现悄悄漂移**——
 * `DirectorReview` 写着 `projectId: string` 必填,可编排器两条路径都从不设;实现恒吐的
 * `passed` / `dimensions` / `status:'passed'` 接口里压根没有。签名是 any,tsc 永远发现不了。
 *
 * 本测试是**运行时契约锁**:直接跑降级复审路径,断言产出对象真的带齐接口声明的字段。
 * tsc 只能证明「代码按接口写」,这里证明「实现真的产出接口承诺的东西」——防再次漂移。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 与 pipeline.test.ts 同款 mock:不打真实引擎
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
    generateSpeech = vi.fn().mockResolvedValue('https://example.com/audio.mp3');
    generateMusic = vi.fn().mockResolvedValue('https://example.com/music.mp3');
    isVideoAvailable = () => true;
    isImageAvailable = () => true;
  }
  return { MinimaxService, hasMinimax: () => true };
});

vi.mock('@/services/midjourney.service', () => ({
  MidjourneyService: vi.fn(),
  hasMidjourney: () => false,
}));

describe('v12.225 DirectorReview 契约不漂移', () => {
  let HybridOrchestrator: any;
  beforeEach(async () => {
    vi.resetModules();
    HybridOrchestrator = (await import('@/services/hybrid-orchestrator')).HybridOrchestrator;
  });

  /** 无 LLM(openai key 为空)→ runDirectorReview 走 fallbackReview 降级路径。 */
  async function review() {
    const orch = new HybridOrchestrator();
    const script = { title: 't', synopsis: 's', shots: [{ shotNumber: 1, dialogue: 'hi', duration: 5 }] };
    const videos = [{ shotNumber: 1, videoUrl: 'https://example.com/v.mp4', duration: 5 }];
    return orch.runDirectorReview(script, videos);
  }

  it('产出带齐 DirectorReview 声明的必填字段', async () => {
    const r = await review();
    expect(typeof r.id).toBe('string');
    expect(typeof r.overallScore).toBe('number');
    expect(typeof r.summary).toBe('string');
    expect(Array.isArray(r.items)).toBe(true);
    expect(typeof r.status).toBe('string');
    expect(typeof r.createdAt).toBe('string');
  }, 30000);

  it('恒吐 passed(旧接口漏声明 —— 编排器/管线/前端都在读它)', async () => {
    const r = await review();
    expect(typeof r.passed).toBe('boolean');
  }, 30000);

  it('降级路径恒吐六维 dimensions(旧接口漏声明)', async () => {
    const r = await review();
    expect(r.dimensions).toBeTruthy();
    for (const k of ['narrative', 'characterDepth', 'sensoryDensity', 'visualQuality', 'pacing', 'audioVisual']) {
      expect(typeof r.dimensions[k]?.score).toBe('number');
      expect(typeof r.dimensions[k]?.comment).toBe('string');
    }
  }, 30000);

  it("status 取值在 'passed'|'pending' 内(旧接口 union 缺 'passed')", async () => {
    const r = await review();
    expect(['passed', 'pending', 'accepted', 'completed']).toContain(r.status);
  }, 30000);

  it('projectId 不由编排器产出 —— 故接口必须标可选(旧接口写死必填)', async () => {
    const r = await review();
    expect(r.projectId).toBeUndefined();
  }, 30000);

  it('overallScore 落在 0-100(旧接口注释写 1-10,与实现不符已校正)', async () => {
    const r = await review();
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
  }, 30000);
});
