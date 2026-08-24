/**
 * v12.335 — README 媒体体积预算。
 *
 * ── 病根不是"图坏了" ──────────────────────────────────────────────
 * 仓库主页图片/GIF 集体加载不出来,查下来**文件一个都没坏**:
 *   · 无认证 `github.com/<repo>/raw/main/<path>` → 404
 *   · 无认证 `raw.githubusercontent.com/...`     → **429**  ← 诚实的状态码
 *   · 带认证 API `contents`                      → 200,字节数完全正确
 * 是匿名媒体端点在限流,而 `/raw/` 路径**把 429 显示成 404** —— 看起来像文件没了。
 * 诱因是一次页面要拉 37 个文件 / 23.2MB(截图都是 2880×1800,而正文栏只有 ~980px)。
 *
 * ── 这个文件锁什么 ────────────────────────────────────────────────
 * 压一次没用:下一版新截图又是 2880×1800 塞回来。所以锁的是**预算**,不是某几张图。
 * 另外锁住那条豁免必须带理由 —— 否则门禁会退化成"压不动就加一行"。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  mediaRefsIn, collectRefs, auditBudget, TOTAL_BUDGET, FILE_BUDGET, ALLOW,
} from '../scripts/optimize-media.mjs';

describe('v12.335 · 引用提取', () => {
  it('认 HTML 的 src / srcset 与 markdown 的 ![]()', () => {
    const t = `<img src="assets/a.png"> <source srcset="assets/b.jpg"> ![x](assets/c.gif)`;
    expect(mediaRefsIn(t).sort()).toEqual(['assets/a.png', 'assets/b.jpg', 'assets/c.gif']);
  });

  it('外链不计入本仓预算(别人的带宽不归我们管)', () => {
    expect(mediaRefsIn('<img src="https://img.shields.io/x.svg">')).toEqual([]);
  });

  it('非媒体后缀不误抓', () => {
    expect(mediaRefsIn('<a href="assets/doc.pdf">x</a> <img src="assets/a.png">')).toEqual(['assets/a.png']);
  });
});

describe('v12.335 · 预算核算', () => {
  it('总量超了要报出来', () => {
    const r = auditBudget([{ file: 'a', size: 20 * 1024 * 1024 }]);
    expect(r.overTotal).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('单文件超了要报出来,并按大小降序(先修最肥的)', () => {
    const r = auditBudget([
      { file: 'a', size: FILE_BUDGET + 1 },
      { file: 'b', size: FILE_BUDGET * 3 },
      { file: 'c', size: 10 },
    ]);
    expect(r.oversized.map((e) => e.file)).toEqual(['b', 'a']);
  });

  it('豁免名单里的不算超标', () => {
    const f = Object.keys(ALLOW)[0];
    const r = auditBudget([{ file: f, size: FILE_BUDGET * 100 }], TOTAL_BUDGET * 100, FILE_BUDGET);
    expect(r.oversized).toEqual([]);
  });

  it('全在预算内时 ok', () => {
    expect(auditBudget([{ file: 'a', size: 100 }]).ok).toBe(true);
  });
});

describe('v12.335 · 豁免必须带理由(否则会变成压不动就加一行的垃圾场)', () => {
  it('每条豁免都有非空理由,且理由足够具体', () => {
    const keys = Object.keys(ALLOW);
    expect(keys.length, '豁免名单为空则本用例失去意义,但不算错').toBeGreaterThanOrEqual(0);
    for (const k of keys) {
      expect(typeof ALLOW[k]).toBe('string');
      expect(ALLOW[k].length, `${k} 的豁免理由太短,等于没写`).toBeGreaterThan(40);
    }
  });

  it('豁免的文件确实存在(名单不该留着指向已删文件的死条目)', () => {
    for (const k of Object.keys(ALLOW)) expect(fs.existsSync(k), `${k} 不存在`).toBe(true);
  });
});

describe('v12.335 · 仓库当下必须在预算内(门禁不是摆设)', () => {
  it('README 引用的媒体总量与单文件都达标', () => {
    const entries = collectRefs().filter((f) => fs.existsSync(f)).map((f) => ({ file: f, size: fs.statSync(f).size }));
    expect(entries.length, '一个都没扫到 —— 别把 0 当通过').toBeGreaterThan(10);
    const r = auditBudget(entries);
    expect(r.oversized.map((e) => `${e.file}(${(e.size / 1024).toFixed(0)}K)`)).toEqual([]);
    expect(r.overTotal, `总量 ${(r.sum / 1048576).toFixed(2)}M 超出 ${(TOTAL_BUDGET / 1048576).toFixed(0)}M`).toBe(false);
  });

  it('README 里没有指向不存在文件的引用(改扩展名最容易留死链)', () => {
    const missing = collectRefs().filter((f) => !fs.existsSync(f));
    expect(missing).toEqual([]);
  });

  it('已进 preflight —— 不进发版流程的门禁等于没有', () => {
    const pre = fs.readFileSync('scripts/preflight.mjs', 'utf-8');
    expect(pre).toContain('optimize-media.mjs --check');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['media:check']).toBeTruthy();
  });
});

describe('v12.336 · 宣传片片尾卡的测试数不再硬编码', () => {
  it('只改「测试通过」那一格,不碰同卡上的其它数字', async () => {
    const { syncPromoFrame } = await import('../scripts/sync-doc-stats.mjs');
    // 带属性的形态也要过 —— HyperFrames 工具会注入 data-hf-id,首版正则就栽在这
    const card = '<div><div class="k cn">许可</div><div class="v">MIT</div></div>'
      + '<div data-hf-id="x"><div data-hf-id="y" class="k cn">测试通过</div><div data-hf-id="z" class="v">4131</div></div>'
      + '<div><div class="k cn">版本</div><div class="v">12335</div></div>';
    const out = syncPromoFrame(card, 4311);
    expect(out).toContain('>4311<');
    expect(out).not.toContain('>4131<');
    expect(out, '同卡上的版本号不该被顺手改掉').toContain('>12335<');
    expect(out).toContain('>MIT<');
  });

  it('仓库里那张片尾卡当前与 package 的测试数一致', () => {
    const html = fs.readFileSync('videos/wind-comic-promo/compositions/frames/08-your-keys.html', 'utf-8');
    const m = html.match(/<div\b[^>]*class="k cn"[^>]*>测试通过<\/div>\s*<div\b[^>]*class="v"[^>]*>(\d+)<\/div>/);
    expect(m, '片尾卡上找不到「测试通过」那一格').toBeTruthy();
    const readme = fs.readFileSync('README.md', 'utf-8').match(/Tests-(\d+)%2F/);
    expect(m![1], '片尾卡数字与 README 徽章不一致 —— 对外素材说了假话').toBe(readme![1]);
  });
});
