/**
 * v6.1.2 — 多模态参考 (classify / validate / summarize) 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRef, validateRefs, summarizeRefs, canAdd, MAX_PER_KIND,
  type ReferenceAsset,
} from '@/lib/multimodal-ref';

function ref(kind: ReferenceAsset['kind'], i = 0): ReferenceAsset {
  return { id: `${kind}-${i}`, kind, url: `https://x/${kind}${i}.bin`, name: `${kind}${i}` };
}

describe('v6.1.2 · classifyRef', () => {
  it('按 mime 判定', () => {
    expect(classifyRef({ mime: 'image/png' })).toBe('image');
    expect(classifyRef({ mime: 'audio/mpeg' })).toBe('audio');
    expect(classifyRef({ mime: 'video/mp4' })).toBe('video');
  });
  it('按扩展名判定 (mime 缺失)', () => {
    expect(classifyRef({ name: 'shot.WEBP' })).toBe('image');
    expect(classifyRef({ url: 'https://cdn/a/b.mp3?token=1' })).toBe('audio');
    expect(classifyRef({ name: 'clip.mov' })).toBe('video');
  });
  it('按 data:URI mime 判定', () => {
    expect(classifyRef({ url: 'data:image/jpeg;base64,/9j/' })).toBe('image');
    expect(classifyRef({ url: 'data:audio/wav;base64,UklG' })).toBe('audio');
  });
  it('不支持的类型 → null', () => {
    expect(classifyRef({ mime: 'application/pdf' })).toBeNull();
    expect(classifyRef({ name: 'notes.txt' })).toBeNull();
    expect(classifyRef({})).toBeNull();
  });
});

describe('v6.1.2 · summarizeRefs / canAdd', () => {
  it('分类计数', () => {
    const refs = [ref('image', 0), ref('image', 1), ref('video', 0)];
    expect(summarizeRefs(refs)).toEqual({ image: 2, audio: 0, video: 1 });
  });
  it('canAdd 到上限即 false', () => {
    const imgs = Array.from({ length: MAX_PER_KIND.image }, (_, i) => ref('image', i));
    expect(canAdd(imgs, 'image')).toBe(false);
    expect(canAdd(imgs, 'audio')).toBe(true);
  });
});

describe('v6.1.2 · validateRefs', () => {
  it('合法 → ok', () => {
    expect(validateRefs([ref('image'), ref('audio'), ref('video')]).ok).toBe(true);
  });
  it('超上限 → 报错', () => {
    const tooMany = Array.from({ length: MAX_PER_KIND.video + 1 }, (_, i) => ref('video', i));
    const r = validateRefs(tooMany);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('视频');
  });
  it('缺 url → 报错', () => {
    const r = validateRefs([{ id: 'x', kind: 'image', url: '', name: '空图' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('空图');
  });
});
