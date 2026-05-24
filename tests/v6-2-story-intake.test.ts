/**
 * v6.2 — 长篇智能拆解 + 叙事模式 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  splitIntoEpisodes,
  NARRATION_MODES,
  getNarrationMode,
  buildNarrationDirective,
  DEFAULT_TARGET_CHARS,
} from '@/lib/story-intake';

describe('v6.2 · splitIntoEpisodes — 章节标记优先', () => {
  it('按"第X章"标记分集, 标题取标记行', () => {
    const text = '第一章 初遇\n少年走进山门。\n\n第二章 试炼\n他面对第一关。\n\n第三章 突破\n灵力觉醒。';
    const eps = splitIntoEpisodes(text);
    expect(eps).toHaveLength(3);
    expect(eps[0].title).toContain('第一章');
    expect(eps[1].title).toContain('第二章');
    expect(eps.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(eps[0].text).toContain('少年走进山门');
  });

  it('识别 Chapter N / markdown 标题', () => {
    expect(splitIntoEpisodes('Chapter 1\nintro\n\nChapter 2\nnext')).toHaveLength(2);
    expect(splitIntoEpisodes('## 序\nA 段\n\n## 第二节\nB 段').length).toBe(2);
  });

  it('标记前的开篇文字保留为"开篇"集', () => {
    const pre = '这是一段足够长的引子'.repeat(9); // 90 字, ≥80 阈值
    const eps = splitIntoEpisodes(`${pre}\n\n第一章 起\n正文一\n\n第二章 承\n正文二`);
    expect(eps[0].title).toBe('开篇');
    expect(eps).toHaveLength(3);
  });
});

describe('v6.2 · splitIntoEpisodes — 无标记按长度打包', () => {
  it('短文 → 1 集', () => {
    const eps = splitIntoEpisodes('一个很短的小故事。');
    expect(eps).toHaveLength(1);
    expect(eps[0].title).toBe('第1集');
  });

  it('长文按 targetChars 切多集', () => {
    const para = '段落内容'.repeat(50); // 200 字
    const text = Array.from({ length: 10 }, () => para).join('\n\n'); // 10 段 ~2000 字
    const eps = splitIntoEpisodes(text, { targetChars: 500 });
    expect(eps.length).toBeGreaterThan(1);
    eps.forEach((e) => expect(e.charCount).toBeLessThanOrEqual(700)); // 贪心, 允许略超一个单元
  });

  it('maxEpisodes 限制集数 (抬高 target)', () => {
    const para = '内容'.repeat(100);
    const text = Array.from({ length: 12 }, () => para).join('\n\n');
    const eps = splitIntoEpisodes(text, { targetChars: 300, maxEpisodes: 3 });
    expect(eps.length).toBeLessThanOrEqual(3);
  });

  it('单段长文无换行 → 按句子切', () => {
    const text = '第一句话。'.repeat(80); // 一大段, 无双换行
    const eps = splitIntoEpisodes(text, { targetChars: 100 });
    expect(eps.length).toBeGreaterThan(1);
  });

  it('空文本 → []', () => {
    expect(splitIntoEpisodes('')).toEqual([]);
    expect(splitIntoEpisodes('   \n  ')).toEqual([]);
  });
});

describe('v6.2 · 叙事模式', () => {
  it('三种模式齐全, 字段完整', () => {
    expect(NARRATION_MODES.map((m) => m.id)).toEqual(['dialogue', 'first_person', 'narrator']);
    for (const m of NARRATION_MODES) {
      expect(m.label).toBeTruthy();
      expect(m.directive.length).toBeGreaterThan(5);
    }
  });
  it('getNarrationMode 未知 id 兜底对白驱动', () => {
    expect(getNarrationMode('xxx').id).toBe('dialogue');
    expect(getNarrationMode(null).id).toBe('dialogue');
    expect(getNarrationMode('narrator').id).toBe('narrator');
  });
  it('first_person / narrator 生成解说音轨, dialogue 不生成', () => {
    expect(getNarrationMode('dialogue').generatesNarrationTrack).toBe(false);
    expect(getNarrationMode('first_person').generatesNarrationTrack).toBe(true);
    expect(getNarrationMode('narrator').generatesNarrationTrack).toBe(true);
  });
  it('buildNarrationDirective 返回对应指令', () => {
    expect(buildNarrationDirective('first_person')).toContain('第一人称');
    expect(buildNarrationDirective('narrator')).toContain('旁白');
  });
});

describe('v6.2 · 常量', () => {
  it('默认目标字数合理', () => {
    expect(DEFAULT_TARGET_CHARS).toBeGreaterThan(0);
  });
});
