/**
 * v12.435 —— 把抽卡的代价摆到按下去之前。
 *
 * 估算逻辑 v12.172 就在 `lib/budget-estimate` 里了,但只被 `assertBudget` 用于**服务端拦截**:
 * 超预算才报错,没超就一声不吭。于是用户点「重试镜头」时看到的是个普通按钮,
 * 点完钱就没了。那几篇讲 3D 导演台/动作捕捉的竞品文章,共同卖点就是「别再抽卡烧钱」——
 * 抽卡贵不是模型问题,是**代价在按下去之后才出现**的交互问题。
 *
 * 顺带修掉一处上一版漏掉的同类谎:列表页正文已经会说「加载失败」,
 * 标题栏「共 0 个」却照样写 0。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { previewCost, confirmSpendText } from '@/lib/action-cost';
import { estimatePipelineCostCny, videoRatePerSec } from '@/lib/budget-estimate';
import { countText } from '@/lib/metric-display';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const yuan = (s: string) => Number((s.match(/¥([\d.]+)/) || [])[1]);

describe('v12.435 · 估价与护栏同源,不许两套口径', () => {
  it('整条流水线的估价 === 服务端护栏用的那个数 —— 两边不同用户就对不上账', () => {
    for (const input of [
      { videoProvider: 'veo', secondsPerShot: 5, shotCount: 8 },
      { videoProvider: 'minimax', secondsPerShot: 3, shotCount: 4 },
      { videoProvider: 'kling', secondsPerShot: 8, shotCount: 12, mode: '4k' },
      { videoProvider: null, secondsPerShot: 5, shotCount: 8 },
    ]) {
      expect(previewCost({ kind: 'pipeline', ...input }).cny).toBe(estimatePipelineCostCny(input));
    }
  });

  it('按钮上那句话里的数字就是 cny,不是另算的', () => {
    const p = previewCost({ kind: 'pipeline', videoProvider: 'veo', secondsPerShot: 5, shotCount: 8 });
    expect(yuan(p.label)).toBe(p.cny);
  });

  it('展开的算式加起来必须等于总价 —— 用户会拿它自己验', () => {
    const p = previewCost({ kind: 'pipeline', videoProvider: 'veo', secondsPerShot: 5, shotCount: 8 });
    // 「8 镜 × 5 秒 × ¥0.30/秒,另含出图与配音约 ¥4.4」
    const video = 8 * 5 * videoRatePerSec('veo');
    const other = yuan(p.detail.split('另含')[1]);
    expect(p.detail).toContain('8 镜');
    expect(p.detail).toContain('5 秒');
    expect(Math.abs(video + other - p.cny)).toBeLessThan(0.11); // 两处各自向上取 0.1
  });
});

describe('v12.435 · 估不准就得改口,保守上限不许伪装成报价', () => {
  it('引擎已知 → 「约」,并标 confident', () => {
    const p = previewCost({ kind: 'shot-video', videoProvider: 'minimax', secondsPerShot: 5 });
    expect(p.confident).toBe(true);
    expect(p.label.startsWith('约')).toBe(true);
    expect(p.detail).not.toContain('最贵');
  });

  it('引擎未指定 → 「最多」,并说清是按最贵档估的', () => {
    for (const vp of [null, undefined, '', 'some-new-engine']) {
      const p = previewCost({ kind: 'shot-video', videoProvider: vp, secondsPerShot: 5 });
      expect(p.confident).toBe(false);
      expect(p.label.startsWith('最多')).toBe(true);
      expect(p.detail).toContain('按最贵档估');
    }
  });

  it('确认话术同样改口', () => {
    expect(confirmSpendText({ kind: 'shot-video', videoProvider: 'kling' })).toContain('预计再花');
    expect(confirmSpendText({ kind: 'shot-video', videoProvider: null })).toContain('最多再花');
  });
});

describe('v12.435 · 单镜/批量/4K 的价差要看得出来', () => {
  it('4K 约是 std 的 6 倍 —— 旧估算对高清档低估过 5-10 倍', () => {
    const std = previewCost({ kind: 'shot-video', videoProvider: 'kling', secondsPerShot: 5 }).cny;
    const k4 = previewCost({ kind: 'shot-video', videoProvider: 'kling', secondsPerShot: 5, mode: '4k' }).cny;
    expect(k4).toBeGreaterThan(std * 5);
    expect(previewCost({ kind: 'shot-video', videoProvider: 'kling', mode: '4k' }).detail).toContain('4K');
  });

  it('只收真有按钮在用的花费种类 —— 没接线的备用件会在接线那天把错数一起带进界面', () => {
    const src = read('lib/action-cost.ts');
    const kinds = [...stripComments(src).matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]);
    const uniq = [...new Set(kinds)];
    expect(uniq.sort()).toEqual(['pipeline', 'shot-video']);
    // 每一种都得在界面里真有调用
    const create = read('app/dashboard/create/page.tsx');
    for (const k of uniq) expect(create).toContain(`kind: '${k}'`);
  });

  it('重生是「追加」,确认话必须说「再花」', () => {
    expect(confirmSpendText({ kind: 'shot-video', videoProvider: 'minimax' })).toMatch(/再花/);
  });
});

describe('v12.435 · 标题栏总数:读不到就不许写 0', () => {
  it('读挂了给破折号,绝不给 0', () => {
    expect(countText(0, '服务端出错(500)')).toBe('—');
    expect(countText(137, '网络不通')).toBe('—');
  });
  it('真读到了,0 就是 0 —— 真空态不许被误伤成破折号', () => {
    expect(countText(0, null)).toBe('0');
    expect(countText(12, undefined)).toBe('12');
  });
});

describe('v12.435 · 接线:价要摆在按下去之前', () => {
  const code = stripComments(read('app/dashboard/create/page.tsx'));

  it('开机按钮前摆着整条流水线的估价', () => {
    const chipAt = code.indexOf("kind: 'pipeline'");
    const rollAt = code.indexOf('onClick={handleStartCreation}');
    expect(chipAt).toBeGreaterThan(0);
    expect(rollAt).toBeGreaterThan(0);
    // 渲染顺序:估价在按钮之前
    expect(chipAt).toBeLessThan(rollAt);
    // 锁**门条件**,不只锁组件在不在:把门改成 `{false && (` 时组件字面量仍在、顺序也不变,
    // 只断言存在就测不出「估价永远不显示」(第一版就是这么漏的)。
    expect(code).toMatch(/\{isReady && \(\s*<CostChip/);
    expect(code).not.toMatch(/\{(false|0|null|undefined) && \(\s*<CostChip/);
  });

  it('重试镜头的按钮文字里带价', () => {
    expect(code).toMatch(/label: `重试镜头 \$\{shotNumber\} · \$\{previewCost\(/);
  });

  it('重试之前先确认,而且确认必须排在真正花钱的请求之前', () => {
    const at = code.indexOf('onClick: async () => {');
    expect(at).toBeGreaterThan(0);
    const end = code.indexOf('regenerate-shot', at);
    expect(end).toBeGreaterThan(at);
    const seg = code.slice(at, end);
    // 正向自证:窗口里确实是那个 handler
    expect(seg).toContain('confirmSpendText(');
    expect(seg).toMatch(/if \(!window\.confirm\(confirmSpendText\(spend\)\)\) return;/);
  });

  it('角色库/素材库标题栏走 countText,项目列表总数在读挂时不渲染数字', () => {
    expect(stripComments(read('app/dashboard/characters/page.tsx'))).toContain('countText(characters.length, loadError)');
    expect(stripComments(read('app/dashboard/assets/page.tsx'))).toContain('countText(assets.length, loadError)');
    const proj = stripComments(read('app/dashboard/projects/page.tsx'));
    expect(proj).toMatch(/\{loadError \? '—' : <NumberTicker value=\{projects\.length\} \/>\}/);
    expect(proj).not.toMatch(/^\s*<NumberTicker value=\{projects\.length\} \/> titles/m);
  });
});
