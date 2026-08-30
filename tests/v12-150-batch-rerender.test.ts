/**
 * v12.150 — 失败/降级镜头批量补渲:API 分支 + isAnimatic 落库 + 项目页按钮接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.150 · 批量补渲', () => {
  it('API:failed-videos 分支(识别含 URL 兜底)+ 成功后自动重合成 + 原 stage 分支互斥', () => {
    const src = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(src).toContain("stage === 'failed-videos' && !shotNumber");
    expect(src).toContain('candidates.some((x) => /animatic-'); // v12.153 修正:双 URL 测(persistent_url 被洗成 ?key= 后仍认得出)
    expect(src).toContain("send('batchDone'");
    expect(src).toContain('runEditor(freshVideos, scriptData)');
    expect(src).toContain("stage !== 'failed-videos'"); // 不落进旧阶段分支
    // v12.385 修订:这条原来是 `toContain('isAnimatic: !!result.isAnimatic')`,
    // 而该串在本文件出现两次(批量路径的落库 + 批量路径的 SSE)——
    // 断言命中批量路径就通过了,**单镜路径从没被验过**,而单镜路径当时确实漏了。
    // 一条命中即绿的 toContain,保护的是它碰巧撞上的那一处,不是它想保护的那件事。
    // 改为遍历:**每一处**落库都要如实存降级标记,新增分支自动纳入。
    {
      const sites = [...src.matchAll(/updateAssetBySelector\(/g)];
      expect(sites.length, '落库点少于 3 处,说明路由结构变了,这条断言要重看').toBeGreaterThanOrEqual(3);
      for (const m of sites) {
        const win = src.slice(m.index!, src.indexOf(');', m.index!) + 2);
        expect(win, `落库点 @${m.index} 没有如实存 isAnimatic`).toMatch(/isAnimatic|persistentUrl/);
      }
    }
  });
  it('落库:create-pipeline 视频资产带 isAnimatic', () => {
    expect(fs.readFileSync('lib/create-pipeline.ts', 'utf-8')).toContain('isAnimatic: !!(v as any).isAnimatic');
  });
  it('项目页:降级镜识别(标记/无URL/animatic文件名)+ SSE 进度 + 完成重拉', () => {
    const ui = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(ui).toContain("stage: 'failed-videos'");
    expect(ui).toContain('batch-rerender-bar');
    expect(ui).toContain('animatic-');
    expect(ui).toContain('batchDone');
  });
});
