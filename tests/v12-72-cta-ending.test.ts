/**
 * v12.72 — 商业片 CTA 收尾保障。
 */
import { describe, it, expect } from 'vitest';
import { ensureCtaEnding } from '@/lib/end-card';

describe('v12.72 · ensureCtaEnding', () => {
  it('末镜已有 CTA 信号(问句「会是你吗」)→ 不动', () => {
    const shots = [{ dialogue: 'A' }, { dialogue: '下一个发光的,会是你吗?' }];
    expect(ensureCtaEnding(shots).added).toBe(false);
    expect(shots[1].dialogue).toBe('下一个发光的,会是你吗?');
  });

  it('倒数第二镜有 CTA 也算(点击/链接)', () => {
    const shots = [{ dialogue: '点击下方链接' }, { dialogue: '' }];
    expect(ensureCtaEnding(shots).added).toBe(false);
  });

  it('全无 CTA → 末镜追加确定性 CTA(有台词则拼接)', () => {
    const shots = [{ dialogue: '早晨真好' }, { dialogue: '我醒了' }];
    const r = ensureCtaEnding(shots, '冷萃咖啡液');
    expect(r.added).toBe(true);
    expect(shots[1].dialogue).toContain('我醒了。');
    expect(shots[1].dialogue).toContain('心动就试试冷萃咖啡液');
  });

  it('末镜无台词 → 直接填 CTA;无产品名用通用句', () => {
    const shots = [{ dialogue: '嗨' }, { dialogue: '' }];
    const r = ensureCtaEnding(shots);
    expect(r.added).toBe(true);
    expect(shots[1].dialogue).toBe('心动不如行动,来试试,下一个惊喜是你。');
  });

  it('空数组容错', () => {
    expect(ensureCtaEnding([]).added).toBe(false);
  });
});
