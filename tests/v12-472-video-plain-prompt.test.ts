/**
 * v12.472 · 分镜出图提示词拿去出视频时,先转纯文本。
 *
 * 病:分镜提示词是给 MJ 出图写的(`getUnifiedStoryboardRenderPrompt` + `optimizeMidjourneyPrompt`),
 * v12.471 之前的模板还写死了 `--ar 16:9 --s 250 --cw 90`,末尾再挂 `--no text --no words …`。
 * 单镜重生、审片重生、主管线的兜底把它**原样**当视频提示词发给 Veo / MiniMax / HappyHorse / 可灵 ——
 * 这几家的画幅都走独立字段(videoAspect),官方接口没有一家定义 `--` 语法,
 * 于是竖屏项目的请求里,画幅字段写 9:16、正文写 `--ar 16:9`。本地库竖屏项目的分镜里 205 / 241 条是这样。
 *
 * 这里真跑编排器,只把引擎换成记录入参的假服务:断言的是**引擎收到的提示词**,
 * 不是源码里出现过 toPlainPrompt。每条路径都同时断言正文还在(内容词、`no text` 改写成普通文字),
 * 免得「发了个空串」也能满足「没有 MJ 参数」。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ engine: string; prompt: string }>,
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
    generateVideo = vi.fn(async (_frame: string, prompt: string) => {
      h.calls.push({ engine: 'minimax', prompt });
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

/** v12.471 之前存进库的分镜提示词的形状(参数夹在正文中间、竖屏项目也写着 16:9) */
const LEGACY =
  '林晚回头看向门口, anime style, professional cinematography --ar 16:9 --s 250 --cw 90, ' +
  'composition: 主体偏右三分线, character action: 林晚攥紧衣角, vertical 9:16 portrait composition ' +
  '--no text --no words --no watermark';
/** 正文里该留下的:内容词、竖屏构图描述、`--no` 改写成的普通文字 */
const KEPT = ['林晚回头看向门口', 'composition: 主体偏右三分线', 'character action: 林晚攥紧衣角', 'vertical 9:16 portrait composition', 'no text', 'no watermark'];
const MJ_SYNTAX = /(^|\s)--[a-z]/i;

const OK = 'https://example.com/ok.mp4';
/** 记录第 at 个参数(提示词在各引擎签名里的位置不同:HappyHorse 第 0 个、首尾帧第 2 个、其余第 1 个) */
const record = (engine: string, at = 1) => async (...args: unknown[]) => {
  h.calls.push({ engine, prompt: String(args[at]) });
  return OK;
};
/** 三个没配 key 的引擎换成记录入参的假服务(MiniMax 由上面的 vi.mock 记录) */
function stubEngines(orch: any) {
  orch.veoService = { generateVideo: record('veo') };
  orch.happyhorseService = { generateVideo: record('happyhorse', 0) };
  orch.klingService = { generateVideo: record('kling'), generateFirstLastFrame: record('kling-flf', 2) };
}

let HybridOrchestrator: any;
let AgentOrchestrator: any;
const savedMock = process.env.MOCK_ENGINES;
beforeAll(async () => {
  delete process.env.MOCK_ENGINES; // 开着它单镜重生会整条换成本地假片,引擎一个都不调
  HybridOrchestrator = (await import('@/services/hybrid-orchestrator')).HybridOrchestrator;
  AgentOrchestrator = (await import('@/services/agent-orchestrator')).AgentOrchestrator;
}, 120000);
afterAll(() => { if (savedMock === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = savedMock; });
beforeEach(() => { h.calls.length = 0; });

function verticalOrch() {
  const orch = new HybridOrchestrator();
  orch.setAspect('9:16');
  stubEngines(orch);
  return orch;
}

describe('v12.472 · 单镜重生(重生 / 自愈 / 片段重拍 / 剪辑师烤字重生共用)', () => {
  const board = { shotNumber: 3, imageUrl: 'https://example.com/sb3.png', prompt: LEGACY };

  for (const engine of ['veo', 'minimax', 'happyhorse', 'kling'] as const) {
    it(`${engine} 收到的是纯文本:没有 MJ 参数、没有 16:9,正文都在`, async () => {
      const clip = await verticalOrch().regenerateShot(3, board, { videoProvider: engine });
      expect(clip.isAnimatic, '假引擎没被调到,回落成了占位片').toBe(false);
      expect(h.calls.map((c) => c.engine)).toEqual([engine]);
      const sent = h.calls[0].prompt;
      for (const w of KEPT) expect(sent).toContain(w);
      expect(sent).not.toMatch(MJ_SYNTAX);
      expect(sent).not.toContain('16:9');
    }, 60000);
  }

  it('可灵首尾帧融合(带尾帧)也一样', async () => {
    await verticalOrch().regenerateShot(3, board, { videoProvider: 'kling', tailFrameUrl: 'https://example.com/tail.png' });
    expect(h.calls.map((c) => c.engine)).toEqual(['kling-flf']);
    const sent = h.calls[0].prompt;
    for (const w of KEPT) expect(sent).toContain(w);
    expect(sent).not.toMatch(MJ_SYNTAX);
    expect(sent).not.toContain('16:9');
  }, 60000);

  it('对照:本来就是纯文本的提示词逐字不变(不是靠删内容满足断言)', async () => {
    const plain = '林晚回头看向门口, 16:9 宽银幕感的构图, no text';
    await verticalOrch().regenerateShot(3, { ...board, prompt: plain }, { videoProvider: 'minimax' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].prompt).toBe(plain);
  }, 60000);
});

describe('v12.472 · 审片反馈后的重生(executeReviewFeedback)', () => {
  const review = { items: [{ severity: 'critical', stage: 'video', shotNumber: 2, issue: '动作僵硬' }] };
  const script = { title: 't', synopsis: 's', shots: [{ shotNumber: 2, sceneDescription: '林晚回头', characters: [], duration: 5 }] };
  const boards = [{ shotNumber: 2, imageUrl: 'https://example.com/sb2.png', prompt: LEGACY }];
  const videos = [{ shotNumber: 2, videoUrl: 'https://example.com/old.mp4' }];

  it('Veo 档', async () => {
    const out = await verticalOrch().executeReviewFeedback(review, script, boards, videos);
    expect(out.videos[0].videoUrl).toBe(OK);
    expect(h.calls.map((c) => c.engine)).toEqual(['veo']);
    const sent = h.calls[0].prompt;
    for (const w of KEPT) expect(sent).toContain(w);
    expect(sent).not.toMatch(MJ_SYNTAX);
    expect(sent).not.toContain('16:9');
  }, 60000);

  it('没有 Veo 时的 MiniMax 档', async () => {
    const orch = verticalOrch();
    orch.veoService = null;
    await orch.executeReviewFeedback(review, script, boards, videos);
    expect(h.calls.map((c) => c.engine)).toEqual(['minimax']);
    const sent = h.calls[0].prompt;
    for (const w of KEPT) expect(sent).toContain(w);
    expect(sent).not.toMatch(MJ_SYNTAX);
    expect(sent).not.toContain('16:9');
  }, 60000);
});

describe('v12.472 · 整片生成:剧本这一镜没有描述时兜底到分镜提示词', () => {
  it('兜底拿到的分镜提示词也先转纯文本', async () => {
    const orch = new HybridOrchestrator();
    orch.setAspect('9:16');
    orch.veoService = null; orch.klingService = null; orch.happyhorseService = null; // 只留 MiniMax,与本机配了哪些 key 无关
    const script = { title: 't', synopsis: 's', shots: [{ shotNumber: 1, characters: [], dialogue: '', action: '', emotion: '' }] };
    await orch.runVideoProducer([{ shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: LEGACY }], 'minimax', [], [], script);
    expect(h.calls.length).toBeGreaterThan(0);
    for (const c of h.calls) {
      expect(c.prompt).toContain('林晚回头看向门口');
      expect(c.prompt).toContain('vertical 9:16 portrait composition');
      expect(c.prompt).not.toMatch(MJ_SYNTAX);
      expect(c.prompt).not.toContain('16:9');
    }
  }, 60000);
});

describe('v12.472 · 视频注册表派发(插件链)', () => {
  it('不声明认 MJ 语法的 provider 收纯文本;声明了的收原文', async () => {
    const { clearVideoProviders, registerVideoProvider, dispatchVideoGenerate } = await import('@/lib/video-providers/registry');
    clearVideoProviders();
    const got: Record<string, string> = {};
    const base = {
      supportsImage2Video: true, supportsText2Video: true, supportsLastFrame: false, supportsSubjectReference: false,
      maxDurationSec: 10, available: () => true,
    };
    registerVideoProvider({ ...base, id: 'plain-engine', name: 'p', priority: 1,
      generate: async (i) => { got.plain = i.prompt; throw new Error('400 bad request'); } }); // 失败 → 轮到下一个
    registerVideoProvider({ ...base, id: 'mj-video', name: 'm', priority: 2, acceptsMjParams: true,
      generate: async (i) => { got.mj = i.prompt; return { videoUrl: OK, provider: 'mj-video' }; } });
    const r = await dispatchVideoGenerate({ prompt: LEGACY, firstFrameUrl: 'https://example.com/sb.png', aspectRatio: '9:16' });
    clearVideoProviders();
    expect(r.result?.provider).toBe('mj-video');
    for (const w of KEPT) expect(got.plain).toContain(w);
    expect(got.plain).not.toMatch(MJ_SYNTAX);
    expect(got.plain).not.toContain('16:9');
    expect(got.mj, '声明认 MJ 语法的 provider 应收到原文').toBe(LEGACY);
  });
});

describe('v12.472 · agent-orchestrator(/api/create 那条老管线)', () => {
  /** 构造函数要 OpenAI key;这里只测出片那一步,手工装上 agents 表与假引擎 */
  function agentOrch() {
    const o = Object.create(AgentOrchestrator.prototype);
    o.initializeAgents();
    o.veoService = { generateVideo: record('veo') };
    o.minimaxService = { generateVideo: record('minimax') };
    o.viduService = { generateVideo: record('vidu') };
    o.kelingService = { generateVideo: record('keling') };
    return o;
  }
  const board = { shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: LEGACY };

  it('整片出片的每个引擎分支都收纯文本', async () => {
    for (const p of ['veo', 'minimax', 'vidu', 'keling', 'auto']) await agentOrch().runVideoProducer([board], p);
    expect(h.calls.map((c) => c.engine)).toEqual(['veo', 'minimax', 'vidu', 'keling', 'veo']);
    for (const c of h.calls) {
      for (const w of KEPT) expect(c.prompt).toContain(w);
      expect(c.prompt).not.toMatch(MJ_SYNTAX);
      expect(c.prompt).not.toContain('16:9');
    }
  });

  it('单镜重生(含传了 description 覆盖)也收纯文本', async () => {
    await agentOrch().regenerateShot(board, 'minimax');
    await agentOrch().regenerateShot(board, 'vidu', { description: `${LEGACY}, 改成夜景` });
    expect(h.calls.map((c) => c.engine)).toEqual(['minimax', 'vidu']);
    expect(h.calls[1].prompt).toContain('改成夜景');
    for (const c of h.calls) {
      for (const w of KEPT) expect(c.prompt).toContain(w);
      expect(c.prompt).not.toMatch(MJ_SYNTAX);
      expect(c.prompt).not.toContain('16:9');
    }
  });
});
