/**
 * v12.2.2 — 资产向量化(阶段二十一,把 global_assets.embedding 死列通电)。
 * 纯函数(余弦/topK/嵌入源)锁逻辑;embedText 的 BYO 降级锁「无 key/MOCK → 零调用返 null」。
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  topKByCosine,
  buildEmbedSource,
  embedText,
  embedModel,
} from '@/lib/asset-embedding';

describe('v12.2.2 · cosineSimilarity', () => {
  it('同向=1、正交=0、反向=-1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
  it('量级无关(只看方向)', () => {
    expect(cosineSimilarity([2, 0], [9, 0])).toBeCloseTo(1, 6);
  });
  it('维度不等/空/零向量 → 0(不崩)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity(undefined, [1])).toBe(0);
  });
});

describe('v12.2.2 · topKByCosine', () => {
  const cands = [
    { id: 'a', embedding: [1, 0] },
    { id: 'b', embedding: [0.9, 0.1] },
    { id: 'c', embedding: [0, 1] },
    { id: 'd', embedding: null },
  ];
  it('按相似度降序取 topK', () => {
    const r = topKByCosine([1, 0], cands, { k: 2 });
    expect(r.map((x) => x.item.id)).toEqual(['a', 'b']);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
  it('minScore 过滤 + 无 embedding 候选记 0 分剔除', () => {
    const r = topKByCosine([1, 0], cands, { k: 10, minScore: 0.5 });
    expect(r.map((x) => x.item.id)).toEqual(['a', 'b']); // c(正交,0)和 d(无向量)被剔
  });
  it('空 query → []', () => {
    expect(topKByCosine([], cands)).toEqual([]);
    expect(topKByCosine(undefined, cands)).toEqual([]);
  });
});

describe('v12.2.2 · buildEmbedSource', () => {
  it('拼 name + description + visual_anchors + DNA promptBlock', () => {
    const s = buildEmbedSource({
      name: '林小满',
      description: '少女剑客',
      visualAnchors: ['银色长发', '红色披风'],
      metadata: { bible: { dna: { promptBlock: '林小满 visual DNA: eyes: almond' } } },
    });
    expect(s).toContain('林小满');
    expect(s).toContain('少女剑客');
    expect(s).toContain('银色长发');
    expect(s).toContain('visual DNA');
  });
  it('支持 metadata.dna 与 metadata.bible.dna 两种落点', () => {
    expect(buildEmbedSource({ name: 'X', metadata: { dna: { promptBlock: 'X dna block' } } })).toContain('X dna block');
  });
  it('全空 → 空串(调用方据此跳过)', () => {
    expect(buildEmbedSource({})).toBe('');
    expect(buildEmbedSource({ visualAnchors: [] })).toBe('');
  });
  it('超长截断到 2000', () => {
    expect(buildEmbedSource({ description: 'A'.repeat(5000) }).length).toBeLessThanOrEqual(2000);
  });
});

describe('v12.2.2 · embedText(BYO 降级)', () => {
  it('MOCK_ENGINES=1 → 不打嵌入 API,返回 null', async () => {
    const prev = process.env.MOCK_ENGINES;
    process.env.MOCK_ENGINES = '1';
    try {
      expect(await embedText('林小满 银色长发')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = prev;
    }
  });
  it('空文本 → null(不调用)', async () => {
    expect(await embedText('')).toBeNull();
    expect(await embedText('   ')).toBeNull();
  });
  it('embedModel 默认 text-embedding-3-small,env 可覆盖', () => {
    const prev = process.env.OPENAI_EMBED_MODEL;
    delete process.env.OPENAI_EMBED_MODEL;
    expect(embedModel()).toBe('text-embedding-3-small');
    process.env.OPENAI_EMBED_MODEL = 'bge-m3';
    expect(embedModel()).toBe('bge-m3');
    if (prev === undefined) delete process.env.OPENAI_EMBED_MODEL; else process.env.OPENAI_EMBED_MODEL = prev;
  });
});
