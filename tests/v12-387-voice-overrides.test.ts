/**
 * v12.387:owner 手动调好的音色,一走重合成就被自动分配顶掉。
 *
 * 主路径 `shot-audio` 的优先级链是 **force > overrides > routing > default**
 * (`lib/voice-routing.effectiveVoice`,v9.7.7 起):
 * owner 在 Character Studio 把某个角色的嗓子指定好,存进 `voice-overrides` 资产。
 *
 * 而 recompose 的配音重生只读 `voice-cast`(自动分配),**完全不读 voice-overrides**。
 * 于是从重合成 / 本地化 / 广告工作台 任一入口触发配音重生,
 * 他设的音色都会被自动分配顶掉,而且没有任何提示 —— 又一次「主路径修了旁路没修」。
 *
 * 修法刻意选最小的那个:overrides 的优先级本来就在 cast 之上,直接盖进同一张表,
 * 语义完全一致,不必改 pickShotVoice 的签名。改的是内存里的 Map,
 * 不会把 overrides 写回持久化的 voice-cast(那会让「手动」和「自动」混成一团)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pickShotVoice, isKnownVoiceId } from '@/lib/shot-voice';

const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/recompose/route.ts'), 'utf-8');
const code = ROUTE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** 照 owner 库里的真实值构造 */
const AUTO = () => new Map<string, string>([['柳如烟', 'young_female_cn'], ['李长安', 'audiobook_male1_cn']]);
const applyOverrides = (cast: Map<string, string>, ov: Record<string, unknown>) => {
  for (const [n, v] of Object.entries(ov)) if (typeof v === 'string' && isKnownVoiceId(v)) cast.set(n.trim(), v);
  return cast;
};

describe('手动覆盖优先于自动分配', () => {
  it('覆盖生效:青年女声 → 成熟女声', () => {
    const cast = AUTO();
    expect(pickShotVoice({ characters: ['柳如烟'] }, cast)).toBe('young_female_cn');
    applyOverrides(cast, { 柳如烟: 'narrator_female_cn' });
    expect(pickShotVoice({ characters: ['柳如烟'] }, cast)).toBe('narrator_female_cn');
  });

  it('没被覆盖的角色不受影响', () => {
    const cast = applyOverrides(AUTO(), { 柳如烟: 'narrator_female_cn' });
    expect(pickShotVoice({ characters: ['李长安'] }, cast)).toBe('audiobook_male1_cn');
  });

  it('overrides 里的脏值不放行 —— 它也是持久化数据,可能躺着历史 female-zh', () => {
    const cast = applyOverrides(AUTO(), { 柳如烟: 'female-zh', 李长安: '', 某人: 123 as unknown as string });
    expect(cast.get('柳如烟'), '脏值不该覆盖掉可用的自动分配').toBe('young_female_cn');
    expect(isKnownVoiceId(pickShotVoice({ characters: ['柳如烟'] }, cast))).toBe(true);
  });

  it('覆盖不影响「谁在说」的判定 —— 多角色镜仍然不猜', () => {
    const cast = applyOverrides(AUTO(), { 柳如烟: 'narrator_female_cn' });
    const multi = pickShotVoice({ characters: ['柳如烟', '李长安'] }, cast);
    expect(multi).toBe(pickShotVoice({ speaker: '旁白' }, cast));
  });
});

describe('recompose 接线', () => {
  it('重生配音前读 voice-overrides', () => {
    const start = code.indexOf('resolveAndPersistCast(');
    const end = code.indexOf('for (const c of clips)', start);
    expect(start).toBeGreaterThan(0);
    expect(end, '窗口无效').toBeGreaterThan(start);
    const win = code.slice(start, end);
    expect(win).toContain('voice-overrides');
    expect(win, 'overrides 的脏值同样要过目录校验').toContain('isKnownVoiceId');
  });

  it('overrides 盖在 cast 之上,而不是反过来', () => {
    const i = code.indexOf("'voice-overrides'");
    const win = code.slice(i, i + 800);
    expect(win, '要写进 cast 表才能被 pickShotVoice 看到').toMatch(/cast\.set\(/);
  });

  it('读覆盖失败不阻断重生 —— 它是增强项', () => {
    const i = code.indexOf("'voice-overrides'");
    const win = code.slice(Math.max(0, i - 200), i + 900);
    expect(win).toContain('catch');
  });

  it('与主路径 shot-audio 的优先级一致', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/shot-audio/route.ts'), 'utf-8');
    // 主路径:force > overrides > routing;本路由无 force 概念,但 overrides 必须压过 routing(cast)
    expect(main).toContain('voice-overrides');
    expect(main).toContain('effectiveVoice');
    expect(code, 'recompose 也必须读同一份覆盖表').toContain('voice-overrides');
  });
});
