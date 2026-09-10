/**
 * v12.150 — 失败/降级镜头批量补渲:API 分支 + isAnimatic 落库 + 项目页按钮接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { isPlaceholderVideo } from '../lib/placeholder-provenance';

describe('v12.150 · 批量补渲', () => {
  it('API:failed-videos 分支(识别含 URL 兜底)+ 成功后自动重合成 + 原 stage 分支互斥', () => {
    const src = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(src).toContain("stage === 'failed-videos' && !shotNumber");
    // v12.430:识别逻辑已收进 lib/placeholder-provenance(此前这里、项目页、
    // film-health、export-audit 各一套,互不相认,造成实测漏报)。
    // 这里改**锁行为**:原来断言的是源码文本 `candidates.some((x) => /animatic-`,
    // 委托出去之后文本没了、行为还在,那条断言就只是在拦重构,不是在拦回归。
    expect(src).toContain('isPlaceholderVideo(');
    // v12.153 的要点必须保住:persistent_url 会被洗成 ?key=(无文件名特征),
    // 原始 media_urls 常保留 ?path=...animatic-<ts>.mp4 —— 两个都要测。
    expect(isPlaceholderVideo({
      data: {}, mediaUrls: ['/api/serve-file?path=%2FT%2Fqf-animatic-1783628843357%2Fanimatic-1.mp4'],
      persistentUrl: '/api/serve-file?key=washed',
    }), 'persistent_url 被洗掉文件名后,仍要能从 media_urls 认出降级片').toBe(true);
    expect(isPlaceholderVideo({ data: { isAnimatic: true }, mediaUrls: ['/api/serve-file?key=x'] })).toBe(true);
    expect(isPlaceholderVideo({ data: {}, mediaUrls: ['/api/serve-file?key=real'] }), '真视频不能误伤').toBe(false);
    // 「一个视频都没有」不归 isPlaceholderVideo 管,必须留在调用方 —— 否则这些镜
    // 会从补渲名单里静默消失。
    expect(src).toContain('candidates.every((x) => !x)');
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
    // v12.430:同上,识别已委托;这里锁「委托了」+「没丢掉无 URL 那一条」
    expect(ui).toContain('isPlaceholderVideo(v)');
    expect(ui, '「一个视频都没有」的镜不能从补渲名单消失').toContain('!v?.mediaUrls?.[0]');
    expect(ui).toContain('batchDone');
  });
});
