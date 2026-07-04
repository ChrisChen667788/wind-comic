/**
 * v12.99 — 文案变体矩阵:prompt 约束 + 解析/截断/合规。
 */
import { describe, it, expect } from 'vitest';
import { buildCopyMatrixPrompt, parseCopyMatrix } from '@/lib/publish-copy';

describe('v12.99 · copy matrix', () => {
  it('prompt:三形态结构 + 条数 + 广告法约束', () => {
    const p = buildCopyMatrixPrompt({ idea: '冷萃', genre: '现代商业' });
    expect(p.system).toContain('short');
    expect(p.system).toContain('medium');
    expect(p.system).toContain('long');
    expect(p.system).toContain('广告法');
  });

  it('解析:截断(短20/中题20正文60/长300)+ 条数上限(8/8/4)+ 合规净化', () => {
    const raw = JSON.stringify({
      short: Array(12).fill('最强冷萃只需三秒立刻清醒真的很好用啊这里超长'),
      medium: Array(10).fill({ title: '标题', body: '正文'.repeat(50) }),
      long: Array(6).fill('长文'.repeat(300)),
    });
    const m = parseCopyMatrix(raw)!;
    expect(m.short.length).toBe(8);
    expect(m.short[0].length).toBeLessThanOrEqual(20);
    expect(m.short[0]).toContain('出色'); // 最强→出色
    expect(m.medium.length).toBe(8);
    expect(m.medium[0].body.length).toBeLessThanOrEqual(60);
    expect(m.long.length).toBe(4);
    expect(m.long[0].length).toBeLessThanOrEqual(300);
  });

  it('无 short → null;markdown 包裹可解', () => {
    expect(parseCopyMatrix('{"medium":[]}')).toBeNull();
    expect(parseCopyMatrix('```json\n{"short":["好文案"]}\n```')!.short).toEqual(['好文案']);
  });
});
