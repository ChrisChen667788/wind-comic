/**
 * v12.447 —— 整片生成(runVideoProducer)这一条,真跑。
 *
 * 另一个测试文件对「上报」只扫了源码里有没有 `reportRefUsage('minimax'`:重生路径也加了同名调用之后,
 * 把整片生成那处删掉它照样绿(变异 A12 实测漏过)。装配层那条同理 —— 它是手动把 refs 喂给
 * buildElementsRegistry,编排器里真正构建注册表的那段删了 refs 也照样绿(变异 A8 漏过)。
 * 所以这里用假引擎把整片生成的视频阶段真跑一遍,断言**发给引擎的东西**和**上报的事件**。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<{ engine: string; opts: any }> }));

vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: { apiKey: '', baseURL: '', model: 'test' },
    minimax: { apiKey: 'test-key', groupId: 'test-group', baseURL: 'https://test.local' },
    veo: { apiKey: '', baseURL: '', model: '', format: 'openai' },
    keling: { apiKey: 'test-kling', baseURL: 'https://kling.test' },
    vidu: { apiKey: '', baseURL: '' },
    fal: { apiKey: '' },
    comfyui: { baseURL: '' },
  },
}));

vi.mock('@/services/minimax.service', () => {
  class MinimaxService {
    generateVideo = vi.fn(async (_frame: string, _prompt: string, opts: any) => {
      h.calls.push({ engine: 'minimax', opts });
      return 'https://example.com/minimax.mp4';
    });
    generateImage = vi.fn().mockResolvedValue('https://example.com/img.png');
    generateSpeech = vi.fn().mockResolvedValue('https://example.com/audio.mp3');
    generateMusic = vi.fn().mockResolvedValue('https://example.com/music.mp3');
    isVideoAvailable = () => true;
    isImageAvailable = () => true;
  }
  return { MinimaxService, hasMinimax: () => true };
});

vi.mock('@/services/kling.service', () => {
  class KlingService {
    generateVideo = vi.fn(async (_frame: string, _prompt: string, opts: any) => {
      h.calls.push({ engine: 'kling', opts });
      return 'https://example.com/kling.mp4';
    });
  }
  return { KlingService, hasKling: () => true };
});

vi.mock('@/services/midjourney.service', () => ({ MidjourneyService: vi.fn(), hasMidjourney: () => false }));

const FRONT = 'https://cdn.example/front.png';
const SIDE = 'https://cdn.example/side.png';
const BACK = 'https://cdn.example/back.png';

let HybridOrchestrator: any;
beforeAll(async () => {
  // 编排器模块很大,首次加载在负载下会超过单条测试的时限 —— 在这里统一付掉
  HybridOrchestrator = (await import('@/services/hybrid-orchestrator')).HybridOrchestrator;
}, 120000);

beforeEach(() => { h.calls.length = 0; });

async function runPipeline(provider: 'minimax' | 'kling', refs?: Array<{ role: string; url: string }>) {
  const orch = new HybridOrchestrator();
  const events: Array<[string, any]> = [];
  orch.onProgress = (t: string, d: unknown) => events.push([t, d]);
  orch.setLockedCharacters([{ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, ...(refs ? { refs } : {}) }]);
  const script = {
    title: '测试', synopsis: '测试',
    shots: [{ shotNumber: 1, sceneDescription: '林晚在窗边回头', characters: ['林晚'], dialogue: '', action: '回头', emotion: '平静' }],
  };
  await orch.runVideoProducer(
    [{ shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: '林晚在窗边回头' }],
    provider,
    [{ character: '林晚', imageUrl: FRONT }],
    [],
    script,
  );
  return { events, refEvents: events.filter(([t]) => t === 'refUsage').map(([, d]) => d) };
}

const ANGLES = [{ role: 'side', url: SIDE }, { role: 'detail', url: BACK }];

describe('v12.447 · 整片生成真跑:角度图发到哪、丢了几张都得对得上', () => {
  it('MiniMax:主体参考带着角度图,且在发给引擎前如实报「忽略 2 张」', async () => {
    const { refEvents } = await runPipeline('minimax', ANGLES);
    const mm = h.calls.filter((c) => c.engine === 'minimax');
    expect(mm, '应当真的调到 MiniMax').toHaveLength(1);
    const subj = mm[0].opts.subjectReferences;
    expect(subj?.[0]?.imageUrl).toBe(FRONT);
    expect([...(subj?.[0]?.refImageUrls || [])].sort()).toEqual([BACK, SIDE].sort());
    expect(refEvents).toHaveLength(1);
    expect(refEvents[0]).toMatchObject({ engine: 'minimax', shotNumber: 1, used: 1, dropped: 2 });
  }, 60000);

  it('可灵:角度图经编排器建的元素注册表挂到镜头上,发出去的主体参考里真有它们', async () => {
    const prev = process.env.KLING_ELEMENTS;
    delete process.env.KLING_ELEMENTS;
    try {
      const { refEvents } = await runPipeline('kling', ANGLES);
      const kl = h.calls.filter((c) => c.engine === 'kling');
      expect(kl, '应当真的调到可灵').toHaveLength(1);
      const subj = kl[0].opts.subjectReferences;
      expect(subj?.[0]?.imageUrl).toBe(FRONT);
      expect([...(subj?.[0]?.refImageUrls || [])].sort(), '注册表没拿到 refs 时这里是空的').toEqual([BACK, SIDE].sort());
      // 未开 Elements:每角色只收 1 张,另外 2 张如实报出
      expect(refEvents).toHaveLength(1);
      expect(refEvents[0]).toMatchObject({ engine: 'kling', shotNumber: 1, used: 1, dropped: 2 });
    } finally {
      if (prev === undefined) delete process.env.KLING_ELEMENTS; else process.env.KLING_ELEMENTS = prev;
    }
  }, 60000);

  it('另一侧:两个锁定角色、只有林晚有角度图,镜头里只有陆沉 —— 陆沉不能挂上林晚的角度图,也不该报', async () => {
    const orch = new HybridOrchestrator();
    const events: Array<[string, any]> = [];
    orch.onProgress = (t: string, d: unknown) => events.push([t, d]);
    orch.setLockedCharacters([
      { name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: ANGLES },
      { name: '陆沉', role: 'antagonist', cw: 125, imageUrl: 'https://cdn.example/lu.png' },
    ]);
    const script = { title: 't', synopsis: 's', shots: [{ shotNumber: 1, sceneDescription: '陆沉独自站在雨里', characters: ['陆沉'], dialogue: '', action: '站', emotion: '冷' }] };
    await orch.runVideoProducer(
      [{ shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: '陆沉独自站在雨里' }], 'minimax',
      [{ character: '林晚', imageUrl: FRONT }, { character: '陆沉', imageUrl: 'https://cdn.example/lu.png' }], [], script,
    );
    const mm = h.calls.filter((c) => c.engine === 'minimax');
    expect(mm).toHaveLength(1);
    const subj = mm[0].opts.subjectReferences || [];
    expect(subj.map((x: any) => x.name)).toEqual(['陆沉']);
    expect(subj[0].refImageUrls, '张冠李戴:陆沉拿到了林晚的角度图').toBeUndefined();
    expect(events.filter(([t]) => t === 'refUsage')).toHaveLength(0);
  }, 60000);

  it('另一侧:没传角度图时一条都不报,发出去的也只有正面图', async () => {
    const { refEvents } = await runPipeline('minimax');
    const mm = h.calls.filter((c) => c.engine === 'minimax');
    expect(mm).toHaveLength(1);
    expect(mm[0].opts.subjectReferences?.[0]?.imageUrl).toBe(FRONT);
    expect(mm[0].opts.subjectReferences?.[0]?.refImageUrls).toBeUndefined();
    expect(refEvents).toHaveLength(0);
  }, 60000);
});
