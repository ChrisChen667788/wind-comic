/**
 * v12.338 — 角色→音色「定妆表」落盘。
 *
 * ## 缺口是仓库自己写下的
 * VERSIONS.md v12.291 段:「两边一致的前提是**阵容列表相同**……根治办法是出片时把
 * 「角色→音色」映射**落盘**、重配读它(与 v12.289 转场回写同一招)—— 留待后续版本。」
 *
 * ## 真正的失效路径(比原文描述更隐蔽)
 * 音色是按**整集阵容轮转**分配的(首次出现顺序 → 音色池轮转),所以一个角色分到哪把嗓子
 * **取决于阵容里还有谁**。出片与重录当前都加载整集剧本,只要剧本没变就一致 —— 这点原代码是对的。
 * 漏洞在**剧本被改之后**:成片当时那套分配从未被记录,用户加个角色/删句台词/改个名,
 * 阵容顺序一变,轮转结果整体错位,重录出来**不是成片里那把嗓子**,而且没有任何报警。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { resolveWithCast } from '@/lib/voice-cast';
import { buildVoiceRouting } from '@/lib/voice-routing';

describe('v12.338 · 核心不变式:阵容变了,已定妆的角色不许换嗓子', () => {
  it('**加入新角色后,老角色的音色不变**(这是整个模块存在的理由)', () => {
    const cast = ['李长安', '柳如烟', '陈叔'];
    const filmMap = Object.fromEntries(buildVoiceRouting(cast));      // 出片当时的分配
    // 剧本被改:开头插入一个新角色,原阵容顺序整体后移
    const changed = ['旁白', '李长安', '柳如烟', '陈叔'];
    const after = resolveWithCast(changed, filmMap);
    for (const n of cast) {
      expect(after.map.get(n), `${n} 的音色变了 —— 成片与重录会对不上`).toBe(filmMap[n]);
    }
  });

  it('没有定妆表时,分配与本版之前一模一样(零回归)', () => {
    const cast = ['李长安', '柳如烟'];
    const before = buildVoiceRouting(cast);
    const now = resolveWithCast(cast, null);
    for (const n of cast) expect(now.map.get(n)).toBe(before.get(n));
  });

  it('角色被删(不再有台词)不影响其余人 —— 表里锁着', () => {
    const filmMap = Object.fromEntries(buildVoiceRouting(['李长安', '柳如烟', '陈叔']));
    const after = resolveWithCast(['李长安', '陈叔'], filmMap);   // 柳如烟没台词了
    expect(after.map.get('李长安')).toBe(filmMap['李长安']);
    expect(after.map.get('陈叔')).toBe(filmMap['陈叔']);
  });

  it('新角色会被分配并标记为待写回(added),老角色不进 added', () => {
    const filmMap = Object.fromEntries(buildVoiceRouting(['李长安']));
    const r = resolveWithCast(['李长安', '新人'], filmMap);
    expect(Object.keys(r.added)).toEqual(['新人']);
    expect(r.map.get('新人')).toBeTruthy();
  });

  it('新角色**不与已占用音色撞车**(轮转只在一次拿到全阵容时才保证不撞)', () => {
    const filmMap = Object.fromEntries(buildVoiceRouting(['甲', '乙', '丙']));
    const r = resolveWithCast(['甲', '乙', '丙', '丁'], filmMap);
    const used = Object.values(filmMap);
    expect(used, `新人拿到了 ${r.map.get('丁')},与已定妆角色撞音`).not.toContain(r.map.get('丁'));
  });
});

describe('v12.338 · 边界', () => {
  it('空名/重复名不产生垃圾条目', () => {
    const r = resolveWithCast(['甲', '', '  ', '甲'], null);
    expect([...r.map.keys()]).toEqual(['甲']);
  });

  it('全部角色都在表里 → 不产生任何写回(避免无谓写库)', () => {
    const filmMap = Object.fromEntries(buildVoiceRouting(['甲', '乙']));
    expect(resolveWithCast(['甲', '乙'], filmMap).added).toEqual({});
  });

  it('空阵容不炸', () => {
    expect(resolveWithCast([], null).map.size).toBe(0);
    expect(resolveWithCast([], { 甲: 'v1' }).map.size).toBe(0);
  });
});

describe('v12.338 · 接线:出片落盘、重录读盘,同一出处', () => {
  const ROUTE = fs.readFileSync('app/api/projects/[id]/shot-audio/route.ts', 'utf-8');
  const RETAKE = fs.readFileSync('lib/voice-retake.ts', 'utf-8');
  const CAST = fs.readFileSync('lib/voice-cast.ts', 'utf-8');

  it('出片路径改走 resolveAndPersistCast(而不是直接轮转)', () => {
    expect(ROUTE).toContain('resolveAndPersistCast');
    expect(ROUTE, '两边各算一套就是漂移的来源').not.toMatch(/=\s*buildVoiceRouting\(/);
  });

  it('重录路径也走同一个出处', () => {
    expect(RETAKE).toContain('resolveAndPersistCast');
    expect(RETAKE).not.toMatch(/=\s*buildVoiceRouting\(/);
  });

  it('定妆表**只增不改** —— 已出片的音色不能被后续写入悄悄改掉', () => {
    const i = CAST.indexOf('export async function saveVoiceCast');
    expect(i).toBeGreaterThan(0);
    expect(CAST.slice(i, i + 700)).toMatch(/if \(!merged\[n\]\)/);
  });

  it('表坏了不让配音链路挂掉(退回轮转,与本版之前同)', () => {
    const i = CAST.indexOf('export async function loadVoiceCast');
    expect(CAST.slice(i, i + 500)).toMatch(/catch\s*\{[\s\S]{0,120}return null/);
  });

  it('用户手动覆盖仍在定妆表之上(那是人的明确意志)', () => {
    expect(RETAKE).toMatch(/effectiveVoice\(speaker,\s*\{\s*overrides/);
    expect(ROUTE).toContain('voice-overrides');
  });
});
