/**
 * v10.6.2 — 钩子审计三指标单测。
 *
 * 覆盖:开场 3 秒钩子分(窗口截取/词典/疑问/对白)、集尾悬念分(构件/疑问收尾/
 * 冲突峰值)、BGM 卡点对齐率(±150ms 窗口逐切点判定)、auditHooks 组装、
 * LLM assist 降级(MOCK_ENGINES=1 必走规则原样返回)、
 * 以及验收核心:18 个故事模板各跑出三指标。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Script, ScriptShot } from '@/types/agents';
import {
  OPENING_WINDOW_S,
  openingHookScore,
  cliffhangerScore,
  beatAlignmentRate,
  auditHooks,
  assistHookAuditWithLLM,
} from '@/lib/hook-audit';
import { storyTemplates } from '@/lib/story-templates';

const mkShot = (n: number, partial: Partial<ScriptShot> = {}): ScriptShot => ({
  shotNumber: n,
  sceneDescription: '',
  action: '',
  emotion: '',
  characters: ['主角'],
  ...partial,
});

const mkScript = (shots: ScriptShot[]): Script => ({ title: 'test', synopsis: '', shots });

describe('v10.6.2 · openingHookScore(开场 3 秒钩子分)', () => {
  it('强开场(危机词 + 疑问对白)拿高分,平淡开场拿低分', () => {
    const strong = openingHookScore([
      mkShot(1, {
        sceneDescription: '废楼天台,倒计时弹窗在手机上跳动',
        action: '主角被追杀,猛地翻过围栏',
        dialogue: '谁在发这条消息?!',
        emotion: '恐惧',
      }),
      mkShot(2),
    ]);
    const bland = openingHookScore([
      mkShot(1, { sceneDescription: '清晨的厨房', action: '倒了一杯咖啡' }),
      mkShot(2),
    ]);
    expect(strong.score).toBeGreaterThanOrEqual(7);
    expect(bland.score).toBeLessThanOrEqual(3);
    expect(strong.reasons.length).toBeGreaterThan(0);
  });

  it(`窗口按累计时长截到 ${OPENING_WINDOW_S}s:首镜 2s 时第 2 镜也计入`, () => {
    const inWindow = openingHookScore([
      mkShot(1, { duration: 2, sceneDescription: '空走廊' }),
      mkShot(2, { duration: 5, sceneDescription: '警报骤响,神秘人影消失在门后' }),
    ]);
    const outWindow = openingHookScore([
      mkShot(1, { duration: 5, sceneDescription: '空走廊' }),
      mkShot(2, { duration: 5, sceneDescription: '警报骤响,神秘人影消失在门后' }),
    ]);
    expect(inWindow.score).toBeGreaterThan(outWindow.score);
  });

  it('空镜头数组 → 0 分', () => {
    expect(openingHookScore([]).score).toBe(0);
  });
});

describe('v10.6.2 · cliffhangerScore(集尾悬念分)', () => {
  it('悬念收尾(突现 + 疑问 + 高冲突)拿高分,完美收尾拿低分', () => {
    const cliff = cliffhangerScore([
      mkShot(1),
      mkShot(2, {
        sceneDescription: '门突然被推开,一个本该死去的人出现在逆光里',
        action: '主角猛地回头,震惊到失声',
        dialogue: '你……你不是已经……?',
        emotion: '震惊',
        storyBeat: '悬念收尾',
      }),
    ]);
    const flat = cliffhangerScore([
      mkShot(1),
      mkShot(2, { sceneDescription: '夕阳下大家挥手告别', action: '镜头缓缓拉远' }),
    ]);
    expect(cliff.score).toBeGreaterThanOrEqual(7);
    expect(flat.score).toBeLessThanOrEqual(3);
  });

  it('疑问收尾只认对白结尾:场景描述里的疑问修辞不给 +2(假阳性回归)', () => {
    const r = cliffhangerScore([
      mkShot(1, { sceneDescription: '谁做的?无人知晓', dialogue: '再见吧' }),
    ]);
    expect(r.reasons.some((x) => x.includes('疑问收尾'))).toBe(false);
    const r2 = cliffhangerScore([mkShot(1, { dialogue: '你到底是谁?' })]);
    expect(r2.reasons.some((x) => x.includes('疑问收尾'))).toBe(true);
  });

  it('只看末镜:前面镜头再炸裂也不影响集尾分', () => {
    const r = cliffhangerScore([
      mkShot(1, { action: '爆炸!追杀!反转!', dialogue: '怎么会?!' }),
      mkShot(2, { sceneDescription: '平静的湖面' }),
    ]);
    expect(r.score).toBeLessThanOrEqual(3);
  });
});

describe('v10.6.2 · beatAlignmentRate(BGM 卡点对齐率)', () => {
  it('±150ms 窗口逐切点判定:[5,10,15] 切点对 [5.05, 10.2, 14.9] 拍点 = 2/3', () => {
    const r = beatAlignmentRate([5, 5, 5], [5.05, 10.2, 14.9]);
    expect(r.available).toBe(true);
    expect(r.alignedCuts).toBe(2);
    expect(r.totalCuts).toBe(3);
    expect(r.rate).toBeCloseTo(2 / 3, 5);
  });

  it('全踩拍 = 100%;全脱拍 = 0%', () => {
    expect(beatAlignmentRate([2, 2], [2, 4]).rate).toBe(1);
    expect(beatAlignmentRate([2, 2], [2.5, 4.5]).rate).toBe(0);
  });

  it('无拍点 → available=false, rate=null(诚实不可测,不给假分)', () => {
    const r = beatAlignmentRate([5, 5], []);
    expect(r.available).toBe(false);
    expect(r.rate).toBeNull();
  });

  it('非法时长(0/负)按默认 5s 兜底,不抛', () => {
    const r = beatAlignmentRate([0, -3], [5, 10]);
    expect(r.available).toBe(true);
    expect(r.rate).toBe(1);
  });
});

describe('v10.6.2 · auditHooks 组装 + LLM assist 降级', () => {
  const script = mkScript([
    mkShot(1, { sceneDescription: '危机倒计时', dialogue: '来得及吗?' }),
    mkShot(2, { sceneDescription: '神秘人突然出现', dialogue: '游戏才刚开始?' }),
  ]);

  it('三指标齐全;无 bgmBeats 时卡点标不可测', () => {
    const r = auditHooks(script);
    expect(r.openingHook.score).toBeGreaterThanOrEqual(0);
    expect(r.cliffhanger.score).toBeGreaterThanOrEqual(0);
    expect(r.bgmSync.available).toBe(false);
    expect(r.llmAssisted).toBe(false);
  });

  it('传入 bgmBeats 时卡点可测', () => {
    const r = auditHooks(script, { bgmBeats: [5, 10] });
    expect(r.bgmSync.available).toBe(true);
    expect(r.bgmSync.rate).toBe(1);
  });

  it('MOCK_ENGINES=1 时 LLM assist 原样返回规则结果(零外部调用)', async () => {
    const prev = process.env.MOCK_ENGINES;
    process.env.MOCK_ENGINES = '1';
    try {
      const rule = auditHooks(script);
      const assisted = await assistHookAuditWithLLM(script, rule);
      expect(assisted).toBe(rule);
      expect(assisted.llmAssisted).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MOCK_ENGINES;
      else process.env.MOCK_ENGINES = prev;
    }
  });
});

describe('v10.6.2 · 验收:20 个故事模板各跑出三指标', () => {
  // 模板没有现成 shots(LLM 展开),用模板自带文案确定性合成代表性脚本:
  // 首镜 = exampleIdea + 首个 keyElement,中段铺关键元素,末镜 = 结构提示收尾段。
  const probeScript = (t: (typeof storyTemplates)[number]): Script => {
    const n = Math.max(3, Math.min(t.shotCount.min, 6));
    const shots: ScriptShot[] = Array.from({ length: n }, (_, i) => {
      const el = t.keyElements[i % t.keyElements.length] || '';
      if (i === 0) {
        return mkShot(1, { sceneDescription: `${t.exampleIdea} ${el}`, dialogue: '这是怎么回事?' });
      }
      if (i === n - 1) {
        return mkShot(n, { sceneDescription: `${t.structureHint} ${el}`, emotion: t.emotionCurve });
      }
      return mkShot(i + 1, { sceneDescription: `${t.description} ${el}` });
    });
    return { title: t.name, synopsis: t.exampleIdea, shots };
  };

  it('每个模板:开场/集尾 0-10、卡点对齐率 0-1,三指标全有限值', () => {
    expect(storyTemplates.length).toBe(20); // v12.31.0(P3):+2 促销模板(产品宣传片 / 品牌预告)
    const rows: Array<Record<string, string | number>> = [];
    for (const t of storyTemplates) {
      const script = probeScript(t);
      // 合成 2s 拍点网格(常见 120BPM 小节)铺满全片,验证卡点链路对每模板可跑
      const total = script.shots.reduce((s, sh) => s + (sh.duration || 5), 0);
      const beats = Array.from({ length: Math.floor(total / 2) + 1 }, (_, i) => i * 2);
      const r = auditHooks(script, { bgmBeats: beats });

      expect(Number.isFinite(r.openingHook.score)).toBe(true);
      expect(r.openingHook.score).toBeGreaterThanOrEqual(0);
      expect(r.openingHook.score).toBeLessThanOrEqual(10);
      expect(Number.isFinite(r.cliffhanger.score)).toBe(true);
      expect(r.cliffhanger.score).toBeGreaterThanOrEqual(0);
      expect(r.cliffhanger.score).toBeLessThanOrEqual(10);
      expect(r.bgmSync.available).toBe(true);
      expect(r.bgmSync.rate).toBeGreaterThanOrEqual(0);
      expect(r.bgmSync.rate).toBeLessThanOrEqual(1);

      rows.push({
        模板: t.name,
        开场钩子: `${r.openingHook.score}/10`,
        集尾悬念: `${r.cliffhanger.score}/10`,
        卡点对齐: `${Math.round((r.bgmSync.rate ?? 0) * 100)}%`,
      });
    }
    // 验收留痕:18 模板三指标一览
    console.table(rows);
  });
});
