/**
 * v12.371:场景图每次都白试一次必然失败的 provider;失败后又给了错误的建议。
 *
 * 两处都是从**今天真实跑出来的日志**里挖到的,不是翻代码翻到的:
 *
 * ① `Minimax multi-ref needs at least 1 ref` —— 场景图天然 **0 张参考**,
 *    而选路只过滤上界 `refCount > maxRefImages`,**没有下界**。
 *    于是每张场景图都先白试一次 multi-ref、必然抛错,再落到下一个。
 *    实测「万人演唱会现场」「昆仑山暴风雪中」「秦岭龙脉上空」就是这么失败的。
 *    **能力约束该声明在注册表里由选路统一执行**,而不是埋在 generate 里靠抛错表达。
 *
 * ② 全链失败时文案是「所有图像引擎都失败了,**请稍后再试**」——
 *    而真实原因常常是**稍后再试也没用**的那种:额度耗尽 / prompt 被判敏感 / 网关分组受限。
 *    三种处置完全不同,而「稍后再试」对后两种是**错的建议**。
 *    原因**早就写进 `api_usage_events`**,只是没人交回给用户(与 v12.348 同一手法)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  registerImageProvider, clearImageProviders, selectProviders,
} from '@/lib/image-providers/registry';
import { adviseFromError } from '@/lib/recent-failure';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const mk = (id: string, min: number | undefined, max: number) => ({
  id, name: id, supportsRefs: true, maxRefImages: max, minRefImages: min,
  priority: 100, available: () => true,
  async generate() { return { imageUrl: 'x', provider: id }; },
});

describe('v12.371 参考图下界', () => {
  beforeEach(() => clearImageProviders());

  it('refCount=0 时排除要求 ≥1 张参考的 provider', () => {
    registerImageProvider(mk('multi', 1, 4) as never);
    registerImageProvider(mk('single', 0, 1) as never);
    const ids = selectProviders({ refCount: 0 } as never).map((p) => p.id);
    expect(ids).toEqual(['single']);
  });

  it('refCount=1 时两者都可选', () => {
    registerImageProvider(mk('multi', 1, 4) as never);
    registerImageProvider(mk('single', 0, 1) as never);
    expect(selectProviders({ refCount: 1 } as never).map((p) => p.id).sort()).toEqual(['multi', 'single']);
  });

  it('上界仍然生效(别把旧规则改坏)', () => {
    registerImageProvider(mk('single', 0, 1) as never);
    expect(selectProviders({ refCount: 3 } as never).map((p) => p.id)).toEqual([]);
  });

  it('minRefImages 缺省视为 0 —— 老 provider 不受影响(零回归)', () => {
    registerImageProvider(mk('legacy', undefined, 4) as never);
    expect(selectProviders({ refCount: 0 } as never).map((p) => p.id)).toEqual(['legacy']);
  });

  it('内置 minimax-multi 声明了 minRefImages: 1', () => {
    const src = read('lib/image-providers/builtins.ts');
    const win = src.slice(src.indexOf("id: 'minimax-multi'"), src.indexOf("id: 'minimax-multi'") + 400);
    expect(win).toMatch(/minRefImages: 1/);
  });
});

describe('v12.371 失败原因 → 可执行建议', () => {
  it.each([
    ['Token quota exhausted', '现在重试不会成功'],
    ['已达到 Token Plan 用量上限', '现在重试不会成功'],
    ['Minimax image-01 error (1026): input new_sensitive', '需要改写该镜的描述文案'],
    ['MJ submit failed: {"error":{"message":"分组 default、限时体验', '切换通道或换 key'],
    ['Request timed out', '这一类重试通常有效'],
  ])('%s → 给出对的下一步', (msg, want) => {
    expect(adviseFromError(msg)).toContain(want);
  });

  it('**判不出就返回 null** —— 不硬编一个可能是错的建议', () => {
    expect(adviseFromError('something completely unexpected')).toBeNull();
    expect(adviseFromError('')).toBeNull();
  });

  it('三类「重试没用」的原因都明确说了重试没用', () => {
    for (const m of ['quota exhausted', '1026 sensitive', '分组 default']) {
      expect(adviseFromError(m)).toMatch(/不会成功/);
    }
  });
});

describe('v12.371 报错接线', () => {
  const R = read('app/api/projects/[id]/regenerate-storyboard/route.ts');

  it('不再无条件说「请稍后再试」', () => {
    const code = R.split('\n').filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    }).join('\n');
    expect(code).not.toContain('请稍后再试');
  });

  it('取真实上游原因并优先给建议', () => {
    expect(R).toMatch(/recentImageFailure\(\)/);
    expect(R).toMatch(/hint\?\.advice/);
  });

  it('取不到原因时如实说「未取到上游报错」,不编一个', () => {
    expect(R).toContain('且未取到上游报错');
  });

  it('只看近 5 分钟 —— 太旧的记录与本次失败无关,拿它当原因会误导', () => {
    expect(read('lib/recent-failure.ts')).toMatch(/withinMs = 5 \* 60 \* 1000/);
    expect(read('lib/recent-failure.ts')).toMatch(/拿它当原因反而会误导/);
  });

  it('只看图像链 provider,不把 LLM/TTS 的失败混进来', () => {
    expect(read('lib/recent-failure.ts')).toMatch(/const IMAGE_PROVIDERS/);
  });
});
