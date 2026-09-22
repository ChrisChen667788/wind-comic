/**
 * v12.448 · 三条出片路径都从同一个注入口取参考视频(整片生成 / 单镜重生 / 审片重生)。
 *
 * 用假引擎真跑编排器:断言**发给 MiniMax 的选项**里有没有参考视频、回报有没有变成 `refVideo` 事件、
 * 以及挂了参考视频的镜不再预报 S2V 的「丢了几张角度图」(那一镜要么走 H3 发出去,要么由回报说明为何被忽略)。
 * 三条路径逐条测 —— 这个仓在「改了主路径忘了旁路」上栽过太多次。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ engine: string; frame: string; opts: any }>,
  refByShot: {} as Record<number, string>,
  outcome: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: { apiKey: '', baseURL: '', model: 'test' },
    minimax: { apiKey: 'test-key', groupId: 'g', baseURL: 'https://test.local' },
    veo: { apiKey: '', baseURL: '', model: '', format: 'openai' },
    keling: { apiKey: '', baseURL: '' },
    vidu: { apiKey: '', baseURL: '' },
    fal: { apiKey: '' },
    comfyui: { baseURL: '' },
  },
}));

vi.mock('@/services/minimax.service', () => {
  class MinimaxService {
    generateVideo = vi.fn(async (frame: string, _p: string, opts: any) => {
      h.calls.push({ engine: 'minimax', frame, opts });
      // 模拟服务层的回报(真实现见 tests/v12-448-ref-video-service)
      if (opts?.referenceVideoUrl && h.outcome) opts.onRefOutcome?.(h.outcome);
      return 'https://example.com/minimax.mp4';
    });
    generateImage = vi.fn().mockResolvedValue('https://example.com/img.png');
    generateSpeech = vi.fn().mockResolvedValue('https://example.com/a.mp3');
    generateMusic = vi.fn().mockResolvedValue('https://example.com/m.mp3');
    isVideoAvailable = () => true;
    isImageAvailable = () => true;
  }
  return { MinimaxService, hasMinimax: () => true };
});
vi.mock('@/services/midjourney.service', () => ({ MidjourneyService: vi.fn(), hasMidjourney: () => false }));

// 只把「读库」换成按镜号查表;回报 / onNoRef / 文案用真实现(见 tests/v12-448-ref-video-rules)
vi.mock('@/lib/shot-ref-video-store', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    refVideoOptsForShot: async (projectId: string | undefined, shot: number, report: (e: any) => void, onNoRef: () => void = () => {}) => {
      const url = projectId === 'p1' ? h.refByShot[shot] : undefined;
      if (!url) { onNoRef(); return {}; }
      return { referenceVideoUrl: url, onRefOutcome: (o: any) => { report({ shotNumber: shot, ...o }); if (o.status === 'ignored') onNoRef(); } };
    },
  };
});

const FRONT = 'https://cdn.example/front.png';
const SIDE = 'https://cdn.example/side.png';
const REF = 'https://cdn.example/move.mp4';

let HybridOrchestrator: any;
beforeAll(async () => {
  HybridOrchestrator = (await import('@/services/hybrid-orchestrator')).HybridOrchestrator;
}, 120000);

beforeEach(() => { h.calls.length = 0; h.refByShot = {}; h.outcome = null; });

const script = {
  title: 't', synopsis: 's',
  shots: [
    { shotNumber: 1, sceneDescription: '林晚回头', characters: ['林晚'], dialogue: '', action: '回头', emotion: '平静' },
    { shotNumber: 2, sceneDescription: '林晚奔跑', characters: ['林晚'], dialogue: '', action: '跑', emotion: '急' },
  ],
};
const boards = [
  { shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: '林晚回头' },
  { shotNumber: 2, imageUrl: 'https://example.com/sb2.png', prompt: '林晚奔跑' },
];

function orchWithEvents() {
  const orch = new HybridOrchestrator();
  const events: Array<[string, any]> = [];
  orch.onProgress = (t: string, d: unknown) => events.push([t, d]);
  orch.setLockedCharacters([{ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: [{ role: 'side', url: SIDE }] }]);
  return { orch, events, of: (t: string) => events.filter(([k]) => k === t).map(([, d]) => d) };
}

describe('v12.448 · 整片生成(runVideoProducer)', () => {
  it('只有挂了参考视频的那一镜带上它;回报变成 refVideo 事件;这一镜不再预报 S2V 丢图', async () => {
    const { orch, of } = orchWithEvents();
    orch.setProjectId('p1');
    h.refByShot = { 2: REF };
    h.outcome = { status: 'sent', engine: 'minimax-h3', imagesSent: 3, imagesDropped: 0 };
    await orch.runVideoProducer(boards, 'minimax', [{ character: '林晚', imageUrl: FRONT }], [], script);

    expect(h.calls).toHaveLength(2);
    const withRef = h.calls.filter((c) => c.opts?.referenceVideoUrl === REF);
    expect(withRef, '只有第 2 镜带参考视频').toHaveLength(1);
    expect(h.calls.filter((c) => !c.opts?.referenceVideoUrl)).toHaveLength(1);

    expect(of('refVideo')).toEqual([{ shotNumber: 2, status: 'sent', engine: 'minimax-h3', imagesSent: 3, imagesDropped: 0 }]);
    // 第 1 镜(没挂参考视频)照旧预报 S2V 丢了 1 张角度图;第 2 镜发出去了,不报
    expect(of('refUsage').map((u: any) => u.shotNumber)).toEqual([1]);
    // 看得见:整片生成的对话流(agentTalk)里有这两句
    const talk = of('agentTalk').map((t: any) => t.text).join('\n');
    expect(talk).toContain('第 2 镜按参考视频的动作出片');
    expect(talk).toContain('第 1 镜:MiniMax 旧接口');
  }, 60000);

  it('项目号没设(不是这个项目)→ 查不到参考视频,整片与修前完全一样', async () => {
    const { orch, of } = orchWithEvents();
    h.refByShot = { 1: REF, 2: REF };
    await orch.runVideoProducer(boards, 'minimax', [{ character: '林晚', imageUrl: FRONT }], [], script);
    expect(h.calls.every((c) => !c.opts?.referenceVideoUrl)).toBe(true);
    expect(of('refVideo')).toEqual([]);
    expect(of('refUsage')).toHaveLength(2);
  }, 60000);
});

describe('v12.448 · 单镜重生(自愈 / 每日重跑 / 剪辑师重生共用)', () => {
  it('挂了参考视频:带上它,且被忽略时的回报变成 refVideo 事件', async () => {
    const { orch, of } = orchWithEvents();
    h.refByShot = { 2: REF };
    h.outcome = { status: 'ignored', reason: '参考视频只能走 MiniMax H3(只能按量付费)' };
    const clip = await orch.regenerateShot(2, boards[1], { videoProvider: 'minimax', projectId: 'p1' });
    expect(clip.videoUrl).toBe('https://example.com/minimax.mp4');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].opts.referenceVideoUrl).toBe(REF);
    expect(h.calls[0].opts.subjectReferences?.[0]?.imageUrl, '原有的主体参考不能被参考视频挤掉').toBe(FRONT);
    expect(of('refVideo')).toEqual([{ shotNumber: 2, status: 'ignored', reason: '参考视频只能走 MiniMax H3(只能按量付费)' }]);
    // 被忽略 → 这一镜回落旧接口,角度图同样被丢 —— 必须补报(对抗复查挖出:之前这里不报)
    expect(of('refUsage').map((u: any) => u.shotNumber)).toEqual([2]);
    // 看得见:单镜重生的状态行读 status
    const status = of('status').map((x: any) => x.message).join('\n');
    expect(status).toContain('第 2 镜的参考视频没用上');
    expect(status).toContain('按量付费');
  }, 60000);

  it('没挂:不带参考视频,照旧预报 S2V 丢图', async () => {
    const { orch, of } = orchWithEvents();
    await orch.regenerateShot(1, boards[0], { videoProvider: 'minimax', projectId: 'p1' });
    expect(h.calls[0].opts.referenceVideoUrl).toBeUndefined();
    expect(of('refUsage')).toHaveLength(1);
    expect(of('refVideo')).toEqual([]);
  }, 60000);
});

describe('v12.448 · 审片反馈后的重生(executeReviewFeedback)', () => {
  it('同样从注入口取参考视频', async () => {
    const { orch, of } = orchWithEvents();
    orch.setProjectId('p1');
    h.refByShot = { 2: REF };
    h.outcome = { status: 'sent', engine: 'minimax-h3', imagesSent: 2, imagesDropped: 0 };
    const review = { items: [{ severity: 'critical', stage: 'video', shotNumber: 2, issue: '动作僵硬' }] };
    await orch.executeReviewFeedback(review, script, boards, [{ shotNumber: 2, videoUrl: 'https://example.com/old.mp4' }]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].opts.referenceVideoUrl).toBe(REF);
    expect(of('refVideo')).toEqual([{ shotNumber: 2, status: 'sent', engine: 'minimax-h3', imagesSent: 2, imagesDropped: 0 }]);
    expect(of('refUsage'), '发出去了就不该再报 S2V 丢图').toEqual([]);
  }, 60000);
});
