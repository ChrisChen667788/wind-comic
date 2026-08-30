/**
 * v12.286 — 视觉漂移检测接进主管线(此前只有手动端点会跑)。
 *
 * 病根:`detectDriftOutliers` 全仓**只被 `/api/projects/[id]/drift-check` 调用**,
 * 主管线一次都不跑 —— 用户必须自己想起来去点一下才知道哪镜跑偏了,
 * 等于这个能力对正常出片流程**不存在**。
 *
 * 默认零成本:`hasImageEmbeddingKey()` 要求显式配 `IMAGE_EMBED_MODEL`,没配就整段跳过,
 * 不给未开启的用户增加任何 API 调用或耗时。
 *
 * 诚实边界:本版只做**检测 + 落账 + 推送**,**不自动重生** ——
 * 自动重生要按漂移分反复重跑镜头,成本与失控风险都高,留给用户看到结果后自行决定。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { detectDriftOutliers } from '@/lib/drift-detect';

const SRC = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
const mk = (n: number, v: number[]) => ({ shotNumber: n, vector: v });

describe('v12.286 · 漂移算法判别力(接线前先证明核心可靠)', () => {
  it('单镜跑偏能被单独揪出,分数与其余拉开量级', () => {
    const r = detectDriftOutliers([
      mk(1, [1, 0, 0]), mk(2, [0.98, 0.02, 0]), mk(3, [0.97, 0.03, 0]),
      mk(4, [0.99, 0.01, 0]), mk(5, [0.96, 0.04, 0]),
      mk(6, [0, 1, 0]), // 明显跑偏
    ]);
    expect(r.available).toBe(true);
    expect(r.outliers).toContain(6);
    expect(r.outliers).not.toContain(1);
    const s6 = r.scores.find((s) => s.shotNumber === 6)!.driftScore;
    const s1 = r.scores.find((s) => s.shotNumber === 1)!.driftScore;
    expect(s6).toBeGreaterThan(s1 * 3); // 量级差,不是勉强超阈值
  });

  it('全片一致 → 不误报', () => {
    const r = detectDriftOutliers([mk(1, [1, 0, 0]), mk(2, [0.99, 0.01, 0]), mk(3, [0.98, 0.02, 0])]);
    expect(r.available).toBe(true);
    expect(r.outliers).toEqual([]);
  });

  it('样本不足(<2)→ available=false,调用方据此退回 LLM 评分', () => {
    expect(detectDriftOutliers([mk(1, [1, 0, 0])]).available).toBe(false);
    expect(detectDriftOutliers([]).available).toBe(false);
  });

  it('缺向量的镜被跳过而非算成 0 向量(否则会假装它极度漂移)', () => {
    const r = detectDriftOutliers([
      mk(1, [1, 0, 0]), mk(2, [0.99, 0.01, 0]),
      { shotNumber: 3, vector: [] } as any,
    ]);
    expect(r.scores.map((s) => s.shotNumber)).not.toContain(3);
  });
});

describe('v12.286 · 主管线接线', () => {
  it('渲染完成后跑漂移检测(此前只有手动端点会跑)', () => {
    expect(SRC).toContain('detectDriftOutliers');
    expect(SRC).toContain("import('@/lib/drift-detect')");
    // 必须在分镜渲染函数里,不是别处
    const i = SRC.indexOf('async runStoryboardRenderer');
    const j = SRC.indexOf('detectDriftOutliers', i);
    expect(j, '漂移检测应在 runStoryboardRenderer 内').toBeGreaterThan(i);
  });

  it('默认零成本:必须先过 hasImageEmbeddingKey 闸门', () => {
    // 定位**真调用**(detectDriftOutliers(embeddings)),而不是注释里的首次提及 ——
    // 早先用 indexOf('detectDriftOutliers') 命中的是说明文字,窗口自然找不到闸门。
    const i = SRC.indexOf('detectDriftOutliers(embeddings)');
    expect(i, '应有真调用').toBeGreaterThan(0);
    const block = SRC.slice(Math.max(0, i - 1200), i);
    expect(block).toContain('hasImageEmbeddingKey()');
    expect(block).toMatch(/rendered\.length >= 2/); // 样本不足不白跑嵌入
  });

  it('结果落账 + 推送前端(不是算完就丢)', () => {
    expect(SRC).toContain("this.emit('driftCheck'");
    expect(SRC).toContain('this.driftReport = drift');
    expect(SRC).toContain("kind: 'visual-drift'");
  });

  it('失败不阻塞出片(漂移检测是增强项)', () => {
    const i = SRC.indexOf("console.warn('[Drift]");
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i - 200, i + 120)).toContain('非阻塞');
  });

  it('诚实边界:本版**不**自动重生,注释写明原因', () => {
    const i = SRC.indexOf('v12.286:视觉漂移检测接进主管线');
    const block = SRC.slice(i, i + 900);
    expect(block).toMatch(/不自动重生/);
    expect(block).toMatch(/成本与失控风险/);
    // 也不该偷偷调重生
    const _segEnd = SRC.indexOf('return rendered;', i);
    expect(_segEnd, '找不到窗口右界,slice(i, -1) 切出来的不是想验的东西').toBeGreaterThan(i);
    const seg = SRC.slice(i, _segEnd);
    expect(seg, '窗口自证').toContain('漂移');
    expect(seg).not.toMatch(/regenerateShot\(|regenerate\(/);
  });
});
