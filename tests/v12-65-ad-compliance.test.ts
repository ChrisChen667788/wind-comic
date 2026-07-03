/**
 * v12.65 — 广告法合规:绝对化用语/极限承诺/医疗红线 检测与净化。
 */
import { describe, it, expect } from 'vitest';
import { checkAdCompliance, sanitizeAdCopy, sanitizeScriptDialogues } from '@/lib/ad-compliance';

describe('v12.65 · 广告合规', () => {
  it('检测绝对化用语(最/第一/顶级/国家级)', () => {
    const hits = checkAdCompliance('全网第一的顶级精华水,效果最强');
    const words = hits.map((h) => h.word);
    expect(words).toContain('全网第一');
    expect(words).toContain('顶级');
    expect(words).toContain('最强');
    expect(hits.every((h) => h.category === '绝对化用语')).toBe(true);
  });

  it('净化替换保语感(最好用→很好用;根治→改善)', () => {
    expect(sanitizeAdCopy('最好用的抗老精华').text).toBe('很好用的抗老精华');
    const r = sanitizeAdCopy('根治熬夜肌,百分之百有效,立竿见影');
    expect(r.text).not.toMatch(/根治|百分之百|立竿见影/);
    expect(r.text).toContain('改善');
    expect(r.hits.length).toBe(3);
  });

  it('医疗功效红线(化妆品不得宣称治疗/消炎/杀菌)', () => {
    const r = sanitizeAdCopy('消炎杀菌,治疗痘痘');
    expect(r.text).toBe('舒缓清洁,护理痘痘');
    expect(r.hits.map((h) => h.category)).toContain('医疗功效红线');
  });

  it('干净文案零改动零命中', () => {
    const r = sanitizeAdCopy('熬夜肌救星,修护暗沉,上脸清爽');
    expect(r.hits.length).toBe(0);
    expect(r.text).toBe('熬夜肌救星,修护暗沉,上脸清爽');
  });

  it('sanitizeScriptDialogues 就地净化台词并汇总命中', () => {
    const shots = [
      { dialogue: '这是最强的冷萃咖啡液!' },
      { dialogue: '' },
      { dialogue: '提神不失眠,真好' },
    ];
    const hits = sanitizeScriptDialogues(shots);
    expect(hits.length).toBe(1);
    expect(shots[0].dialogue).toBe('这是出色的冷萃咖啡液!');
    expect(shots[2].dialogue).toBe('提神不失眠,真好');
  });
});
