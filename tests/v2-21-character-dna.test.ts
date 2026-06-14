/**
 * v2.21 P1.2 — Character DNA: signature normalization + prompt block + injection.
 *
 * Vision API 调用本身用 mock 隔离, 只验证我们自己的解析 / 拼接 / 注入逻辑.
 * 真实 vision 调用在 staging 实测 (需 OPENAI_API_KEY).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: {
      apiKey: '',  // 默认无 key → extractCharacterDna 返回 null
      baseURL: 'http://test',
      model: 'test-model',
    },
  },
}));

// OpenAI client mock — extractCharacterDna 用到时返回固定 JSON
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  buildPromptBlock,
  injectDnaIntoPrompt,
  extractCharacterDna,
  normalizeCharacterName,
  matchDnaForName,
  type CharacterDna,
} from '@/lib/character-dna';

describe('v2.21 P1.2 · buildPromptBlock', () => {
  it('joins all non-empty signature fields', () => {
    const block = buildPromptBlock('陈淮安', {
      eyeShape: 'almond, slightly upturned',
      jawShape: 'soft oval',
      hairStyle: 'long ponytail',
      hairColor: 'black with auburn',
      skinTone: 'fair, cool',
      signatureOutfit: 'silver jade pendant',
    });
    expect(block).toContain('陈淮安 visual DNA:');
    expect(block).toContain('eyes: almond, slightly upturned');
    expect(block).toContain('hair: long ponytail');
    expect(block).toContain('signature: silver jade pendant');
    expect(block.length).toBeLessThanOrEqual(250);
  });

  it('returns empty string when all fields empty', () => {
    expect(buildPromptBlock('X', {})).toBe('');
  });

  it('only included fields show up', () => {
    const block = buildPromptBlock('Y', {
      eyeShape: 'wide',
      hairStyle: 'short crop',
      // others missing
    });
    expect(block).toContain('eyes: wide');
    expect(block).toContain('hair: short crop');
    expect(block).not.toContain('jaw');
    expect(block).not.toContain('skin');
  });

  it('caps body at 200 chars', () => {
    const block = buildPromptBlock('Z', {
      eyeShape: 'A'.repeat(80),
      jawShape: 'B'.repeat(80),
      noseShape: 'C'.repeat(80),
      mouthShape: 'D'.repeat(80),
    });
    // 全部加起来 320+ chars, 应该被截到 200
    const body = block.split('visual DNA: ')[1];
    expect(body.length).toBeLessThanOrEqual(200);
  });
});

describe('v2.21 P1.2 · injectDnaIntoPrompt', () => {
  const dnaMap = new Map<string, CharacterDna>([
    ['alice', { name: 'alice', sourceImageUrl: 'http://a', signature: { eyeShape: 'wide' }, promptBlock: 'alice visual DNA: eyes: wide' }],
    ['bob', { name: 'bob', sourceImageUrl: 'http://b', signature: { jawShape: 'square' }, promptBlock: 'bob visual DNA: jaw: square' }],
  ]);

  it('appends DNA for single matching character', () => {
    const out = injectDnaIntoPrompt('cinematic shot', ['alice'], dnaMap);
    expect(out).toContain('cinematic shot');
    expect(out).toContain('alice visual DNA');
  });

  it('joins multiple characters with " | "', () => {
    const out = injectDnaIntoPrompt('two-shot', ['alice', 'bob'], dnaMap);
    expect(out).toContain('alice visual DNA');
    expect(out).toContain('bob visual DNA');
    expect(out).toContain(' | ');
  });

  it('no-op when shotCharacters empty', () => {
    expect(injectDnaIntoPrompt('base', [], dnaMap)).toBe('base');
    expect(injectDnaIntoPrompt('base', undefined, dnaMap)).toBe('base');
  });

  it('no-op when dna map empty', () => {
    expect(injectDnaIntoPrompt('base', ['alice'], new Map())).toBe('base');
  });

  it('skips characters not in map (no crash, no fake injection)', () => {
    const out = injectDnaIntoPrompt('base', ['ghost', 'alice'], dnaMap);
    expect(out).toContain('alice visual DNA');
    expect(out).not.toContain('ghost');
  });
});

describe('v2.21 P1.2 · extractCharacterDna', () => {
  it('returns null when no API key', async () => {
    const result = await extractCharacterDna('alice', 'https://example.com/a.png');
    expect(result).toBeNull();
  });

  it('returns null for non-fetchable image URL', async () => {
    // 即便有 key, /local/path 也应被拒
    const result = await extractCharacterDna('alice', '/local/path.png');
    expect(result).toBeNull();
  });

  it('returns null for missing name', async () => {
    const result = await extractCharacterDna('', 'https://example.com/a.png');
    expect(result).toBeNull();
  });
});

describe('v12.2.0 · normalizeCharacterName + matchDnaForName(名称归一,修漏注入)', () => {
  const dnaMap = new Map<string, CharacterDna>([
    ['小满', { name: '小满', sourceImageUrl: 'http://x', signature: { eyeShape: 'wide' }, promptBlock: '小满 visual DNA: eyes: wide' }],
    ['Alice Chen', { name: 'Alice Chen', sourceImageUrl: 'http://a', signature: { jawShape: 'soft' }, promptBlock: 'Alice Chen visual DNA: jaw: soft' }],
  ]);

  it('归一:大小写/标点/空格剥离', () => {
    expect(normalizeCharacterName('Alice, Chen!')).toBe('alicechen');
    expect(normalizeCharacterName('「小满」')).toBe('小满');
    expect(normalizeCharacterName('')).toBe('');
  });

  it('归一精确命中:「Alice Chen」↔「alice，chen」', () => {
    expect(matchDnaForName('alice，chen', dnaMap)?.name).toBe('Alice Chen');
  });

  it('子串命中:镜头「林小满」↔ dnaMap「小满」(此前静默漏注入)', () => {
    const dna = matchDnaForName('林小满', dnaMap);
    expect(dna?.name).toBe('小满');
  });

  it('单字不误匹配(norm 长度 ≥2 才走子串)', () => {
    const m = new Map<string, CharacterDna>([['李', { name: '李', sourceImageUrl: 'h', signature: {}, promptBlock: '李 dna' }]]);
    expect(matchDnaForName('王', m)).toBeUndefined();
  });

  it('injectDnaIntoPrompt 经子串命中注入「林小满」', () => {
    const out = injectDnaIntoPrompt('shot', ['林小满'], dnaMap);
    expect(out).toContain('小满 visual DNA');
  });

  it('同一 DNA 被多个别名命中只拼一次(去重)', () => {
    const out = injectDnaIntoPrompt('shot', ['小满', '林小满'], dnaMap);
    expect(out.match(/小满 visual DNA/g)?.length).toBe(1);
  });
});

describe('v2.21 P1.2 · normalize behavior (via buildPromptBlock)', () => {
  it('trims very long field values', () => {
    const block = buildPromptBlock('X', {
      eyeShape: 'A'.repeat(500),
    });
    // promptBlock 内部应不超过 200 char body, 总体不超过 250
    expect(block.length).toBeLessThanOrEqual(250);
  });
});
