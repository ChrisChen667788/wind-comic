/**
 * v2.21 P1.1 — Pacing audit unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  scoreShotConflict,
  detectEmotionPolarity,
  detectReversals,
  auditScript,
} from '@/lib/pacing-audit';
import type { Script, ScriptShot } from '@/types/agents';

const mkShot = (n: number, partial: Partial<ScriptShot> = {}): ScriptShot => ({
  shotNumber: n,
  sceneDescription: '',
  action: '',
  emotion: '',
  characters: [],
  ...partial,
});

const mkScript = (shots: ScriptShot[]): Script => ({
  title: 'test',
  synopsis: '',
  shots,
});

describe('v2.21 P1.1 · detectEmotionPolarity', () => {
  it.each([
    ['他笑了, 心里很温暖', 1],
    ['她崩溃大哭, 绝望地跪下', -1],
    ['他冷静地看着窗外', 0],
    ['', 0],
    ['欢声笑语满堂', 1],
    ['愤怒和恐惧交织', -1],
  ])('"%s" → polarity %s', (text, expected) => {
    expect(detectEmotionPolarity(text)).toBe(expected);
  });

  it('混合极性按多数走', () => {
    // 欢+喜+乐 (3 positive) vs 怕 (1 negative) → positive 多数
    expect(detectEmotionPolarity('一片欢笑中, 喜悦溢出, 满堂同乐, 唯有一人怕被认出')).toBe(1);
  });
});

describe('v2.21 P1.1 · scoreShotConflict', () => {
  it('empty shot scores 0-1', () => {
    const s = mkShot(1);
    expect(scoreShotConflict(s)).toBeLessThanOrEqual(1);
  });

  it('shot with strong conflict + dialogue scores high', () => {
    const s = mkShot(1, {
      action: '主角猛地起身, 当众撕破假面, 怒斥反派',
      dialogue: '你这个骗子!',
      emotion: '愤怒',
      emotionTemperature: 9,
    });
    const score = scoreShotConflict(s);
    expect(score).toBeGreaterThanOrEqual(7);
  });

  it('shot with only neutral description scores low', () => {
    const s = mkShot(1, {
      action: '主角站在窗前看风景',
      sceneDescription: '阳光明媚的早晨',
    });
    expect(scoreShotConflict(s)).toBeLessThan(4);
  });

  it('caps at 10', () => {
    const s = mkShot(1, {
      action: '撕打砸推拽掐抓甩扇踹咬刺斩冲闯夺抢逃追杀救',
      dialogue: '怒斥反驳反击对峙摊牌',
      emotion: '崩溃震怒失控',
      emotionTemperature: 10,
    });
    expect(scoreShotConflict(s)).toBe(10);
  });
});

describe('v2.21 P1.1 · detectReversals', () => {
  it('positive → negative is a reversal', () => {
    const shots = [
      mkShot(1, { action: '主角终于成功了, 开心地拥抱朋友' }),
      mkShot(2, { action: '突然电话响起, 噩耗传来, 主角崩溃跪倒' }),
    ];
    const reversals = detectReversals(shots);
    expect(reversals.length).toBe(1);
    expect(reversals[0]).toEqual({ fromShot: 1, toShot: 2 });
  });

  it('same polarity = no reversal', () => {
    const shots = [
      mkShot(1, { action: '主角难过' }),
      mkShot(2, { action: '主角更难过' }),
    ];
    expect(detectReversals(shots).length).toBe(0);
  });

  it('neutral shots dont break reversal chain', () => {
    const shots = [
      mkShot(1, { action: '主角失望地走出' }),  // -1
      mkShot(2, { action: '主角看着远方' }),    // 0 — should be skipped
      mkShot(3, { action: '突然朋友出现, 主角喜出望外' }),  // +1
    ];
    expect(detectReversals(shots).length).toBe(1);
  });

  it('multiple reversals counted', () => {
    const shots = [
      mkShot(1, { action: '主角胜利, 欢呼' }),
      mkShot(2, { action: '反派出现, 主角恐惧' }),
      mkShot(3, { action: '主角反败为胜, 欢笑' }),
      mkShot(4, { action: '出乎意料的背叛, 主角绝望' }),
    ];
    expect(detectReversals(shots).length).toBe(3);
  });
});

describe('v2.21 P1.1 · auditScript', () => {
  it('passed=true for healthy drama script', () => {
    const script = mkScript([
      mkShot(1, {
        action: '主角被当众羞辱, 撕破衣领, 怒斥反派',
        dialogue: '你以为我会忍?',
        emotion: '愤怒',
        emotionTemperature: 8,
      }),
      mkShot(2, {
        action: '主角拿出关键证据, 反派震惊',
        dialogue: '原来是这样!',
        emotion: '震惊',
      }),
      mkShot(3, {
        action: '反派狼狈下跪, 围观者欢呼',
        dialogue: '我错了!',
        emotion: '崩溃',
      }),
      mkShot(4, {
        action: '主角冷笑离开, 留下一句话',
        dialogue: '这才刚开始',
        emotion: '冷静',
      }),
      mkShot(5, {
        action: '回家路上, 主角终于松一口气, 露出微笑',
        dialogue: '总算...',
        emotion: '解脱',
      }),
      mkShot(6, {
        action: '门口出现神秘人, 主角面色骤变, 拨电话',
        dialogue: '你过来? 谁来了?',
        emotion: '紧张',
      }),
    ]);
    const r = auditScript(script, { dramaMode: true });
    expect(r.reversalCount).toBeGreaterThanOrEqual(2);
    expect(r.passed).toBe(true);
    // 不强求 0 warnings — passed=true 表示总体节奏过关, 但单镜可能仍标弱
  });

  it('flags weak first shot in drama mode', () => {
    const script = mkScript([
      mkShot(1, { action: '主角散步在街上, 看着天空' }), // 弱
      mkShot(2, { action: '突然被人撞倒, 怒火涌上' }),
      mkShot(3, { action: '原来是熟人, 主角欢笑' }),
    ]);
    const r = auditScript(script, { dramaMode: true });
    expect(r.passed).toBe(false);
    expect(r.warnings.some((w) => w.includes('第 1 镜'))).toBe(true);
  });

  it('flags missing cliffhanger in drama mode', () => {
    const script = mkScript([
      mkShot(1, { action: '主角撕破阴谋, 怒斥', emotion: '愤怒' }),
      mkShot(2, { action: '反派认输, 主角欢笑', emotion: '欢喜' }),
      mkShot(3, { action: '主角微笑地看着远方, 一切都好了' }), // 平淡收尾
    ]);
    const r = auditScript(script, { dramaMode: true });
    expect(r.warnings.some((w) => w.includes('cliffhanger'))).toBe(true);
  });

  it('flags insufficient reversals', () => {
    const script = mkScript([
      mkShot(1, { action: '主角难过', emotion: '悲伤' }),
      mkShot(2, { action: '更难过', emotion: '悲伤' }),
      mkShot(3, { action: '继续难过', emotion: '悲伤' }),
    ]);
    const r = auditScript(script, { dramaMode: true });
    expect(r.reversalCount).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('normal mode is more lenient', () => {
    const script = mkScript([
      mkShot(1, { action: '主角看风景, 心情平静' }),
      mkShot(2, { action: '朋友来电, 主角微笑', emotion: '温暖' }),
      mkShot(3, { action: '突然遇到难题, 焦虑起来', emotion: '焦虑' }),
    ]);
    const normalReport = auditScript(script, { dramaMode: false });
    const dramaReport = auditScript(script, { dramaMode: true });
    // 同一脚本, drama mode 更严格
    expect(dramaReport.warnings.length).toBeGreaterThanOrEqual(normalReport.warnings.length);
  });

  it('empty shots array does not crash', () => {
    const r = auditScript(mkScript([]));
    expect(r.shots).toEqual([]);
    expect(r.reversalCount).toBe(0);
    expect(r.averageConflictScore).toBe(0);
  });

  it('reversalDensity = shots/reversals (Infinity when 0 reversals)', () => {
    const r1 = auditScript(mkScript([mkShot(1), mkShot(2)]));
    expect(r1.reversalDensity).toBe(Infinity);

    const r2 = auditScript(
      mkScript([
        mkShot(1, { action: '欢笑' }),
        mkShot(2, { action: '崩溃' }),
        mkShot(3, { action: '欢笑' }),
      ]),
    );
    expect(r2.reversalCount).toBe(2);
    expect(r2.reversalDensity).toBeCloseTo(1.5);
  });

  it('emits suggestions on warning', () => {
    const script = mkScript([
      mkShot(1, { action: '主角看天空' }),
      mkShot(2, { action: '主角喝茶' }),
    ]);
    const r = auditScript(script, { dramaMode: true });
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});
