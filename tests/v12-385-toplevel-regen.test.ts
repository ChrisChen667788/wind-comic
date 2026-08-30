/**
 * v12.385:最高频的重生入口,一直是那条没人修的旁路。
 *
 * 有两个 regenerate-shot 端点:
 *   · `app/api/projects/[id]/regenerate-shot`  —— v12.343 加了落盘、v12.344 加了降级标记
 *   · `app/api/regenerate-shot`(顶层)        —— **两样都没跟上**
 * 而顶层那个才是 video-node / editor-node / review-node / pull-sheet-table
 * 点「重生此镜」的唯一调用点。
 *
 * ① **不落盘**:DB 里 media_urls 存引擎 CDN 外链、persistent_url 为 null。
 *    那种链接三五天就 403。owner 花真金白银重生一镜、看到「完成」,几天后视频消失;
 *    而下一次 recompose 的 fullUrl() 取的正是 media_urls[0] —— 自动重合成拿到死链。
 *
 * ② **单镜 SSE 不带 isAnimatic**:批量路径一直带着,单镜路径漏了。
 *    引擎全挂、回落 Ken Burns 占位片时,界面照样显示「重新生成完成!」加绿勾。
 *    而且前端 video-node 的 updateAsset 写的是一个**全新 data 对象**,
 *    会把资产上原有的 isAnimatic:true 一起抹掉 —— 只补路由是半修。
 *
 * 守这条的测试(v12-150)当时是**假绿**:`toContain('isAnimatic: !!result.isAnimatic')`
 * 而该串在文件里出现两次,命中批量路径就通过,单镜路径从没被验过。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const TOP = read('app/api/regenerate-shot/route.ts');
const PROJ = read('app/api/projects/[id]/regenerate-shot/route.ts');

/** 从某个调用点切到它的收尾 —— 用括号闭合而不是固定字符数 */
function callWindow(src: string, at: number, close = ');'): string {
  const end = src.indexOf(close, at);
  return end > at ? src.slice(at, end + close.length) : src.slice(at, at + 400);
}

describe('顶层重生入口:每一处落库都要落盘', () => {
  it('三个落库点(单镜 / 批量补渲 / 阶段重做)都写 persistentUrl', () => {
    const sites = [...TOP.matchAll(/await updateAssetBySelector\(/g)];
    expect(sites.length, '落库点数量变了,这条断言要重看').toBeGreaterThanOrEqual(3);
    for (const m of sites) {
      const win = callWindow(TOP, m.index!);
      expect(win, `落库点 @${m.index} 没写 persistentUrl —— 存的是会过期的外链`).toContain('persistentUrl');
    }
  });

  it('落盘走同一个辅助函数,而不是在一个文件里抄三遍', () => {
    expect(TOP).toContain('async function persistRegenerated');
    const calls = TOP.match(/persistRegenerated\(/g) || [];
    // 1 次定义 + 3 处调用
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it('落盘失败不阻塞重生 —— 外链能救几天,总比整镜白跑强', () => {
    const i = TOP.indexOf('async function persistRegenerated');
    const win = TOP.slice(i, i + 900);
    expect(win).toContain('catch');
    expect(win, '失败要留痕,不能静默').toMatch(/console\.warn/);
    expect(win, '失败返回 null 让调用方回退外链').toContain('return null');
  });

  it('与项目级路由行为一致(那条是先修好的)', () => {
    expect(PROJ).toContain('persistAsset');
    expect(TOP).toContain('persistAsset');
  });
});

describe('降级标记要一路带到人眼前', () => {
  it('**每一个** regenerateComplete 事件都带 isAnimatic —— 不点名某一处', () => {
    // 这条刻意写成遍历:v12-150 那版点名了一个串,而它在文件里出现两次,
    // 命中批量路径即绿。遍历式断言让新增的第三个分支也自动纳入。
    const sends = [...TOP.matchAll(/send\('regenerateComplete',\s*\{/g)];
    expect(sends.length, '单镜 + 批量,至少两处').toBeGreaterThanOrEqual(2);
    for (const m of sends) {
      const win = callWindow(TOP, m.index!, '});');
      expect(win, `regenerateComplete @${m.index} 不带 isAnimatic —— 占位片会被当成真视频`).toContain('isAnimatic');
    }
  });

  it('前端 store 更新保留原有 data,不用新对象覆盖掉 isAnimatic', () => {
    const src = read('components/nodes/video-node.tsx');
    const i = src.indexOf('st.updateAsset(videoAsset.id');
    expect(i).toBeGreaterThan(0);
    const win = src.slice(i, i + 700);
    expect(win, '写全新 data 对象会抹掉资产上已有的 isAnimatic').toMatch(/\.\.\.\(videoAsset\.data/);
    expect(win).toContain('isAnimatic');
  });

  it('项目页不再无条件报「补渲完成 ✅」', () => {
    const src = read('app/projects/[id]/page.tsx');
    const i = src.indexOf("ev.type === 'regenerateComplete'");
    expect(i).toBeGreaterThan(0);
    const win = src.slice(i, i + 500);
    expect(win, '降级时也报完成,正是 owner 最不该被瞒住的一刻').toContain('isAnimatic');
    expect(win).toMatch(/占位片/);
  });
});
