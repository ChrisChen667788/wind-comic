import { describe, it, expect } from 'vitest';
import { withVerticalHints, verticalCompositionHints, VERTICAL_ASPECT } from '@/lib/vertical-composition';

describe('v10.6.0 · 竖构图模板', () => {
  it('9:16 注入:含居中/头部留白/底部留字幕区三要素', () => {
    const out = withVerticalHints('a noir alley shot', '9:16');
    expect(out).toContain('a noir alley shot');
    expect(out).toContain('vertical 9:16');
    expect(out).toContain('centered');
    expect(out).toContain('headroom');
    expect(out).toContain('bottom 20%');
  });

  it('其他画幅零注入(横屏零回归验收条款)', () => {
    for (const a of ['16:9', '1:1', '2.35:1', undefined]) {
      expect(withVerticalHints('p', a)).toBe('p');
    }
  });

  it('常量自洽', () => {
    expect(VERTICAL_ASPECT).toBe('9:16');
    expect(withVerticalHints('p', '9:16')).toBe(`p, ${verticalCompositionHints()}`);
  });
});
