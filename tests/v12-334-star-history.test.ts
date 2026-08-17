/**
 * v12.334 — 自采 star 曲线。
 *
 * ── 这版为什么存在 ────────────────────────────────────────────────
 * GitHub 2026-06-30 把 `/repos/{owner}/{repo}/stargazers` 收窄为仅 admin/collaborator
 * 可访问(原文理由:该名单被大量用于采集用户数据发垃圾邮件)。于是 star-history.com
 * 这类第三方对**任何**仓库都是 404,README 里那张图返回的是一条公告而非曲线。
 * 而「看自己家的」没被关 —— Actions 的 GITHUB_TOKEN 就持有本仓库身份。
 *
 * ── 本文件锁什么 ──────────────────────────────────────────────────
 * 重点不是「图好不好看」(那要真看,已经人工看过两张主题),而是三条**会静默出错**的地方:
 *   ① 抓取残缺时绝不能覆盖已提交的历史 —— 否则一次分页中断就把曲线抹平,且没人会发现;
 *   ② 累计曲线必须画成**阶梯**:star 是离散事件,直线连点会画出不存在的平滑增长;
 *   ③ 刻度文案不能有歧义 —— 首版写成 `Jun 26`(本意 2026 年 6 月)会被读成「6 月 26 日」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  buildSeries,
  mergeSeries,
  niceTicks,
  monthTicks,
  tickLabels,
  renderSvg,
  PLAUSIBLE_FLOOR,
} from '../scripts/gen-star-history.mjs';

describe('v12.334 · buildSeries:时间戳 → 逐日累计', () => {
  it('同一天多颗星合并成一个点,累计值递增', () => {
    const s = buildSeries(['2026-05-09T10:00:00Z', '2026-05-09T23:00:00Z', '2026-05-11T01:00:00Z']);
    expect(s).toEqual([{ d: '2026-05-09', c: 2 }, { d: '2026-05-11', c: 3 }]);
  });

  it('乱序输入也按日期升序输出(API 分页不保证有序)', () => {
    const s = buildSeries(['2026-07-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z']);
    expect(s.map((p) => p.d)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
    expect(s[s.length - 1].c).toBe(3);
  });

  it('脏数据(null / 非日期)被丢掉而不是算成一天', () => {
    const s = buildSeries(['2026-05-09T10:00:00Z', null as any, '', 'not-a-date', undefined as any]);
    expect(s).toEqual([{ d: '2026-05-09', c: 1 }]);
  });

  it('空输入返回空序列,不抛错', () => {
    expect(buildSeries([])).toEqual([]);
  });
});

describe('v12.334 · mergeSeries:抓取失败不许抹掉历史', () => {
  const committed = { series: [{ d: '2026-05-09', c: 100 }, { d: '2026-08-01', c: 419 }], total: 419 };

  it('抓到空 → 保留已提交历史(**绝不**用空序列覆盖)', () => {
    const r = mergeSeries(committed, []);
    expect(r.source).toBe('preserved');
    expect(r.total).toBe(419);
    expect(r.series).toBe(committed.series);
    expect(r.reason).toMatch(/保留/);
  });

  it('抓到的总数跌破阈值 → 判为分页中断,保留旧数据', () => {
    const partial = [{ d: '2026-05-09', c: 100 }]; // 100 < 419*0.8
    const r = mergeSeries(committed, partial);
    expect(r.source).toBe('preserved');
    expect(r.total).toBe(419);
    expect(r.reason).toMatch(/分页中断|跌破/);
  });

  it('正常抓取(含小幅取消 star)→ 新数据权威', () => {
    const fresh = [{ d: '2026-05-09', c: 100 }, { d: '2026-08-17', c: 415 }]; // 415 > 419*0.8
    const r = mergeSeries(committed, fresh);
    expect(r.source).toBe('api');
    expect(r.total).toBe(415);
    expect(r.reason).toBe('');
  });

  it('阈值边界:恰好等于 floor 倍数时算正常(不误伤)', () => {
    const exact = [{ d: '2026-08-17', c: Math.ceil(419 * PLAUSIBLE_FLOOR) }];
    expect(mergeSeries(committed, exact).source).toBe('api');
  });

  it('首次运行(无已提交数据)→ 直接采用抓取结果', () => {
    const r = mergeSeries(null, [{ d: '2026-05-09', c: 3 }]);
    expect(r.source).toBe('api');
    expect(r.total).toBe(3);
  });
});

describe('v12.334 · 刻度', () => {
  it('纵轴用 1/2/5×10^n 的整齐步长,且覆盖到最大值', () => {
    const t = niceTicks(419);
    expect(t[0]).toBe(0);
    expect(Math.max(...t)).toBeGreaterThanOrEqual(419);
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(7);
    expect(new Set(t.slice(1).map((v, i) => v - t[i])).size, '步长应当均匀').toBe(1);
  });

  it('0 / 负数不产生 NaN 刻度', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-5)).toEqual([0]);
  });

  it('顶格必须 ≥ 最大值 —— 否则曲线末端会画到绘图区外面(419 曾只画到 400)', () => {
    for (const n of [1, 2, 3, 7, 12, 99, 101, 419, 2500, 40000]) {
      expect(Math.max(...niceTicks(n)), `${n} 的顶格刻度低于自身`).toBeGreaterThanOrEqual(n);
    }
  });

  it('小仓库不出现重复刻度(step 不得小于 1;曾算出 0.2 → 0,0,0,1,1,1)', () => {
    for (const n of [1, 2, 3, 4]) {
      const t = niceTicks(n);
      expect(new Set(t).size, `${n} 的刻度有重复:${t.join(',')}`).toBe(t.length);
    }
  });

  it('**起点单独给一个刻度** —— 否则首月整段没有时间参照', () => {
    const s = [{ d: '2026-05-09', c: 1 }, { d: '2026-08-17', c: 419 }];
    const t = monthTicks(s);
    expect(t[0], '第一个刻度必须是数据起点,而不是落在数据之外的 05-01').toBe('2026-05-09');
    expect(t).toContain('2026-06-01');
    expect(t).toContain('2026-08-01');
    expect(t.every((d) => d >= '2026-05-09' && d <= '2026-08-17'), '刻度不得落在数据范围之外').toBe(true);
  });

  it('起点紧贴月首时省掉它,避免标签叠字', () => {
    const s = [{ d: '2026-05-30', c: 1 }, { d: '2026-12-31', c: 99 }];
    expect(monthTicks(s)[0]).toBe('2026-06-01');
  });

  it('`Jun 26` 这类歧义写法不许回来(它会被读成「6 月 26 日」)', () => {
    const labels = tickLabels(['2026-05-09', '2026-06-01', '2026-07-01']);
    expect(labels).toEqual(["May 9 '26", 'Jun', 'Jul']);
    for (const l of labels) {
      expect(l, `「${l}」月名后直接跟两位数会被误读成日期`).not.toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    }
  });

  it('跨年时把年份标出来', () => {
    expect(tickLabels(['2026-12-01', '2027-01-01'])).toEqual(["Dec '26", "Jan '27"]);
  });
});

describe('v12.334 · renderSvg', () => {
  const data = {
    repo: 'ChrisChen667788/wind-comic',
    series: [{ d: '2026-05-09', c: 1 }, { d: '2026-06-20', c: 200 }, { d: '2026-08-17', c: 419 }],
    total: 419,
    updatedAt: '2026-08-17T08:59:03.904Z',
    stale: false,
  };

  it('两套主题都产出合法 SVG,且背景色不同(暗色模式不能白底刺眼)', () => {
    for (const th of ['dark', 'light'] as const) {
      const svg = renderSvg(data, th);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg).toContain('viewBox="0 0 800 400"');
    }
    expect(renderSvg(data, 'dark')).toContain('#0A0908');
    expect(renderSvg(data, 'light')).toContain('#FBF9F5');
  });

  it('**不引外部字体、不用 <style>** —— README 里 SVG 以图片加载,外部资源一律被拦', () => {
    const svg = renderSvg(data, 'dark');
    expect(svg).not.toMatch(/<style/);
    expect(svg).not.toMatch(/@font-face|@import|href="http/);
  });

  it('所有坐标落在 viewBox 内(越界会被裁掉且没人报错)', () => {
    const svg = renderSvg(data, 'dark');
    const xs = [...svg.matchAll(/\b(?:x|x1|x2|cx)="([\d.]+)"/g)].map((m) => +m[1]);
    const pxs = [...svg.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].flatMap((m) => [+m[1]]);
    const ys = [...svg.matchAll(/\b(?:y|y1|y2|cy)="([\d.]+)"/g)].map((m) => +m[1]);
    expect(Math.max(...xs, ...pxs)).toBeLessThanOrEqual(800);
    expect(Math.max(...ys)).toBeLessThanOrEqual(400);
  });

  it('曲线是**阶梯**:star 是离散事件,直线连点会画出不存在的平滑增长', () => {
    const svg = renderSvg(data, 'dark');
    const path = svg.match(/<path d="(M [^"]+)" fill="none"/)?.[1] || '';
    expect(path).toBeTruthy();
    // 每个数据点贡献「先横到位再竖上去」两段,故 L 段数 ≈ 2×(点数-1)
    const segs = (path.match(/L /g) || []).length;
    expect(segs).toBeGreaterThanOrEqual(2 * (data.series.length - 1));
  });

  it('总数与更新日期都写在图上(图被单独转发时也说得清自己多旧)', () => {
    const svg = renderSvg(data, 'dark');
    expect(svg).toContain('419 stars');
    expect(svg).toContain('2026-08-17');
  });

  it('数据被冻结时**图上直说**,不假装是最新的', () => {
    const svg = renderSvg({ ...data, stale: true }, 'dark');
    expect(svg).toMatch(/frozen/);
    expect(svg).toMatch(/restricted/);
  });

  it('空序列给出可读占位而不是崩掉或画出空白框', () => {
    const svg = renderSvg({ ...data, series: [], total: 0 }, 'dark');
    expect(svg).toContain('No star data yet');
    expect(svg).not.toContain('NaN');
  });

  it('仓库名做了转义(尖括号/引号不会破坏 SVG)', () => {
    const svg = renderSvg({ ...data, repo: 'a<b>&"c' }, 'dark');
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
  });
});

describe('v12.334 · 接线:产物与 workflow 真的存在且自洽', () => {
  it('三个产物都已提交,且 SVG 与 JSON 的总数一致', () => {
    const j = JSON.parse(fs.readFileSync('assets/star-history.json', 'utf-8'));
    expect(j.series.length).toBeGreaterThan(0);
    expect(j.total).toBe(j.series[j.series.length - 1].c);
    for (const f of ['assets/star-history-dark.svg', 'assets/star-history-light.svg']) {
      const svg = fs.readFileSync(f, 'utf-8');
      expect(svg).toContain(`${j.total} stars`);
      expect(svg).toContain(j.repo);
    }
  });

  it('README 引的是**本地**图,不再是已失效的第三方服务', () => {
    const r = fs.readFileSync('README.md', 'utf-8');
    expect(r).toContain('assets/star-history-dark.svg');
    expect(r).toContain('assets/star-history-light.svg');
    expect(r, 'star-history.com 的图现在返回的是公告而不是曲线').not.toContain('api.star-history.com');
  });

  it('亮/暗两张都接上了(只接一张会在某个主题下瞎掉)', () => {
    const r = fs.readFileSync('README.md', 'utf-8');
    expect(r).toMatch(/prefers-color-scheme: dark/);
    expect(r).toMatch(/<picture>/);
  });

  it('workflow 存在,且只申请 contents:write(不继承仓库默认的宽权限)', () => {
    const w = fs.readFileSync('.github/workflows/star-history.yml', 'utf-8');
    expect(w).toMatch(/permissions:\s*\n\s*contents: write/);
    expect(w).toMatch(/schedule:/);
    expect(w).toMatch(/concurrency:/);           // 两次运行同时改 assets/ 会撞车
    expect(w).toContain('gen-star-history.mjs');
    expect(w).toContain('[skip ci]');            // 每天一次资产提交不该白烧一轮 CI
  });

  it('workflow 用的是 GITHUB_TOKEN —— 自采方案成立的全部前提', () => {
    const w = fs.readFileSync('.github/workflows/star-history.yml', 'utf-8');
    expect(w).toContain('secrets.GITHUB_TOKEN');
  });
});
