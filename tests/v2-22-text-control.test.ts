/**
 * v2.22 fix #2 — text-control: dialogue sanitize + SRT + neg prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  sanitizeDialogueForPrompt,
  getTextNegativePromptFlags,
  buildSrtEntry,
  buildSrt,
  findCjkFont,
  stripNonDialogueBrackets,
} from '@/lib/text-control';

describe('v2.22 · sanitizeDialogueForPrompt', () => {
  it('短对白用 brief phrase', () => {
    const out = sanitizeDialogueForPrompt('你好', 'alice');
    expect(out).toContain('alice');
    expect(out).toContain('speaking');
    expect(out).toContain('brief phrase');
    // 关键: 原文不能出现在 prompt 里
    expect(out).not.toContain('你好');
  });

  it('中等对白用 sentence', () => {
    const out = sanitizeDialogueForPrompt('我觉得你完全错了, 应该重新考虑', 'bob');
    expect(out).toContain('sentence');
    expect(out).not.toContain('完全错了');
  });

  it('长对白用 extended speech', () => {
    const longDialogue = '这件事说来话长'.repeat(8);
    const out = sanitizeDialogueForPrompt(longDialogue, 'carol');
    expect(out).toContain('extended speech');
    expect(out).not.toContain('这件事说来话长');
  });

  it('无 speaker → 用 "character"', () => {
    const out = sanitizeDialogueForPrompt('test');
    expect(out).toContain('character is speaking');
  });

  it('空对白返空字符串', () => {
    expect(sanitizeDialogueForPrompt('')).toBe('');
    expect(sanitizeDialogueForPrompt('   ')).toBe('');
  });
});

describe('v2.22 · getTextNegativePromptFlags', () => {
  it('mj flavor: --no text/words/chinese 等全套', () => {
    const flags = getTextNegativePromptFlags({ flavor: 'mj' });
    expect(flags).toContain('--no text');
    expect(flags).toContain('--no chinese');
    expect(flags).toContain('--no captions');
    expect(flags).toContain('--no subtitles');
    expect(flags).toContain('--no watermark');
  });

  it('plain flavor: ", no X" 给非 MJ 模型 (Minimax/Hailuo) 用', () => {
    const flags = getTextNegativePromptFlags({ flavor: 'plain' });
    expect(flags).toContain('no text');
    expect(flags).toContain('no chinese characters');
    expect(flags).not.toContain('--no');
  });

  it('默认 mj flavor', () => {
    expect(getTextNegativePromptFlags()).toContain('--no text');
  });
});

describe('v2.22 · buildSrtEntry (SRT time format)', () => {
  it('生成标准 SRT 单条', () => {
    const entry = buildSrtEntry(1, 0, 5, '你好世界');
    expect(entry).toContain('1\n');
    expect(entry).toContain('00:00:00,000 --> 00:00:05,000');
    expect(entry).toContain('你好世界');
  });

  it('时间戳精确到 ms', () => {
    const entry = buildSrtEntry(2, 5.5, 2.3, 'X');
    expect(entry).toContain('00:00:05,500 --> 00:00:07,800');
  });

  it('跨小时 / 分钟 正确进位', () => {
    const entry = buildSrtEntry(3, 3725.123, 10, 'test');
    expect(entry).toContain('01:02:05,123 --> 01:02:15,123');
  });

  it('清理 \\r 和多余 \\n', () => {
    const entry = buildSrtEntry(1, 0, 5, '第一行\r\n\n\n第二行');
    // 应剩 \n 间隔 — 不会有 \r 或重复 \n
    expect(entry).not.toContain('\r');
    expect(entry).not.toContain('\n\n\n');
  });
});

describe('v2.22 · buildSrt (全片字幕)', () => {
  it('跳过无 dialogue 镜头, 序号连续', () => {
    const shots = [
      { dialogue: '第 1 镜对白', duration: 5 },
      { dialogue: '', duration: 5 }, // 无对白
      { dialogue: '第 3 镜对白', duration: 5 },
    ];
    const srt = buildSrt(shots);
    expect(srt).toContain('第 1 镜对白');
    expect(srt).toContain('第 3 镜对白');
    // 序号 1, 2 (跳过空镜后), 不会是 1, 3
    expect(srt).toMatch(/^1\n/m);
    expect(srt).toMatch(/^2\n/m);
    expect(srt).not.toMatch(/^3\n/m);
  });

  it('时间轴按播放顺序累积', () => {
    const shots = [
      { dialogue: 'A', duration: 5 },
      { dialogue: 'B', duration: 3 },
    ];
    const srt = buildSrt(shots);
    expect(srt).toContain('00:00:00,000 --> 00:00:05,000'); // A: 0-5
    expect(srt).toContain('00:00:05,000 --> 00:00:08,000'); // B: 5-8
  });

  it('无 duration 用默认 5s', () => {
    const shots = [{ dialogue: 'X' }];
    const srt = buildSrt(shots);
    expect(srt).toContain('00:00:00,000 --> 00:00:05,000');
  });

  it('空镜头数组返空字符串', () => {
    expect(buildSrt([])).toBe('');
  });
});

describe('v2.22 · findCjkFont (env override + system lookup)', () => {
  it('env CJK_FONT_FILE 不存在 → fallback 到 system candidates (返非 null 当系统有 CJK 字体)', () => {
    const original = process.env.CJK_FONT_FILE;
    process.env.CJK_FONT_FILE = '/nonexistent/font.ttf';
    const font = findCjkFont();
    // 期望 fallback — 不指向 nonexistent
    expect(font).not.toBe('/nonexistent/font.ttf');
    if (original !== undefined) process.env.CJK_FONT_FILE = original;
    else delete process.env.CJK_FONT_FILE;
  });

  it('env CJK_FONT_FILE 真实存在 → 优先返回', () => {
    const original = process.env.CJK_FONT_FILE;
    // 用一个肯定存在的非 CJK 文件 (我们的 lib 不校验是不是真 CJK 字体, 只检 fs.existsSync)
    const fakeFontPath = process.cwd() + '/package.json';
    process.env.CJK_FONT_FILE = fakeFontPath;
    expect(findCjkFont()).toBe(fakeFontPath);
    if (original !== undefined) process.env.CJK_FONT_FILE = original;
    else delete process.env.CJK_FONT_FILE;
  });

  it('真 lookup — macOS 测试机至少能找到一个 CJK 字体', () => {
    delete process.env.CJK_FONT_FILE;
    const font = findCjkFont();
    if (process.platform === 'darwin' && font !== null) {
      expect(font).toMatch(/\.tt[cf]$|\.otf$/);
    }
  });
});

describe('v12.41 · stripNonDialogueBrackets (字幕/TTS 剔除音效配乐提示)', () => {
  it('整行括号音效提示 → 整条删除', () => {
    expect(stripNonDialogueBrackets('(无对白，只有金属撞击与走火的轰响)')).toBe('');
    expect(stripNonDialogueBrackets('（喉间一声闷哑的吸气）')).toBe('');
    expect(stripNonDialogueBrackets('(背景音乐渐强)')).toBe('');
  });

  it('行内括号(音效/动作)→ 删括号段,保留台词', () => {
    expect(stripNonDialogueBrackets('来不及了（喉间一声闷哑的吸气）')).toBe('来不及了');
    expect(stripNonDialogueBrackets('住手（枪声）')).toBe('住手');
  });

  it('舞台/语气括号一律剔除(字幕只留出声台词)', () => {
    expect(stripNonDialogueBrackets('好（停顿）')).toBe('好');
    expect(stripNonDialogueBrackets('（笑）你来了')).toBe('你来了');
    expect(stripNonDialogueBrackets('（沉稳)今晚到此为止。')).toBe('今晚到此为止。');
  });

  it('删括号后清理行首孤立标点', () => {
    expect(stripNonDialogueBrackets('(低哑,对自己)……哪来的。')).toBe('哪来的。');
  });

  it('纯台词原样返回 / 空输入返空', () => {
    expect(stripNonDialogueBrackets('这一战，必赢。')).toBe('这一战，必赢。');
    expect(stripNonDialogueBrackets('')).toBe('');
    expect(stripNonDialogueBrackets('   ')).toBe('');
  });

  it('buildSrt 端到端:整行音效提示镜头不进字幕', () => {
    const shots = [
      { dialogue: '我回来了', duration: 4 },
      { dialogue: '(无对白，只有金属撞击与走火的轰响)', duration: 4 },
      { dialogue: '别动', duration: 4 },
    ];
    const srt = buildSrt(shots);
    expect(srt).toContain('我回来了');
    expect(srt).toContain('别动');
    expect(srt).not.toContain('金属撞击');
    expect(srt).not.toContain('无对白');
    // 仅 2 条字幕,序号连续
    expect(srt).toMatch(/^1\n/m);
    expect(srt).toMatch(/^2\n/m);
    expect(srt).not.toMatch(/^3\n/m);
  });
});
