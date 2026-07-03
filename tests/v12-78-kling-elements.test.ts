/**
 * v12.78 — Kling Elements 接入 dispatch 链:capability 动态开关。
 */
import { describe, it, expect, afterEach } from 'vitest';

afterEach(() => { delete process.env.KLING_ELEMENTS; });

describe('v12.78 · kling provider Elements capability', () => {
  it('缺省 supportsSubjectReference=false;KLING_ELEMENTS=1 → true(getter 动态)', async () => {
    await import('@/lib/video-providers/builtins');
    const { listVideoProviders } = await import('@/lib/video-providers/registry');
    const kling = listVideoProviders().find((p) => p.id === 'kling')!;
    expect(kling).toBeTruthy();
    delete process.env.KLING_ELEMENTS;
    expect(kling.supportsSubjectReference).toBe(false);
    process.env.KLING_ELEMENTS = '1';
    expect(kling.supportsSubjectReference).toBe(true);
  });
});
