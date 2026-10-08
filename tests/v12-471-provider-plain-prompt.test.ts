/**
 * v12.471 —— 注册表派发:MJ 参数语法只发给声明认它的 provider,其余转纯文本。
 *
 * 单张重生(regenerate-asset-image)、插件链都走 dispatchImageGenerate。修前角色单张重生传 aspectRatio 3:4,
 * Gemini 收到的文字是「… --ar 16:9 --s 250 … Vertical 3:4 portrait composition.」—— 同一句话里两个相反的画幅。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ recordApiCall: vi.fn() }));

import { registerImageProvider, dispatchImageGenerate, listImageProviders } from '@/lib/image-providers/registry';
import type { ImageGenerateInput } from '@/lib/image-providers/types';
import { getCharacterVisualPrompt, getUnifiedStoryboardRenderPrompt } from '@/lib/mckee-skill';
import { optimizeMidjourneyPrompt } from '@/lib/prompt-filter';

const hasMjSyntax = (p: string) => /(^|\s)--[a-z]/i.test(p);
const LEGACY = optimizeMidjourneyPrompt(
  'cinematic film frame, she turns back --ar 16:9 --s 250 --cw 90, composition: rule of thirds',
);

const seen: Record<string, string[]> = {};
const fake = (id: string, extra: Partial<Parameters<typeof registerImageProvider>[0]>, ok = true) =>
  registerImageProvider({
    id, name: id, supportsRefs: true, maxRefImages: 8, priority: 1, available: () => true,
    async generate(input: ImageGenerateInput) {
      (seen[id] ||= []).push(input.prompt);
      if (!ok) throw new Error(`${id} down (test)`);
      return { imageUrl: `https://cdn.example/${id}.png`, provider: id };
    },
    ...extra,
  });

/** 只让指定的 provider 参与(内置的按 env 可能可用,排除掉) */
const only = (...ids: string[]) => new Set(listImageProviders().map((p) => p.id).filter((x) => !ids.includes(x)));

beforeAll(async () => {
  await import('@/lib/image-providers/builtins');
  fake('t-mj-like', { acceptsMjParams: true, priority: 1 }, false);
  fake('t-plain', { priority: 2 });
  fake('t-plain-noref', { priority: 3, supportsRefs: false, maxRefImages: 0 });
});
afterEach(() => { for (const k of Object.keys(seen)) delete seen[k]; vi.unstubAllGlobals(); });

describe('v12.471 · dispatchImageGenerate', () => {
  it('认 MJ 语法的 provider 原样收(由 MJ service 出口收拾);不认的收纯文本', async () => {
    const r = await dispatchImageGenerate({ prompt: LEGACY, aspectRatio: '9:16' }, { refCount: 0, exclude: only('t-mj-like', 't-plain') });
    expect(r.result?.provider).toBe('t-plain');
    expect(seen['t-mj-like']).toEqual([LEGACY]);
    const plain = seen['t-plain'][0];
    expect(hasMjSyntax(plain), plain).toBe(false);
    expect(plain).not.toContain('16:9');
    expect(plain).toContain('composition: rule of thirds');
    expect(plain).toContain('no watermark');
  });

  it('主轮全失败后的「丢参考图再试」那一轮同样转纯文本', async () => {
    const r = await dispatchImageGenerate(
      { prompt: LEGACY, aspectRatio: '9:16', referenceImages: ['https://cdn.example/ref.png'] },
      { refCount: 1, exclude: only('t-mj-like', 't-plain-noref') },
    );
    expect(r.result?.provider).toBe('t-plain-noref');
    expect(r.result?.refsIgnored).toBe(true);
    expect(hasMjSyntax(seen['t-plain-noref'][0])).toBe(false);
  });

  it('内置 provider 里只有 mj 声明认 MJ 语法', () => {
    const accepting = listImageProviders().filter((p) => p.acceptsMjParams).map((p) => p.id).filter((id) => !id.startsWith('t-'));
    expect(accepting).toEqual(['mj']);
  });
});

describe('v12.471 · 角色单张重生(3:4)→ 真 Gemini provider 收到的文字', () => {
  it('只剩请求画幅那一句,没有相反的 --ar 16:9', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    await import('@/lib/image-providers/gemini-image');
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }), { status: 200 });
    }));
    try {
      // 与 app/api/projects/[id]/regenerate-asset-image/route.ts 的拼法一致
      const prompt = `${getCharacterVisualPrompt('林雪', '古装女侠', '黑发高马尾,青色劲装,腰佩短剑,左眉一道浅疤', '')}. Adjustment per user feedback: 头发改成红色`;
      const r = await dispatchImageGenerate({ prompt, aspectRatio: '3:4' }, { refCount: 0, exclude: only('gemini-image') });
      expect(r.result?.provider).toBe('gemini-image');
      const text: string = JSON.parse(bodies[0]).contents[0].parts.at(-1).text;
      expect(text).toContain('Vertical 3:4 portrait composition.');
      expect(text).not.toContain('16:9');
      expect(hasMjSyntax(text), text).toBe(false);
      expect(text).toContain('Adjustment per user feedback: 头发改成红色');
      expect(text).toContain('no hoodie'); // 古装负向词以普通文字保留
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('新模板发给非 MJ 引擎的统一分镜提示词同样干净', async () => {
    const r = await dispatchImageGenerate(
      { prompt: optimizeMidjourneyPrompt(getUnifiedStoryboardRenderPrompt('rain', 'low', 'rim', 'teal', 'ink wash', ['林雪'])), aspectRatio: '9:16' },
      { refCount: 0, exclude: only('t-plain') },
    );
    expect(r.result?.provider).toBe('t-plain');
    expect(hasMjSyntax(seen['t-plain'][0])).toBe(false);
  });
});
