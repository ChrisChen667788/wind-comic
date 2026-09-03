/**
 * v12.416 — libass 字幕 ≠ 帧内文字。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * 本轮竞品复核把这条列为**最实的一个缺口**。我们有 libass 中文字幕烧录,
 * 但那是**后期叠加**的一层字。短剧/漫剧真正需要的是**生成层的帧内文字**:
 * 片头字卡、对白框、招牌、书信 —— 这些字得长在画面里、跟着透视和光线走。
 *
 * 而通用图像模型画汉字基本是乱码 —— **它不报错**,只画出一堆像汉字的鬼画符。
 * 又一个「失败长得像成功」:出图成功了,只是字不对,而且没人会发现。
 *
 * ── 这条测试锁的是那条克制 ────────────────────────────────────────────
 * 没有擅长写字的引擎时,**不硬画** —— 明确回落到叠字并说明原因。
 * 让通用模型硬画出来的是「看起来对、其实是乱码」的图,比叠一层字幕更糟。
 */
import { describe, it, expect } from 'vitest';
import {
  detectTextInFrame, routeTextInFrame, buildGlyphPrompt, GLYPH_CAPABLE_ENGINES,
} from '@/lib/text-in-frame';
import fs from 'node:fs';

describe('v12.416 · 帧内中文文字', () => {
  it('没有确切文字就不算需要帧内文字 —— 否则退化成让模型自由发挥写点像字的东西', () => {
    expect(detectTextInFrame({ description: '片头标题卡' }).kind).toBe('none');
    expect(detectTextInFrame({ description: '片头标题卡', onScreenText: '  ' }).kind).toBe('none');
  });

  it('按形态识别:字卡 / 对白框 / 招牌 / 信件', () => {
    const cases: Array<[string, string]> = [
      ['片头标题卡缓缓浮现', 'title-card'],
      ['漫画对白框里写着', 'dialogue-box'],
      ['街边招牌亮起', 'signage'],
      ['他展开那封信件', 'letter'],
    ];
    for (const [desc, kind] of cases) {
      expect(detectTextInFrame({ description: desc, onScreenText: '月挂不下来' }).kind, desc).toBe(kind);
    }
  });

  it('有确切文字但认不出形态时,仍按字卡处理(总比乱码强)', () => {
    expect(detectTextInFrame({ description: '一个空镜', onScreenText: '第三集' }).kind).toBe('title-card');
  });

  it('有擅长写字的引擎时交给它,并附上「要写什么字」的明确指令', () => {
    const need = detectTextInFrame({ description: '片头字卡', onScreenText: '月挂不下来' });
    const r = routeTextInFrame(need, ['mj', 'seedream', 'kontext']);
    expect(r.engine).toBe('seedream');
    expect(r.fallbackToOverlay).toBe(false);
    expect(r.promptSuffix, '不说清写什么字,等于让它自由发挥').toContain('月挂不下来');
    expect(r.promptSuffix).toMatch(/笔画完整|准确可读/);
  });

  it('**没有擅长写字的引擎时不硬画** —— 这是本版的全部要点', () => {
    const need = detectTextInFrame({ description: '片头字卡', onScreenText: '月挂不下来' });
    const r = routeTextInFrame(need, ['mj', 'kontext', 'minimax-single']);
    expect(r.engine, '让通用模型画汉字 = 产出看起来对、其实是乱码的图').toBeNull();
    expect(r.fallbackToOverlay).toBe(true);
    expect(r.reason).toContain('鬼画符');
    expect(r.reason, '要说清为什么这比叠字更糟').toContain('失败长得像成功');
  });

  it('不需要帧内文字时既不选引擎也不回落 —— 别给普通镜头平白加一层叠字', () => {
    const r = routeTextInFrame({ kind: 'none', text: '' }, ['mj']);
    expect(r.engine).toBeNull();
    expect(r.fallbackToOverlay).toBe(false);
  });

  it('要写的字被引号包住 —— 免得模型把它当成场景描述的一部分', () => {
    const p = buildGlyphPrompt({ kind: 'signage', text: '春风理发店' });
    expect(p).toContain('「春风理发店」');
    expect(p).toContain('招牌');
  });

  it('已接进图像路由 —— 造好不接线是这个项目反复犯的病', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src, '窗口自证:找不到图像路由决策点').toContain('decideImageRoute(');
    expect(src).toContain('detectTextInFrame(');
    expect(src).toContain('routeTextInFrame(');
    // 选中的写字引擎必须真的顶到 primary,否则等于没选
    const i = src.indexOf('routeTextInFrame(');
    const block = src.slice(i, i + 700);
    expect(block).toMatch(/route\.primary\s*=/);
  });

  it('候选引擎清单不为空 —— 空清单会让每一镜都静默回落', () => {
    expect(GLYPH_CAPABLE_ENGINES.length).toBeGreaterThan(0);
    expect(GLYPH_CAPABLE_ENGINES).toContain('seedream');
  });
});
