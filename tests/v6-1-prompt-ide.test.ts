/**
 * v6.1 — 智能提示词工作台 (Prompt IDE) 纯逻辑单测.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMentions,
  activeMention,
  suggestAssets,
  resolveMentions,
  compilePrompt,
  insertMention,
  type MentionableAsset,
} from '@/lib/prompt-ide';

const ASSETS: MentionableAsset[] = [
  { id: 'c1', kind: 'character', name: '林小满', expansion: '林小满 visual DNA: long black hair, stubborn eyes' },
  { id: 'c2', kind: 'character', name: 'Aria', expansion: 'Aria: silver-haired knight' },
  { id: 's1', kind: 'scene', name: '庭院', expansion: 'a quiet courtyard at dusk, stone path' },
  { id: 'st1', kind: 'style', name: '国风', expansion: 'guofeng ink-wash aesthetic' },
];

describe('v6.1 · parseMentions', () => {
  it('抓中文 + 英文 @引用, 带 offset', () => {
    const ms = parseMentions('开场 @林小满 走进 @庭院');
    expect(ms.map((m) => m.name)).toEqual(['林小满', '庭院']);
    expect(ms[0].raw).toBe('@林小满');
    expect(ms[0].start).toBe(3);
  });
  it('排除 email 形态的 a@b', () => {
    expect(parseMentions('mail me at bob@example.com please')).toEqual([]);
  });
  it('支持下划线/数字/中点名', () => {
    expect(parseMentions('@scene_01 与 @张·三').map((m) => m.name)).toEqual(['scene_01', '张·三']);
  });
  it('空/无引用 → []', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('没有任何引用')).toEqual([]);
  });
});

describe('v6.1 · activeMention (光标补全触发)', () => {
  it('光标在 @token 末尾 → 返回已敲入的名字', () => {
    const text = '开场 @林小';
    const a = activeMention(text, text.length);
    expect(a).not.toBeNull();
    expect(a!.name).toBe('林小');
    expect(a!.start).toBe(3);
  });
  it('刚敲下 @ (空 token)', () => {
    const text = 'hello @';
    expect(activeMention(text, text.length)!.name).toBe('');
  });
  it('光标后有空格 (引用已结束) → null', () => {
    const text = '@林小满 走';
    expect(activeMention(text, text.length)).toBeNull();
  });
  it('email 形态不触发', () => {
    const text = 'bob@exam';
    expect(activeMention(text, text.length)).toBeNull();
  });
});

describe('v6.1 · suggestAssets', () => {
  it('前缀优先于子串, 全等最高', () => {
    const assets: MentionableAsset[] = [
      { id: '1', kind: 'character', name: '小满', expansion: '' },
      { id: '2', kind: 'character', name: '林小满', expansion: '' },
      { id: '3', kind: 'character', name: '满月', expansion: '' },
    ];
    const r = suggestAssets('小满', assets);
    expect(r[0].name).toBe('小满');   // 全等
    expect(r[1].name).toBe('林小满'); // 子串 (含)
    expect(r.map((a) => a.name)).not.toContain('满月'); // 不含 "小满"
  });
  it('空 query → 返回前 N 个', () => {
    expect(suggestAssets('', ASSETS, 2)).toHaveLength(2);
  });
  it('大小写不敏感', () => {
    expect(suggestAssets('aria', ASSETS)[0].name).toBe('Aria');
  });
});

describe('v6.1 · resolveMentions', () => {
  it('命中 + 未命中混合', () => {
    const r = resolveMentions('@林小满 在 @不存在 旁', ASSETS);
    expect(r[0].asset?.id).toBe('c1');
    expect(r[1].asset).toBeNull();
  });
});

describe('v6.1 · compilePrompt', () => {
  it('@引用替换成 expansion, 文本原样保留', () => {
    const r = compilePrompt('特写 @林小满 站在 @庭院 中, @国风', ASSETS);
    expect(r.prompt).toBe('特写 林小满 visual DNA: long black hair, stubborn eyes 站在 a quiet courtyard at dusk, stone path 中, guofeng ink-wash aesthetic');
    expect(r.used.map((a) => a.id)).toEqual(['c1', 's1', 'st1']);
    expect(r.unresolved).toEqual([]);
  });
  it('未命中引用降级成裸名字 (不漏 @ 给图像引擎)', () => {
    const r = compilePrompt('@张三 与 @林小满', ASSETS);
    expect(r.prompt).toBe('张三 与 林小满 visual DNA: long black hair, stubborn eyes');
    expect(r.unresolved).toEqual(['张三']);
    expect(r.used.map((a) => a.id)).toEqual(['c1']);
  });
  it('重复引用只在 used 里计一次', () => {
    const r = compilePrompt('@林小满 ... @林小满', ASSETS);
    expect(r.used).toHaveLength(1);
  });
  it('无引用原样返回', () => {
    expect(compilePrompt('纯文本 prompt', ASSETS).prompt).toBe('纯文本 prompt');
  });
});

describe('v6.1 · insertMention (补全选中后回填)', () => {
  it('把正在敲的 @token 替换成完整 @name + 空格, 光标落到空格后', () => {
    const text = '开场 @林小';                 // 光标在末尾
    const active = activeMention(text, text.length)!;
    const r = insertMention(text, active, '林小满');
    expect(r.text).toBe('开场 @林小满 ');
    expect(r.caret).toBe(r.text.length);
  });
  it('保留 token 后面的文本', () => {
    const text = '@林 走进庭院';
    const active = { start: 0, end: 2 };       // "@林"
    const r = insertMention(text, active, '林小满');
    expect(r.text).toBe('@林小满  走进庭院');  // 插入 "@林小满 " 再接原来的 " 走进庭院"
    expect(r.caret).toBe('@林小满 '.length);
  });
});
