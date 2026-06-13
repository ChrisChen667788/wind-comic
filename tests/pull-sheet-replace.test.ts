/**
 * v11.1.2 — 拉片复刻替换引擎单测(纯函数,零 IO)。
 *
 * 验收核心:确定性「全员换猫」级全局替换 + 逐维度(角色/场景/道具)替换 +
 * prompt 拼装 + 复刻脚本回填 v2.8 字段 + 参考图归集。
 */
import { describe, expect, it } from 'vitest';
import {
  applyReplacements, buildReplicaPrompt, buildReplicaScript, collectRefImages, type ReplaceRule,
} from '@/lib/pull-sheet-replace';
import type { PullSheet, PullSheetShot } from '@/lib/pull-sheet';

const mkShot = (n: number, p: Partial<PullSheetShot> = {}): PullSheetShot => ({
  shotNumber: n, thumbnail: null, videoUrl: null, description: '', scene: '', characters: [], dialogue: '',
  durationSec: 5, startSec: 0, endSec: 5,
  shotSize: '', composition: '', cameraAngle: '', cameraMovement: '', lens: '',
  lightingIntent: '', editPattern: '', scoreMood: '', soundDesign: '', diegeticSound: '',
  storyBeat: '', whyThisChoice: '', source: 'factory',
  ...p,
});

const mkSheet = (shots: PullSheetShot[]): PullSheet => ({
  title: '原片', shotCount: shots.length, totalDurationSec: shots.reduce((a, s) => a + s.durationSec, 0),
  source: 'factory', shots,
});

describe('v11.1.2 · applyReplacements(全局替换 — 全员换猫)', () => {
  it('global 规则替换所有文本字段 + 角色名', () => {
    const sheet = mkSheet([
      mkShot(1, { description: '老板砸了员工的电脑', characters: ['老板', '员工'], dialogue: '老板:你被开除了', scene: '办公室' }),
    ]);
    const rules: ReplaceRule[] = [
      { kind: 'global', from: '老板', to: '橘猫' },
      { kind: 'global', from: '员工', to: '奶牛猫' },
    ];
    const [s] = applyReplacements(sheet, rules);
    expect(s.description).toBe('橘猫砸了奶牛猫的电脑');
    expect(s.characters).toEqual(['橘猫', '奶牛猫']);
    expect(s.dialogue).toBe('橘猫:你被开除了');
    expect(s.scene).toBe('办公室');           // 未命中,不动
    expect(s.durationSec).toBe(5);            // 时长锁定(复刻照原片节奏)
  });
});

describe('v11.1.2 · applyReplacements(逐维度)', () => {
  it('character:from 指定换名;from 空 = 整列每个角色都换', () => {
    const sheet = mkSheet([mkShot(1, { characters: ['程一帆', '苏雨眠'] })]);
    expect(applyReplacements(sheet, [{ kind: 'character', from: '程一帆', to: '李雷' }])[0].characters).toEqual(['李雷', '苏雨眠']);
    expect(applyReplacements(sheet, [{ kind: 'character', to: '神秘人' }])[0].characters).toEqual(['神秘人']); // 去重
  });

  it('scene:from 空 = 全片统一换场景', () => {
    const sheet = mkSheet([mkShot(1, { scene: '雨巷' }), mkShot(2, { scene: '天台' })]);
    const r = applyReplacements(sheet, [{ kind: 'scene', to: '太空站' }]);
    expect(r.map((s) => s.scene)).toEqual(['太空站', '太空站']);
  });

  it('prop:文本替换(道具词)', () => {
    const sheet = mkSheet([mkShot(1, { description: '桌上一张旧照片' })]);
    expect(applyReplacements(sheet, [{ kind: 'prop', from: '旧照片', to: '全息投影' }])[0].description).toBe('桌上一张全息投影');
  });

  it('空规则 → 原样透传', () => {
    const sheet = mkSheet([mkShot(1, { description: 'x', characters: ['a'] })]);
    const [s] = applyReplacements(sheet, []);
    expect(s.description).toBe('x');
    expect(s.characters).toEqual(['a']);
  });
});

describe('v11.1.2 · 审查回归:字段一致性 + dedup', () => {
  it('empty-from character:文本字段同步替换旧角色名(不留矛盾)', () => {
    const sheet = mkSheet([mkShot(1, { characters: ['程一帆'], description: '程一帆拿起电话', dialogue: '程一帆:喂' })]);
    const [s] = applyReplacements(sheet, [{ kind: 'character', to: '橘猫' }]);
    expect(s.characters).toEqual(['橘猫']);
    expect(s.description).toBe('橘猫拿起电话');   // 文本同步,不再矛盾
    expect(s.dialogue).toBe('橘猫:喂');
  });

  it('empty-from character 多角色:characters 去重(不出现 [橘猫,橘猫])', () => {
    const sheet = mkSheet([mkShot(1, { characters: ['程一帆', '苏雨眠'] })]);
    expect(applyReplacements(sheet, [{ kind: 'character', to: '橘猫' }])[0].characters).toEqual(['橘猫']);
  });

  it('char + global 同指向同名:characters 数组与文本字段一致(无 desync)', () => {
    const sheet = mkSheet([mkShot(1, { characters: ['程一帆'], description: '程一帆走进场景' })]);
    const [s] = applyReplacements(sheet, [
      { kind: 'global', from: '程一帆', to: '李雷' },
      { kind: 'character', from: '程一帆', to: '橘猫' },
    ]);
    // 统一规则集 + 长词优先 → 数组与文本同结果(不再一个橘猫一个李雷)
    expect(s.characters).toEqual(s.description.includes('橘猫') ? ['橘猫'] : ['李雷']);
    const who = s.characters[0];
    expect(s.description).toBe(`${who}走进场景`);
  });

  it('长词优先:from=老板娘 先于 from=老板(子串误伤缓解)', () => {
    const sheet = mkSheet([mkShot(1, { description: '老板娘和老板' })]);
    const [s] = applyReplacements(sheet, [
      { kind: 'global', from: '老板', to: '橘猫' },
      { kind: 'global', from: '老板娘', to: '奶牛猫' },
    ]);
    expect(s.description).toBe('奶牛猫和橘猫');   // 老板娘整体先换,不被拆成"橘猫娘"
  });

  it('scene from-specified + empty-from:scene 与 description 一致', () => {
    const sheet = mkSheet([mkShot(1, { scene: '雨巷', description: '走在雨巷里' })]);
    const [s] = applyReplacements(sheet, [{ kind: 'scene', from: '雨巷', to: '水下' }, { kind: 'scene', to: '太空站' }]);
    expect(s.scene).toBe(s.description.includes('水下') ? '水下' : '太空站');
    expect(s.description).toContain(s.scene);   // 两字段一致
  });
});

describe('v11.1.2 · 参考图归集', () => {
  it('命中规则的参考图按镜归集 + 全片去重', () => {
    const sheet = mkSheet([
      mkShot(1, { characters: ['老板'] }),
      mkShot(2, { characters: ['员工'] }),
    ]);
    const rules: ReplaceRule[] = [
      { kind: 'character', from: '老板', to: '橘猫', refImage: '/cat-a.png' },
      { kind: 'character', from: '员工', to: '橘猫', refImage: '/cat-a.png' }, // 同图
      { kind: 'character', from: '员工', to: '奶牛猫', refImage: '/cat-b.png' },
    ];
    const shots = applyReplacements(sheet, rules);
    expect(shots[0].refImages).toEqual(['/cat-a.png']);          // 镜1 只命中老板
    expect(collectRefImages(shots).sort()).toEqual(['/cat-a.png', '/cat-b.png']);
  });
});

describe('v11.1.2 · buildReplicaPrompt / buildReplicaScript', () => {
  it('prompt 拼装含镜头语言;空字段不进 prompt', () => {
    const p = buildReplicaPrompt({
      description: '猫咪砸电脑', characters: ['橘猫'], scene: '办公室',
      shotSize: '全景', composition: '居中', cameraMovement: '推近', lens: '24mm', lightingIntent: '冷光',
    });
    expect(p).toContain('猫咪砸电脑');
    expect(p).toContain('角色:橘猫');
    expect(p).toContain('镜头:全景,居中,推近,24mm');
    expect(p).toContain('光影:冷光');
  });

  it('buildReplicaScript 回填 ScriptShot v2.8 字段 + 锁时长;editedPrompts 覆盖 visualPrompt', () => {
    const sheet = mkSheet([mkShot(1, { description: '猫砸电脑', shotSize: '全景', cameraMovement: '推近', durationSec: 3.5, characters: ['橘猫'] })]);
    const shots = applyReplacements(sheet, []);
    const script = buildReplicaScript('换猫版', shots, { editedPrompts: { 1: '手改的 prompt' } });
    expect(script.title).toBe('换猫版');
    expect(script.shots[0].duration).toBe(3.5);
    expect(script.shots[0].shotSize).toBe('全景');
    expect(script.shots[0].cameraWork).toBe('推近');
    expect(script.shots[0].characters).toEqual(['橘猫']);
    expect(script.shots[0].visualPrompt).toBe('手改的 prompt'); // 编辑覆盖
  });
});
