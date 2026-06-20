/**
 * v12.21.0 — AI 自动拆集:LLM 输出解析(容错)+ prompt 构建。
 */
import { describe, it, expect } from 'vitest';
import { parseEpisodeOutlines, buildSplitUserPrompt, buildSplitSystemPrompt } from '@/lib/series-ai';

describe('v12.21.0 · parseEpisodeOutlines', () => {
  it('标准 {episodes:[{title,premise}]}', () => {
    const out = parseEpisodeOutlines('{"episodes":[{"title":"困兽","premise":"铁笼初战"},{"title":"复仇","premise":"反杀笼师"}]}');
    expect(out).toEqual([{ title: '困兽', premise: '铁笼初战' }, { title: '复仇', premise: '反杀笼师' }]);
  });
  it('剥 ```json fence 与 <think>', () => {
    const out = parseEpisodeOutlines('<think>盘算一下</think>\n```json\n{"episodes":[{"premise":"开场"}]}\n```');
    expect(out).toEqual([{ title: undefined, premise: '开场' }]);
  });
  it('兼容顶层数组 + summary/标题 字段名', () => {
    const out = parseEpisodeOutlines('[{"标题":"序","summary":"世界观铺陈"}]');
    expect(out).toEqual([{ title: '序', premise: '世界观铺陈' }]);
  });
  it('过滤空 premise + 按 max 截断', () => {
    const out = parseEpisodeOutlines('{"episodes":[{"premise":"a"},{"premise":""},{"premise":"b"},{"premise":"c"}]}', 2);
    expect(out).toEqual([{ title: undefined, premise: 'a' }, { title: undefined, premise: 'b' }]);
  });
  it('非法 JSON → 空数组(调用方降级)', () => {
    expect(parseEpisodeOutlines('对不起我无法生成')).toEqual([]);
    expect(parseEpisodeOutlines('')).toEqual([]);
  });
});

describe('v12.21.0 · prompt 构建', () => {
  it('user prompt 含设定与集数,集数钳到 [1,50]', () => {
    expect(buildSplitUserPrompt('铁笼格斗', 3)).toContain('铁笼格斗');
    expect(buildSplitUserPrompt('x', 3)).toContain('拆成 3 集');
    expect(buildSplitUserPrompt('x', 999)).toContain('拆成 50 集');
    expect(buildSplitUserPrompt('x', 0)).toContain('拆成 1 集');
  });
  it('system prompt 要求只输出 JSON + episodes 形状', () => {
    const s = buildSplitSystemPrompt();
    expect(s).toContain('episodes');
    expect(s).toContain('JSON');
  });
});
