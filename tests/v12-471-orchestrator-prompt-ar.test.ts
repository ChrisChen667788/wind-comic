/**
 * v12.471 —— 编排器出图链真跑:同一句提示词,MJ 收到「正文 + 末尾一组不重复的参数(--ar = 项目画幅)」,
 * MJ 失败退到 MiniMax 时 MiniMax 收到的是不带 MJ 语法的纯文本。
 *
 * MJ 用真 MidjourneyService(只把网关 fetch 换掉,截提交的请求体),MiniMax 打桩记下收到的提示词。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ recordApiCall: vi.fn() }));

import { getUnifiedStoryboardRenderPrompt } from '@/lib/mckee-skill';
import { optimizeMidjourneyPrompt } from '@/lib/prompt-filter';
import { withVerticalHints } from '@/lib/vertical-composition';
import { MidjourneyService } from '@/services/midjourney.service';

const arValues = (p: string) => [...p.matchAll(/(?:^|\s)--(?:ar|aspect)\s+(\S+)/g)].map((m) => m[1]);
const firstParamAt = (p: string) => p.search(/(^|\s)--[a-z]/);
const hasMjSyntax = (p: string) => /(^|\s)--[a-z]/i.test(p);

let HybridOrchestrator: any;
beforeAll(async () => {
  HybridOrchestrator = (await import('@/services/hybrid-orchestrator')).HybridOrchestrator;
}, 120000);

let mjBodies: string[] = [];
let minimaxPrompts: string[] = [];
beforeEach(() => {
  mjBodies = [];
  minimaxPrompts = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/mj/submit/imagine')) mjBodies.push(JSON.parse(String(init?.body)).prompt);
    // MJ 提交即失败(只要请求体),链路退到 MiniMax
    return new Response(JSON.stringify({ code: 4, description: 'no channel (test)' }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function makeOrch() {
  const orch = new HybridOrchestrator() as any;
  orch.mjService = new MidjourneyService('test-key');
  orch.falFluxService = null;
  orch.comfyuiService = null;
  const record = async (prompt: string) => { minimaxPrompts.push(prompt); return 'https://minimax.out/x.png'; };
  orch.minimaxService = { isImageAvailable: () => true, generateImage: vi.fn(record), generateImageWithRefs: vi.fn(record) };
  return orch;
}

const STYLE = 'ink wash painting, cinematic';
const NEW_STORYBOARD = optimizeMidjourneyPrompt(withVerticalHints(
  getUnifiedStoryboardRenderPrompt('she turns back in the rain', 'low angle', 'rim light', 'cold teal', STYLE, ['林雪'], { 林雪: 'black hair' })
  + ', composition: rule of thirds', '9:16',
));
/** 库里的旧分镜提示词(v12.471 前生成),用户在重生框里改一句;regenerate-storyboard 路由再过一遍 optimize */
const LEGACY_REGEN = optimizeMidjourneyPrompt(
  'cinematic film frame, she turns back in the rain, ink wash painting, professional cinematography --ar 16:9 --s 250 --cw 90, '
  + 'composition: rule of thirds --no text --no words --no watermark, she is smiling now',
);

describe('v12.471 · 编排器出图链(9:16 项目)', () => {
  for (const [name, prompt, markers] of [
    ['新模板的统一分镜', NEW_STORYBOARD, ['cinematic film frame', 'composition: rule of thirds']],
    ['库里的旧提示词重生', LEGACY_REGEN, ['cinematic film frame', 'composition: rule of thirds', 'she is smiling now']],
  ] as const) {
    it(`${name}:MJ 只有一个 --ar 9:16、参数全在末尾;退到 MiniMax 时收到纯文本`, async () => {
      const out = await makeOrch().doLegacyGenerateImage(prompt, {
        label: 'Shot 1', aspectRatio: '9:16', cref: 'https://cdn.example/linxue.png', cw: 125,
      });
      expect(out).toBe('https://minimax.out/x.png');

      expect(mjBodies, 'MJ 应当先被试到').toHaveLength(1);
      const mj = mjBodies[0];
      expect(arValues(mj), mj).toEqual(['9:16']);
      for (const m of markers) expect(mj.indexOf(m), `「${m}」落在参数后面\n${mj}`).toBeLessThan(firstParamAt(mj));
      expect(mj).toContain('--no text');

      expect(minimaxPrompts).toHaveLength(1);
      const mm = minimaxPrompts[0];
      expect(hasMjSyntax(mm), mm).toBe(false);
      expect(mm).not.toContain('16:9');
      for (const m of markers) expect(mm).toContain(m);
      expect(mm).toContain('no text');
    });
  }

  it('没有 MJ 语法的提示词,MiniMax 收到的逐字不变', async () => {
    const plain = 'a rainy street at night, two people facing off, cinematic';
    await makeOrch().doLegacyGenerateImage(plain, { label: 'x', aspectRatio: '9:16' });
    expect(minimaxPrompts).toEqual([plain]);
  });
});
