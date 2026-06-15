/**
 * v12.2.1 — 一致性记忆持久化地基(阶段二十一):
 * SceneAnchorRegistry 序列化/回灌 round-trip —— rerun/重启复用上次场景锚。
 * (DNA 落库 + 预载是 orchestrator 集成路径,由 journey e2e 覆盖;此处锁纯逻辑。)
 */
import { describe, it, expect } from 'vitest';
import { SceneAnchorRegistry } from '@/lib/consistency-policy';

describe('v12.2.1 · SceneAnchorRegistry toEntries/seed(场景锚持久化 round-trip)', () => {
  it('register → toEntries → seed 到新实例:锚点完整复原', () => {
    const a = new SceneAnchorRegistry();
    a.register('阁楼', { url: 'http://x/loft.png', description: '昏黄的木质阁楼' });
    a.register('天台', { url: 'http://x/roof.png', description: '夜晚天台' });
    const entries = a.toEntries();
    expect(entries.length).toBe(2);

    const b = new SceneAnchorRegistry();
    const added = b.seed(entries);
    expect(added).toBe(2);
    // 归一查询应命中(register 存归一形,lookup 也归一)
    expect(b.lookupByLocation('阁楼')).toBe('http://x/loft.png');
    expect(b.lookupByLocation('《阁楼》')).toBe('http://x/loft.png'); // 标点归一(normalizeKey 剥《》)
    expect(b.size()).toBe(2);
  });

  it('seed 只补未注册的(首张基线优先,不覆盖本次新登记)', () => {
    const reg = new SceneAnchorRegistry();
    reg.register('阁楼', { url: 'http://fresh/loft.png' });      // 本次新锚
    const added = reg.seed([{ location: '阁楼', url: 'http://stale/loft.png' }]); // 上次旧锚
    expect(added).toBe(0);                                        // 已有 → 不覆盖
    expect(reg.lookupByLocation('阁楼')).toBe('http://fresh/loft.png');
  });

  it('seed 容错:空/缺字段条目跳过,不崩', () => {
    const reg = new SceneAnchorRegistry();
    expect(reg.seed(undefined)).toBe(0);
    expect(reg.seed([])).toBe(0);
    expect(reg.seed([{ location: '', url: 'http://x' }, { location: 'a', url: undefined } as any, { url: 'http://y' } as any])).toBe(0);
    expect(reg.size()).toBe(0);
  });

  it('seed 后再 register 新地点:两者共存', () => {
    const reg = new SceneAnchorRegistry();
    reg.seed([{ location: '阁楼', url: 'http://x/loft.png' }]);
    reg.register('天台', { url: 'http://x/roof.png' });
    expect(reg.size()).toBe(2);
    expect(reg.lookupByLocation('阁楼')).toBe('http://x/loft.png');
    expect(reg.lookupByLocation('天台')).toBe('http://x/roof.png');
  });
});
