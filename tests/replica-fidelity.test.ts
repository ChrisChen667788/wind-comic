/**
 * v11.1.3 — 复刻保真度对照单测(纯函数,复用 pacing/hook 审计)。
 *
 * 验收:同结构同主体 → 高保真;替换抹掉冲突/悬念词 → 保真度下降并给出诊断 notes。
 */
import { describe, expect, it } from 'vitest';
import { compareReplicaFidelity } from '@/lib/replica-fidelity';
import type { PullSheet, PullSheetShot } from '@/lib/pull-sheet';

const mkShot = (n: number, p: Partial<PullSheetShot> = {}): PullSheetShot => ({
  shotNumber: n, thumbnail: null, videoUrl: null, description: '', scene: '', characters: [], dialogue: '',
  durationSec: 5, startSec: (n - 1) * 5, endSec: n * 5,
  shotSize: '', composition: '', cameraAngle: '', cameraMovement: '', lens: '',
  lightingIntent: '', editPattern: '', scoreMood: '', soundDesign: '', diegeticSound: '',
  storyBeat: '', whyThisChoice: '', source: 'factory',
  ...p,
});
const mkSheet = (shots: PullSheetShot[]): PullSheet => ({
  title: '原片', shotCount: shots.length, totalDurationSec: shots.length * 5, source: 'factory', shots,
});

// 复刻脚本形(buildReplicaScript 产出的 ScriptShot)
const mkReplicaShot = (n: number, p: any = {}) => ({
  shotNumber: n, sceneDescription: '', action: '', emotion: '', characters: [], dialogue: '', duration: 5, ...p,
});

describe('v11.1.3 · compareReplicaFidelity', () => {
  it('同结构、主体仅换名(冲突词保留)→ 高保真;指标几乎不变', () => {
    const original = mkSheet([
      mkShot(1, { description: '老板砸了员工的电脑,怒吼', dialogue: '你被开除了!', characters: ['老板'] }),
      mkShot(2, { description: '员工突然反击,场面失控', dialogue: '凭什么?!', characters: ['员工'] }),
    ]);
    const replica = {
      title: '换猫版',
      shots: [
        mkReplicaShot(1, { action: '橘猫砸了奶牛猫的电脑,怒吼', dialogue: '你被开除了!', characters: ['橘猫'] }),
        mkReplicaShot(2, { action: '奶牛猫突然反击,场面失控', dialogue: '凭什么?!', characters: ['奶牛猫'] }),
      ],
    };
    const r = compareReplicaFidelity(original, replica);
    expect(r.fidelity.overall).toBeGreaterThanOrEqual(85);
    expect(r.original.averageConflictScore).toBe(r.replica.averageConflictScore); // 冲突词保留 → 同分
    expect(r.notes.some((n) => n.includes('保真度高'))).toBe(true);
  });

  it('替换抹掉冲突/悬念词 → 保真度下降 + 诊断 notes', () => {
    const original = mkSheet([
      mkShot(1, { description: '追杀!爆炸!主角坠落', dialogue: '危机降临!', characters: ['主角'] }),
      mkShot(2, { description: '神秘人突然出现,留下悬念', dialogue: '你以为结束了?', characters: ['反派'] }),
    ]);
    // 复刻把强冲突全换成平淡词
    const replica = {
      title: '平淡版',
      shots: [
        mkReplicaShot(1, { action: '主角喝了一杯咖啡', dialogue: '今天天气不错', characters: ['主角'] }),
        mkReplicaShot(2, { action: '大家挥手告别', dialogue: '再见', characters: ['反派'] }),
      ],
    };
    const r = compareReplicaFidelity(original, replica);
    expect(r.replica.openingHook).toBeLessThan(r.original.openingHook);
    expect(r.fidelity.overall).toBeLessThan(85);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('指标范围合法;接受 PullSheet 与脚本两种入参形', () => {
    const sheet = mkSheet([mkShot(1, { description: 'x' })]);
    const r = compareReplicaFidelity(sheet, { shots: [mkReplicaShot(1, { action: 'x' })] });
    for (const v of [r.fidelity.overall, r.fidelity.pacing, r.fidelity.hook]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.original.openingHook).toBeGreaterThanOrEqual(0);
  });
});
