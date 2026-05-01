/**
 * v2.12 Bug fix — isFullScriptInput 误判修复
 *
 * 用户输入小说式叙述(围篝火、提醒众人:"有狼靠近"...) 不应被误判为剧本格式。
 * 过去 isFullScriptInput 只要 hasDialogue + hasMultipleDialogues + isLongWithDialogue
 * 就累加 3 分通过门槛,把任何"中文+冒号+2 字"算对白(包括引述的引号),命中率太高。
 *
 * 新规则锁住:
 *   · 强信号(章节标记 / 场景标记 / △画面 / OS) → 一票通过
 *   · 弱信号:严格行首角色名+冒号 ≥4 行 + 长文 (≥800) 才算
 *   · 普通叙述+引用句 不再误判
 */

import { describe, it, expect } from 'vitest';
import { isFullScriptInput } from '@/lib/script-parser';

describe('isFullScriptInput — Bug fix: 普通叙述不再误判为剧本', () => {
  it('用户原始输入(篝火+引述,505 字纯叙述)应判定为非剧本', () => {
    const userInput = `队伍围坐篝火,吃饱喝足,准备各自回帐篷休息。突然,李弼发现黑影的涌动和一双双眼睛的绿光,他压低声音提醒众人:"有狼靠近,大家别离火太远。" 五大夫立即示意大家围成一圈,方士们用车身、盾牌和木箱在外圈加固;李弼等护卫拔出长矛,各自守好四个方向。你(玩家)将铜铃压低在手心,轻轻摇出"两短一长"的节奏,作为信号。狼群藏在外围阴影之中,一直徘徊试探,没有直接冲入光圈。五大夫缓缓站起,用木枝挑起篝火的柴火,火光一下跳高,驱散了一部分阴影。`;
    expect(isFullScriptInput(userInput)).toBe(false);
  });

  it('短文本(<150 字)永远非剧本', () => {
    expect(isFullScriptInput('一段短小的创意')).toBe(false);
    expect(isFullScriptInput('A:你好。B:你好。'.repeat(3))).toBe(false); // 长度不够
  });

  it('强信号:含 △画面 标记 → 判定为剧本', () => {
    const text = `${'A'.repeat(200)}\n△画面:夜色阑珊,主角持剑而立。\n李长安:这一战,必赢。`;
    expect(isFullScriptInput(text)).toBe(true);
  });

  it('强信号:含章节标记 → 判定为剧本', () => {
    const text = `第1章 雨夜重逢\n${'故事内容'.repeat(50)}`;
    expect(isFullScriptInput(text)).toBe(true);
  });

  it('强信号:含 (OS) 旁白标记 → 判定为剧本', () => {
    const text = `${'X'.repeat(200)}李长安(OS):那一刻,我才明白。`;
    expect(isFullScriptInput(text)).toBe(true);
  });

  it('强信号:含 INT./EXT. + em-dash + DAY (好莱坞剧本格式) → 判定为剧本', () => {
    // 注:hasSceneMarkIntExt 要求 em-dash(——)或 en-dash(-–),不是 ASCII 连字符
    const text = `INT. CAFE —— DAY\n\n李长安和柳如烟坐在窗边。${'X'.repeat(200)}`;
    expect(isFullScriptInput(text)).toBe(true);
  });

  it('弱信号:严格 ≥4 行行首角色名对白 + ≥800 字 → 判定为剧本', () => {
    // 4 行对白
    const dialogues = [
      '李长安:我来了。',
      '柳如烟:你迟了。',
      '李长安:路上有事。',
      '柳如烟:坐吧。',
    ].join('\n');
    const padding = 'X'.repeat(900);
    expect(isFullScriptInput(`${dialogues}\n${padding}`)).toBe(true);
  });

  it('弱信号:对白多但文本短(<800 字)→ 不判定为剧本', () => {
    const dialogues = [
      '李长安:我来了。',
      '柳如烟:你迟了。',
      '李长安:路上有事。',
      '柳如烟:坐吧。',
    ].join('\n');
    expect(isFullScriptInput(dialogues)).toBe(false);
  });

  it('小说式引述(角色: "..." 内嵌)不算行首对白,长度 < 800 不误判', () => {
    const novel = '他低声说:"小心!"她回答:"我知道了。"两人快步前行。'.repeat(8);
    expect(novel.length).toBeLessThan(800);
    expect(isFullScriptInput(novel)).toBe(false);
  });
});
