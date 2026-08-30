/**
 * v12.393:守卫守的是一个和被守方口径不同的数。
 *
 * v12.371 给 provider 加了 `minRefImages` 下界,本意是让「0 参考图」的请求
 * 不要白试一次 MiniMax multi-ref。可 8/30 定时任务的日志里那句报错照旧出现:
 *   ❌ 场景 万人演唱会现场  图像生成失败: Minimax multi-ref needs at least 1 ref | …
 *
 * 原因是**同一个量被算了三遍,三种口径**:
 *   · plugin-chain-router 算 refCount:`.filter(u => !!u)`             只要非空
 *   · minimax-multi 算 refs:`.filter(startsWith('http'))` + Set 去重 + 上限 4
 *   · gateway 算 refUrls:`.filter(startsWith('http'))` + 上限 4,**不去重**
 *
 * 于是传一个 `data:` URI 或 `/api/serve-file?...` 本地引用图:
 * router 算 1 → minRefImages:1 满足 → 放行 → provider 内部过滤后为 0 → 抛错。
 * **守卫看的数和 provider 看的数从来不是一个数,那道下界等于没设。**
 *
 * 实测同一组输入下的分歧:
 *   一个 data: URI      旧 router 算 1 · provider 实际 0
 *   一个本地 serve-file  旧 router 算 1 · provider 实际 0
 *   三张相同的 http 图    旧 router 算 3 · provider 实际 1
 *   六张(超上限)        旧 router 算 6 · provider 实际 4
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { usableRefs, countUsableRefs, MAX_REF_IMAGES } from '@/lib/image-providers/refs';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const codeOf = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** 旧 router 的算法,用来证明分歧确实存在 */
const legacyCount = (i: any) =>
  [...(i.referenceImages || []), ...(i.cref ? [i.cref] : []), ...(i.sref ? [i.sref] : [])].filter((u) => !!u).length;

describe('口径统一', () => {
  it('非 http 的引用图不算数 —— 这正是日志里那条报错的成因', () => {
    for (const u of ['data:image/png;base64,AAA', '/api/serve-file?key=abc', 'file:///tmp/x.png', '']) {
      const input = { referenceImages: [u] };
      expect(countUsableRefs(input), `「${u.slice(0, 24)}」不该被算成可用参考图`).toBe(0);
      // 旧口径会算成 1(空串除外)—— 分歧是真的
      if (u) expect(legacyCount(input)).toBe(1);
    }
  });

  it('重复的图只算一张', () => {
    const input = { referenceImages: ['https://a/x.png', 'https://a/x.png', 'https://a/x.png'] };
    expect(countUsableRefs(input)).toBe(1);
    expect(legacyCount(input), '旧口径算 3').toBe(3);
  });

  it('超过上限的会被丢掉,所以也不该算进去', () => {
    const input = { referenceImages: Array.from({ length: 6 }, (_, i) => `https://a/${i}.png`) };
    expect(countUsableRefs(input)).toBe(MAX_REF_IMAGES);
    expect(legacyCount(input)).toBe(6);
  });

  it('cref / sref 一起计入,顺序保持 referenceImages → cref → sref', () => {
    const r = usableRefs({ referenceImages: ['https://a/1.png'], cref: 'https://a/2.png', sref: 'https://a/3.png' });
    expect(r).toEqual(['https://a/1.png', 'https://a/2.png', 'https://a/3.png']);
  });

  it('去重时先出现的胜出 —— 换顺序会改变发给引擎的首图', () => {
    const r = usableRefs({ referenceImages: ['https://a/2.png', 'https://a/1.png'], cref: 'https://a/2.png' });
    expect(r).toEqual(['https://a/2.png', 'https://a/1.png']);
  });

  it('畸形输入不抛错', () => {
    for (const i of [null, undefined, {}, { referenceImages: null }, { referenceImages: [null, 1, {}] as any }]) {
      expect(() => countUsableRefs(i as any)).not.toThrow();
      expect(countUsableRefs(i as any)).toBe(0);
    }
  });
});

describe('三处都改走唯一入口', () => {
  it('router 不再自己算', () => {
    const code = codeOf(read('lib/plugin-chain-router.ts'));
    expect(code).toContain('countUsableRefs');
    expect(code, '还留着自己那份 filter(!!u)').not.toMatch(/filter\(\(u\) => !!u\)\.length/);
  });

  it('两个 provider 都不再自己算', () => {
    const code = codeOf(read('lib/image-providers/builtins.ts'));
    expect(code).toContain('usableRefs(input)');
    // 原来的两份手写口径都该消失
    expect(code).not.toMatch(/filter\(\(u\) => u && u\.startsWith\('http'\)\)/);
    expect(code).not.toMatch(/Array\.from\(new Set\(refs\)\)/);
  });

  it('选路判的数与 provider 拿到的张数是同一个函数算的', () => {
    // 这条是本版的核心不变量:判定与使用必须同源
    const reg = codeOf(read('lib/image-providers/registry.ts'));
    expect(reg, 'registry 仍按 refCount 判上下界').toMatch(/minRefImages/);
    const router = codeOf(read('lib/plugin-chain-router.ts'));
    const builtins = codeOf(read('lib/image-providers/builtins.ts'));
    expect(router.includes('countUsableRefs') && builtins.includes('usableRefs')).toBe(true);
  });
});
