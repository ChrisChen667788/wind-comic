import { describe, it, expect } from 'vitest';
import { pickContinueProject, suggestNextStep } from '@/lib/next-step';

describe('v10.5.4 · pickContinueProject', () => {
  it('优先级:active > draft > 最近更新', () => {
    const list = [
      { id: 'c', status: 'completed', updatedAt: '2026-06-11' },
      { id: 'd', status: 'draft', updatedAt: '2026-06-01' },
      { id: 'a', status: 'active', updatedAt: '2026-05-01' },
    ];
    expect(pickContinueProject(list)!.id).toBe('a');
    expect(pickContinueProject(list.filter((p) => p.id !== 'a'))!.id).toBe('d');
    expect(pickContinueProject([list[0]])!.id).toBe('c');
  });
  it('同级取最近更新;空列表 → null(空项目态不显示)', () => {
    const two = [
      { id: 'old', status: 'active', updatedAt: '2026-06-01' },
      { id: 'new', status: 'active', updatedAt: '2026-06-10' },
    ];
    expect(pickContinueProject(two)!.id).toBe('new');
    expect(pickContinueProject([])).toBeNull();
  });
});

describe('v10.5.4 · suggestNextStep', () => {
  it('按状态给建议;draft 区分有无剧本', () => {
    expect(suggestNextStep({ id: 'x', status: 'active' }).label).toContain('进度');
    expect(suggestNextStep({ id: 'x', status: 'completed' }).label).toContain('导出');
    expect(suggestNextStep({ id: 'x', status: 'draft' }).hint).toContain('创意');
    expect(suggestNextStep({ id: 'x', status: 'draft', scriptData: { shots: [1] } }).hint).toContain('草稿已就绪');
    expect(suggestNextStep({ id: 'x', status: '???' }).label).toBe('打开项目');
  });
});
