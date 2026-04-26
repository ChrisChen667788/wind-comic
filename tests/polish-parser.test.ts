/**
 * lib/polish-json 的回归测试。
 *
 * 覆盖从真实 bug 现场抓到的失败模式:
 *   1. 干净 JSON — Tier 1 strict parse
 *   2. JSON 外包 markdown 围栏 / 前后有散文 — Tier 2 剥壳
 *   3. polished 字段里有未转义的真实换行 — Tier 3 repair
 *   4. 结构损坏但能正则抽字段 — Tier 4 保底
 *   5. 真的什么都抽不到 — 返回 null
 *
 * stripJsonWrapper 是 UI 兜底显示, 也一并测一下。
 */

import { describe, it, expect } from 'vitest';
import { robustJsonParse, stripJsonWrapper, repairJsonStrings } from '@/lib/polish-json';

describe('robustJsonParse (polish-script)', () => {
  it('Tier 1: strict JSON parses cleanly', () => {
    const raw = JSON.stringify({
      polished: '1-1院子  日\n柳如烟: 长安,你可别出事啊',
      summary: '强化画面感',
      notes: ['替换形容词'],
    });
    const v = robustJsonParse(raw);
    expect(v?.polished).toContain('柳如烟');
    expect(v?.summary).toBe('强化画面感');
    expect(v?.notes).toEqual(['替换形容词']);
  });

  it('Tier 2: strips markdown fences', () => {
    const raw = '```json\n' +
      JSON.stringify({ polished: '好', summary: 'ok', notes: [] }) +
      '\n```';
    const v = robustJsonParse(raw);
    expect(v?.polished).toBe('好');
  });

  it('Tier 2: extracts outermost {...} when there is prose before/after', () => {
    const raw = `好的, 我已经完成润色:\n${JSON.stringify({
      polished: 'hi', summary: 's', notes: [],
    })}\n\n谢谢!`;
    const v = robustJsonParse(raw);
    expect(v?.polished).toBe('hi');
  });

  it('Tier 3: repairs unescaped newlines inside string values (real bug case)', () => {
    // 真实 bug 现场 —— polished 字段里有字面换行符(非转义),
    // 用模板字符串直接灌入真实 0x0A, 还原 LLM 实际输出
    const raw = `{
      "polished": "1-1院子  日
柳如烟: 长安,你可别出事啊
李长安: 嫂子,我知道",
      "summary": "修改了对白节奏",
      "notes": ["删直白情绪"]
    }`;
    const v = robustJsonParse(raw);
    expect(v).not.toBeNull();
    expect(v?.polished).toContain('柳如烟');
    expect(v?.polished).toContain('李长安');
    expect(v?.polished).toContain('\n');
    expect(v?.summary).toBe('修改了对白节奏');
  });

  it('Tier 3: repairs nested tabs / CR inside strings', () => {
    const raw = '{"polished":"line1\tindent\r\nline2","summary":"x","notes":[]}';
    const v = robustJsonParse(raw);
    expect(v?.polished).toBe('line1\tindent\r\nline2');
  });

  it('Tier 4: regex falls back when JSON array is broken', () => {
    // notes 数组写坏, 但 polished/summary 能被正则抽到
    const raw = `{"polished": "救得回来的正文", "summary": "简要", "notes": [这里写坏,]}`;
    const v = robustJsonParse(raw);
    expect(v?.polished).toBe('救得回来的正文');
    expect(v?.summary).toBe('简要');
  });

  it('returns null when polished is totally missing', () => {
    const raw = 'just plain text with no JSON at all';
    const v = robustJsonParse(raw);
    expect(v).toBeNull();
  });
});

describe('repairJsonStrings (Tier 3 internal)', () => {
  it('only escapes control chars inside string values, not outside', () => {
    const raw = `{"a":"hello\nworld"}\n`;
    const repaired = repairJsonStrings(raw);
    // 字符串内的 \n 变成 \\n 两字符序列;字符串外的结尾 \n 保留
    expect(repaired).toContain('hello\\nworld');
    expect(repaired.endsWith('\n')).toBe(true);
  });

  it('respects pre-existing escapes (does not double-escape)', () => {
    const raw = `{"a":"line1\\nline2"}`;
    expect(repairJsonStrings(raw)).toBe(raw);
  });
});

describe('stripJsonWrapper (polish-script fallback)', () => {
  it('extracts polished from JSON-looking wrapper when parse completely fails', () => {
    const raw = `{"polished":"只能看到这段","summary":"broken","notes":[坏的]}`;
    expect(stripJsonWrapper(raw)).toBe('只能看到这段');
  });

  it('strips markdown fences and outer braces as last resort', () => {
    const raw = '```json\n{"nonsense":"value"}\n```';
    const out = stripJsonWrapper(raw);
    expect(out).not.toContain('```');
  });

  it('handles escaped newlines in polished value', () => {
    const raw = `{"polished":"第一行\\n第二行"}`;
    const out = stripJsonWrapper(raw);
    expect(out).toContain('第一行');
    expect(out).toContain('第二行');
    expect(out).toContain('\n');
  });
});
