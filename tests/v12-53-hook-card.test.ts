/**
 * v12.53 — 开场 Hook 卡文案派生(短视频前 2s 留存)。宁缺毋滥:商业题材 + 短 hook 句才出。
 */
import { describe, it, expect } from 'vitest';
import { deriveHookCard } from '@/lib/end-card';

describe('v12.53 · 开场 Hook 卡派生', () => {
  it('商业题材 + 首镜短台词 → 出 hook(title=台词)', () => {
    const h = deriveHookCard('电商精华水广告片', '再撑一下，没事');
    expect(h).not.toBeNull();
    expect(h!.title).toBe('再撑一下，没事');
  });

  it('显式 hookLine 优先于首镜台词', () => {
    expect(deriveHookCard('护肤广告片', '随便一句', '熬夜肌有救了')!.title).toBe('熬夜肌有救了');
  });

  it('去掉开头省略号噪声', () => {
    expect(deriveHookCard('广告片', '……快看这个')!.title).toBe('快看这个');
  });

  it('非商业题材 → null', () => {
    expect(deriveHookCard('武侠短剧', '大侠请留步')).toBeNull();
  });

  it('hook 太长(>16)/空/含换行 → null(比 CTA 更短的阈值)', () => {
    expect(deriveHookCard('广告片', '这是一句明显太长不适合做开场hook的台词内容')).toBeNull();
    expect(deriveHookCard('广告片', '')).toBeNull();
    expect(deriveHookCard('广告片', '第一行\n第二行')).toBeNull();
  });
});
