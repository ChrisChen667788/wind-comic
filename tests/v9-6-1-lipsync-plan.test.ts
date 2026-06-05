/**
 * v9.6.1 — lib/lipsync-plan 单测(阶段十六 T1 配音口型:viseme 轨 + 可对齐度评分 + 整片就绪度)。
 */
import { describe, it, expect } from 'vitest';
import {
  estimateSpeechSeconds, planVisemes, scoreLineAlignment, buildLipSyncPlan,
  dialogueLinesFromShots, VISEME_OPENNESS, type DialogueLine,
} from '@/lib/lipsync-plan';
import type { ScriptShot } from '@/types/agents';

const line = (over: Partial<DialogueLine>): DialogueLine => ({ shotNumber: 1, text: '你好', ...over });

describe('v9.6.1 · estimateSpeechSeconds', () => {
  it('空 → 0;CJK 约 0.25s/字;语速整除', () => {
    expect(estimateSpeechSeconds('')).toBe(0);
    expect(estimateSpeechSeconds('你好')).toBe(0.5);       // 2×0.25
    expect(estimateSpeechSeconds('你好', 2)).toBe(0.25);   // ÷ 语速
  });
  it('标点加停顿;拉丁按词计;最低 0.2s', () => {
    expect(estimateSpeechSeconds('你好。')).toBeCloseTo(0.68, 2); // +0.18 标点
    expect(estimateSpeechSeconds('Hello world')).toBeCloseTo(0.64, 2); // 2 词×0.32
    expect(estimateSpeechSeconds('x', 100)).toBe(0.2); // 地板
  });
});

describe('v9.6.1 · planVisemes', () => {
  it('拉丁 map → 确定 viseme 序列 MBP/aa/MBP + 句尾 sil', () => {
    const fr = planVisemes(line({ text: 'map', startSec: 0, endSec: 0.3 }));
    expect(fr.map((f) => f.viseme)).toEqual(['MBP', 'aa', 'MBP', 'sil']);
    expect(fr[0].t).toBe(0);
    expect(fr[fr.length - 1].viseme).toBe('sil');
    expect(fr[fr.length - 1].mouthOpen).toBe(0);
  });
  it('每帧张口量 ∈ [0,1] 且与 viseme 表一致;时间递增', () => {
    const fr = planVisemes(line({ text: '你好啊，朋友', startSec: 0, endSec: 2 }));
    expect(fr.length).toBeGreaterThan(2);
    for (const f of fr) {
      expect(f.mouthOpen).toBe(VISEME_OPENNESS[f.viseme]);
      expect(f.mouthOpen).toBeGreaterThanOrEqual(0);
      expect(f.mouthOpen).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < fr.length; i++) expect(fr[i].t).toBeGreaterThanOrEqual(fr[i - 1].t);
  });
  it('纯空白(无发音单元)→ 单帧 sil', () => {
    expect(planVisemes(line({ text: '   ' }))).toEqual([{ t: 0, viseme: 'sil', mouthOpen: 0 }]);
  });
  it('纯标点 → 全 sil 闭口保持(停顿)', () => {
    const fr = planVisemes(line({ text: '。。。' }));
    expect(fr.every((f) => f.viseme === 'sil' && f.mouthOpen === 0)).toBe(true);
    expect(fr.length).toBeGreaterThan(1);
  });
});

describe('v9.6.1 · scoreLineAlignment', () => {
  it('说话人在画面 + 近景 + 时长合身 → 100 可对齐', () => {
    const a = scoreLineAlignment(line({ speaker: 'A', onScreen: ['A', 'B'], shotSize: 'medium close-up 近景', startSec: 0, endSec: 3 }));
    expect(a.score).toBe(100);
    expect(a.alignable).toBe(true);
  });
  it('画外音(说话人不在画面)→ -50', () => {
    const a = scoreLineAlignment(line({ shotNumber: 3, speaker: 'B', text: '喂', onScreen: ['A'], startSec: 0, endSec: 3 }));
    expect(a.speakerOnScreen).toBe(false);
    expect(a.score).toBe(50);
    expect(a.alignable).toBe(false);
    expect(a.issues.join()).toMatch(/画外音|不在画面/);
  });
  it('纯远景 → 脸太小 -30', () => {
    const a = scoreLineAlignment(line({ speaker: 'A', text: '你好啊', onScreen: ['A'], shotSize: 'wide shot 远景', startSec: 0, endSec: 3 }));
    expect(a.faceVisible).toBe(false);
    expect(a.score).toBe(70);
  });
  it('台词时长溢出镜头窗 → -20', () => {
    const a = scoreLineAlignment(line({ speaker: 'A', text: '这是一句非常长的台词需要说很久很久', onScreen: ['A'], startSec: 0, endSec: 1 }));
    expect(a.durationFits).toBe(false);
    expect(a.score).toBe(80);
  });
  it('无 onScreen / 无 shotSize → 不罚(默认在画面 + 脸可见)', () => {
    const a = scoreLineAlignment(line({ speaker: 'A', text: '你好' }));
    expect(a.speakerOnScreen).toBe(true);
    expect(a.faceVisible).toBe(true);
    expect(a.score).toBe(100);
  });
});

describe('v9.6.1 · buildLipSyncPlan', () => {
  it('空 → lines 0 / readiness 0 / none / 无对白提示', () => {
    const p = buildLipSyncPlan([]);
    expect(p.lines).toBe(0);
    expect(p.readiness).toBe(0);
    expect(p.level).toBe('none');
    expect(p.weakest).toBeNull();
    expect(p.hints[0]).toMatch(/无对白|不适用/);
  });
  it('完美句 + 画外音句 → readiness 75 / warn / 最弱是画外音', () => {
    const p = buildLipSyncPlan([
      line({ shotNumber: 1, speaker: 'A', text: '你好', onScreen: ['A'], shotSize: '近景', startSec: 0, endSec: 3 }),
      line({ shotNumber: 2, speaker: 'B', text: '在吗', onScreen: ['A'], startSec: 3, endSec: 6 }),
    ]);
    expect(p.readiness).toBe(75); // (100+50)/2
    expect(p.level).toBe('warn');
    expect(p.weakest?.shotNumber).toBe(2);
    expect(p.hints.join()).toMatch(/画外音/);
  });
  it('全部达标 → readiness 100 / pass + 就绪提示', () => {
    const p = buildLipSyncPlan([
      line({ shotNumber: 1, speaker: 'A', text: '你好', onScreen: ['A'], shotSize: '近景', startSec: 0, endSec: 3 }),
    ]);
    expect(p.readiness).toBe(100);
    expect(p.level).toBe('pass');
    expect(p.hints[0]).toMatch(/就绪|可驱动/);
  });
});

describe('v9.6.1 · dialogueLinesFromShots', () => {
  it('只收有对白镜 + 时间窗顺序累加(含跳过镜)', () => {
    const shots = [
      { shotNumber: 1, duration: 2, dialogue: '走吧', characters: ['X'], shotSize: '近景' },
      { shotNumber: 2, duration: 3, dialogue: '', characters: [] },
      { shotNumber: 3, duration: 2, dialogue: '等等', characters: ['Y', 'Z'] },
    ] as ScriptShot[];
    const lines = dialogueLinesFromShots(shots);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ shotNumber: 1, speaker: 'X', startSec: 0, endSec: 2 });
    expect(lines[1]).toMatchObject({ shotNumber: 3, speaker: 'Y', startSec: 5, endSec: 7 }); // 累加跳过的 3s
    expect(lines[1].onScreen).toEqual(['Y', 'Z']);
  });
  it('容错空输入', () => {
    expect(dialogueLinesFromShots([] as ScriptShot[])).toEqual([]);
    expect(dialogueLinesFromShots(undefined as unknown as ScriptShot[])).toEqual([]);
  });
});
