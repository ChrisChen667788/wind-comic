/**
 * v12.324 — 同一套镜头语言被要了两遍,只有一份算数。
 *
 * ── 病象 ──────────────────────────────────────────────────────────
 * Director 被要求为每镜产出 10 维 `shotSpec`(下划线命名),`director-enhance`
 * 还专门为它写了校验;编排器注释自己承认「Director 是 known-heavy call…8 个
 * shotSpec nested — 12-19K chars 输出」。
 * 而 **Writer 被要求自己发明同一套字段**(驼峰命名),且只有 Writer 那份会经
 * `renderVeoProsePrefix` 进 visualPrompt。
 *
 * 于是 Director 那份规格:**花了钱、过了校验、没人读**。
 *   · 非改编路径 —— 混在 `JSON.stringify(plan)` 里到过 Writer 眼前,但没有任何
 *     指令要它遵守,等于无标签噪声;
 *   · 改编路径 —— plan 被精简成只剩视觉风格,shotSpec **被整个丢掉**。
 *
 * ── 为什么是「接上」不是「删掉」 ──────────────────────────────────
 * 覆盖率与剪辑语法(shot-reverse-shot / 180 度线 / eyeline-match)是**跨镜决策**,
 * 只有通盘看过全片的 Director 能定;Writer 逐镜发明必然各自为政,那正是剪辑不
 * 连贯的来源。所以把它标注清楚地交给 Writer 当基线。
 *
 * ── 同批相反的一个判断:那处该删 ──────────────────────────────────
 * `lib/composition.ts` 的 `COMPOSITION_GUIDES` / `compileCompositionPrompt` 是
 * 4 取值的构图词表,只有测试引用。**接上它反而有害** —— Writer 的 `composition`
 * 字段(8 取值)早已进了 visualPrompt,两套并存就是本仓栽过五次的「同一语义两套
 * 口径」。故删除,并在原测试处设防。
 * 「造好没接线」不等于「一律接上」:先问它接上去和现有那套是不是同一件事。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { normalizeDirectorShotSpecs, buildDirectorShotSpecHint } from '@/lib/shot-spec-bridge';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WRITER = strip(fs.readFileSync('services/agents/writer-agent.ts', 'utf-8'));

const planWith = (shots: any[]) => ({ genre: 'x', shots });

describe('v12.324 · 命名归一(两套拼写是分裂的来源)', () => {
  it('下划线键翻成 Writer 自己要填的驼峰键', () => {
    const [s] = normalizeDirectorShotSpecs(planWith([{
      shotNumber: 1, shot_size: 'MS', camera_angle: 'low-angle', lens: '35mm',
      camera_movement: 'push-in', lighting_condition: 'low-key',
      composition: 'rule-of-thirds', edit_pattern: 'shot-reverse-shot',
    }]));
    expect(s.fields).toMatchObject({
      shotSize: 'MS', cameraAngle: 'low-angle', lens: '35mm',
      cameraMovement: 'push-in', lightingIntent: 'low-key',
      composition: 'rule-of-thirds', editPattern: 'shot-reverse-shot',
    });
  });

  it('规格挂在 shot.shotSpec 或 shot 自身都认(与 director-enhance 校验同口径)', () => {
    const a = normalizeDirectorShotSpecs(planWith([{ shotNumber: 1, shotSpec: { shot_size: 'CU' } }]));
    const b = normalizeDirectorShotSpecs(planWith([{ shotNumber: 1, shot_size: 'CU' }]));
    expect(a[0].fields.shotSize).toBe('CU');
    expect(b[0].fields.shotSize).toBe('CU');
  });

  it('**形状不对时返回空,不猜** —— 编一份假规格比没有更糟', () => {
    expect(normalizeDirectorShotSpecs(null)).toEqual([]);
    expect(normalizeDirectorShotSpecs({})).toEqual([]);
    expect(normalizeDirectorShotSpecs(planWith([{ shotNumber: 1 }])), '无可用字段应略过').toEqual([]);
    expect(normalizeDirectorShotSpecs(planWith(['garbage' as any]))).toEqual([]);
  });

  it('缺字段就略过,不填占位值', () => {
    const [s] = normalizeDirectorShotSpecs(planWith([{ shotNumber: 2, shot_size: 'LS', lens: '' }]));
    expect(s.fields).toEqual({ shotSize: 'LS' });
    expect(s.shotNumber).toBe(2);
  });

  it('没镜号时按顺序补,不丢镜', () => {
    const r = normalizeDirectorShotSpecs(planWith([{ shot_size: 'CU' }, { shot_size: 'MS' }]));
    expect(r.map((x) => x.shotNumber)).toEqual([1, 2]);
  });
});

describe('v12.324 · 给 Writer 的基线块', () => {
  const hint = buildDirectorShotSpecHint(planWith([
    { shotNumber: 1, shot_size: 'MS', edit_pattern: 'shot-reverse-shot' },
    { shotNumber: 2, shot_size: 'CU', camera_movement: 'push-in' },
  ]));

  it('有标签、写明这是基线而非枷锁', () => {
    expect(hint).toContain('导演的逐镜覆盖计划');
    expect(hint).toMatch(/基线/);
  });

  it('**点名 editPattern 是跨镜决策,别逐镜各自为政**(剪辑不连贯的真正来源)', () => {
    expect(hint).toContain('editPattern');
    expect(hint).toMatch(/跨镜决策/);
  });

  it('列出的键名就是 Writer 要填的那些(不制造第三套说法)', () => {
    expect(hint).toMatch(/shotSize/);
    expect(hint).toMatch(/cameraMovement/);
    expect(hint).not.toMatch(/shot_size|camera_movement/);
  });

  it('无规格时返回空串,不往上下文里塞空标题', () => {
    expect(buildDirectorShotSpecHint({})).toBe('');
    expect(buildDirectorShotSpecHint(planWith([{ shotNumber: 1 }]))).toBe('');
  });

  it('镜头很多时截断并**明说截断了多少**,不静默丢', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ shotNumber: i + 1, shot_size: 'MS' }));
    const h = buildDirectorShotSpecHint(planWith(many), 24);
    expect(h).toMatch(/其余 16 镜/);
  });
});

describe('v12.324 · 接线:两条 Writer 路径都要吃到', () => {
  it('非改编路径接上了', () => {
    expect(WRITER).toContain('buildDirectorShotSpecHint(plan)');
    const i = WRITER.indexOf('userContext = `导演计划：');
    expect(WRITER.slice(i, i + 220)).toContain('buildDirectorShotSpecHint(plan)');
  });

  it('**改编路径也接上了** —— 那条此前把 shotSpec 整个丢掉', () => {
    const i = WRITER.indexOf('═══ 附录：视觉风格参考');
    expect(i).toBeGreaterThan(0);
    expect(WRITER.slice(i, i + 320)).toContain('buildDirectorShotSpecHint(plan)');
  });

  it('两处都接了(漏一条就有一半项目享受不到)', () => {
    expect((WRITER.match(/buildDirectorShotSpecHint\(plan\)/g) || []).length).toBe(2);
  });
});

describe('v12.324 · 反向判断:平行构图词表已删,且设了防', () => {
  const raw = fs.readFileSync('lib/composition.ts', 'utf-8');
  const code = strip(raw);

  it('4 值死词表不在了', () => {
    expect(code).not.toMatch(/COMPOSITION_GUIDES|compileCompositionPrompt|getComposition/);
  });

  it('**UI 真在用的那两个仍在**(不能顺手把活的一起删了)', () => {
    expect(code).toContain('export function computeCompositionHints');
    expect(code).toContain('export function cameraPathPoints');
    expect(fs.existsSync('components/project/composition-guide.tsx')).toBe(true);
  });

  it('删除理由写在文件里(否则后人只会看到一段空白)', () => {
    expect(raw).toMatch(/两套构图词表并存|同一语义两套口径/);
  });
});
