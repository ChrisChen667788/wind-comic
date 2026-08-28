/**
 * v12.344:Ken Burns 占位片被当成真视频上报 —— 诚实标记造好了没接线。
 *
 * 实况:重跑 owner 素材时,MiniMax 标准版与 Fast 版额度先后耗尽(错误 2056),
 * 编排器按设计回落成 Ken Burns animatic(静止分镜图做缓推的真 mp4),并**如实**
 * 返回 `isAnimatic: true`。但路由的 `send('complete', ...)` 不带这个字段 ——
 * 标记到 API 边界就被丢掉,前端和重跑脚本都把占位片当成 AI 成片。
 *
 * 后果比"显示不准"更重:占位片也在盘上、也有 persistent_url,于是"断点续跑"
 * 会永久跳过它 —— 这一镜再也不会被重做。
 *
 * 锁行为:降级信息必须从编排器一路传到 complete 事件和资产 data。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROUTE = path.join(process.cwd(), 'app/api/projects/[id]/regenerate-shot/route.ts');
const src = fs.readFileSync(ROUTE, 'utf8');
/** 只看真实分支(文件里演示分支在前),避免窗口取错让断言恒真/恒假。 */
const realBranch = src.slice(src.indexOf('await orchestrator.regenerateShot'));

describe('v12.344 降级必须如实上报', () => {
  it('从编排器结果里读出 isAnimatic', () => {
    expect(realBranch).toMatch(/isAnimatic\?: boolean/);
    expect(realBranch).toMatch(/\.isAnimatic === true/);
  });

  it('complete 事件带 isAnimatic —— 否则调用方无从分辨', () => {
    const complete = realBranch.slice(realBranch.indexOf("send('complete'"));
    expect(complete).toMatch(/isAnimatic,/);
  });

  it('降级时附人话原因,不能只给个布尔量', () => {
    const complete = realBranch.slice(realBranch.indexOf("send('complete'"));
    expect(complete).toMatch(/degradedReason/);
    expect(complete).toMatch(/不是 AI 生成的视频/);
  });

  it('资产 data 也要记 —— 否则续跑会把占位片当成片永久跳过', () => {
    const upsert = realBranch.slice(realBranch.indexOf('await upsertAsset({'), realBranch.indexOf("send('complete'"));
    expect(upsert).toMatch(/isAnimatic,/);
  });

  it('回归:成功路径不得误标降级', () => {
    // isAnimatic 由严格相等推导,不能是 truthy 判断(undefined 也不该变 true)
    expect(realBranch).toMatch(/=== true/);
    expect(realBranch).not.toMatch(/isAnimatic = !!result/);
  });
});

describe('v12.344 重跑脚本必须认得占位片', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/rerun-project.mjs'), 'utf8');

  it('有判定 animatic 的函数', () => {
    expect(script).toMatch(/function isAnimaticRow/);
    expect(script).toMatch(/isAnimatic === true/);
  });

  it('续跑的跳过条件排除占位片', () => {
    // 「在盘上」不再是唯一跳过依据,必须同时不是占位片
    expect(script).toMatch(/onDisk\(row\.persistent_url\) && !isAnimaticRow\(row\)/);
  });

  it('查询取了 data 列 —— 否则 isAnimaticRow 永远读不到', () => {
    const win = script.slice(script.indexOf("type='video'") - 200, script.indexOf("type='video'") + 120);
    expect(win).toMatch(/SELECT persistent_url, data/);
  });

  it('出现占位片即停止本项目,不再空烧后续镜头', () => {
    expect(script).toMatch(/if \(r\.ok && animatic\)/);
    expect(script).toMatch(/break;/);
    expect(script).toMatch(/当日额度已耗尽/);
  });

  it('汇总里单列占位片数量,不混进「生成」', () => {
    expect(script).toMatch(/stat\.animatic\+\+/);
    expect(script).toMatch(/占位片 \$\{stat\.animatic\}/);
  });
});
