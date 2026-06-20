/**
 * v12.12.0(Phase 2)— @元素注册表 + 跨引擎多参适配 + 同场景续接守卫。
 */
import { describe, it, expect } from 'vitest';
import {
  elementId, parseElementId, buildElementsRegistry, resolveElement, mountForShot,
  toSeedanceSlots, toKlingElements, toVeoReferenceImages, annotateSeedancePrompt, scenesLikelySame,
  subjectReferencesFromMount,
} from '@/lib/elements-registry';

const H = (n: string) => `https://cdn.test/${n}.png`;

const reg = buildElementsRegistry({
  characters: [
    { name: '陆晚晚', appearance: '25岁御姐', refs: [{ role: 'frontal', url: H('lw_front') }, { role: 'side', url: H('lw_side') }] },
    { name: '林泽', appearance: '30岁西装', imageUrl: H('lz_front') },
  ],
  scenes: [{ location: '锈蚀铁笼', description: '全封闭铁笼', imageUrl: H('cage') }],
  props: [{ name: '泛蓝光短刃', description: '腕部弹出', imageUrl: H('blade') }],
});

describe('v12.12.0 · id 命名与解析', () => {
  it('elementId 生成 @人物{}/@场景{}/@道具{}', () => {
    expect(elementId('character', '陆晚晚')).toBe('@人物{陆晚晚}');
    expect(elementId('scene', '铁笼')).toBe('@场景{铁笼}');
    expect(elementId('prop', '短刃')).toBe('@道具{短刃}');
  });
  it('parseElementId 往返一致', () => {
    expect(parseElementId('@人物{陆晚晚}')).toEqual({ type: 'character', name: '陆晚晚' });
    expect(parseElementId('陆晚晚')).toBeNull();
    expect(parseElementId('@xx{a}')).toBeNull();
  });
});

describe('v12.12.0 · buildElementsRegistry', () => {
  it('角色/场景/道具各投影成元素', () => {
    expect(reg['@人物{陆晚晚}']?.type).toBe('character');
    expect(reg['@场景{锈蚀铁笼}']?.type).toBe('scene');
    expect(reg['@道具{泛蓝光短刃}']?.type).toBe('prop');
  });
  it('过滤 data: 等非 http 参考图', () => {
    const r = buildElementsRegistry({ characters: [{ name: 'X', imageUrl: 'data:image/png;base64,zzz' }] });
    expect(r['@人物{X}']?.assets.length ?? 0).toBe(0);
  });
  it('frontal 缺省时单图作 primary', () => {
    expect(reg['@人物{林泽}'].assets[0].role).toBe('primary');
    expect(reg['@人物{林泽}'].assets[0].url).toBe(H('lz_front'));
  });
});

describe('v12.12.0 · resolveElement / mountForShot', () => {
  it('按名字/按 id 都能解析', () => {
    expect(resolveElement(reg, '陆晚晚')?.id).toBe('@人物{陆晚晚}');
    expect(resolveElement(reg, '@场景{锈蚀铁笼}')?.name).toBe('锈蚀铁笼');
  });
  it('mountForShot 解析角色+场景,去重、跳过无图', () => {
    const m = mountForShot(reg, { characters: ['陆晚晚', '林泽', '陆晚晚'], scene: '锈蚀铁笼' });
    expect(m.characters.map((c) => c.name)).toEqual(['陆晚晚', '林泽']);
    expect(m.scene?.name).toBe('锈蚀铁笼');
  });
});

describe('v12.12.0 · 跨引擎适配', () => {
  const mount = mountForShot(reg, { characters: ['陆晚晚', '林泽'], scene: '锈蚀铁笼', props: ['泛蓝光短刃'] });

  it('Seedance:image_urls 角色→场景→道具,mentions 带 @Image 序号', () => {
    const { imageUrls, mentions } = toSeedanceSlots(mount);
    expect(imageUrls).toEqual([H('lw_front'), H('lz_front'), H('cage'), H('blade')]);
    expect(mentions[0]).toContain('@Image1');
    expect(mentions[0]).toContain('陆晚晚');
    expect(mentions[2]).toContain('@Image3');
  });
  it('Kling:elements 含 frontal+多角度,场景进 imageUrls', () => {
    const { elements, imageUrls } = toKlingElements(mount);
    expect(elements[0]).toEqual({ frontal_image_url: H('lw_front'), reference_image_urls: [H('lw_side')] });
    expect(imageUrls).toEqual([H('cage')]);
  });
  it('Veo:reference_images ≤max,角色→场景→道具', () => {
    expect(toVeoReferenceImages(mount, 3)).toEqual([H('lw_front'), H('lz_front'), H('cage')]);
    expect(toVeoReferenceImages(mount, 2)).toEqual([H('lw_front'), H('lz_front')]);
  });
  it('subjectReferencesFromMount:frontal 作 imageUrl、其余角度作 refImageUrls(Phase 2.1)', () => {
    const subs = subjectReferencesFromMount(mount);
    expect(subs[0]).toEqual({ imageUrl: H('lw_front'), name: '陆晚晚', refImageUrls: [H('lw_side')] });
    expect(subs[1]).toEqual({ imageUrl: H('lz_front'), name: '林泽', refImageUrls: [] }); // 单图角色无多角度
  });
  it('annotateSeedancePrompt 并入 @Image 说明', () => {
    const out = annotateSeedancePrompt('女主出拳', mount);
    expect(out).toContain('女主出拳');
    expect(out).toContain('[Multi-reference]');
    expect(out).toContain('@Image1');
  });
});

describe('v12.12.0 · scenesLikelySame(真末帧串帧守卫)', () => {
  it('相同/前缀相含 → true', () => {
    expect(scenesLikelySame('锈蚀铁笼格斗台', '锈蚀铁笼格斗台')).toBe(true);
    expect(scenesLikelySame('锈蚀铁笼格斗台', '锈蚀铁笼格斗台（延续）')).toBe(true);
  });
  it('任一未知 → 信任 transition → true', () => {
    expect(scenesLikelySame(undefined, '铁笼')).toBe(true);
    expect(scenesLikelySame('铁笼', '')).toBe(true);
  });
  it('明显不同场景 → false(挡住误标的跨场景续接)', () => {
    expect(scenesLikelySame('锈蚀铁笼格斗台', '阳光明媚的海滩沙地')).toBe(false);
  });
});
