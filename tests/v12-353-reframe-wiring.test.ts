/**
 * v12.353:改画幅接线 —— 端点从 v12.16 就在,**前端零引用**。
 *
 * 这是本轮「造好没接线」全仓扫描(184 个端点 → 12 个前端零引用)里最该先接的一条:
 * 竖屏短剧要投 B站/YouTube 就得有横屏版,而它**不重新生成每一镜**、直接把已合成的
 * 成片重构图 —— 对用户是「一次成片、两个平台都能投」,成本几乎为零。
 *
 * 放在分发面板而不是监看台:平台画幅要求是分发时才关心的事(抖音 9:16、B站 16:9)。
 *
 * 实测时顺手撞到并修了一件事:成片文件丢失时,原错误是
 * `serve-file path not found: /api/serve-file?key=…` —— 内部术语,用户看了不知道
 * 该干什么。**报错的价值在于告诉人下一步做什么。**
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const ROUTE = read('app/api/projects/[id]/reframe/route.ts');
const UI = read('components/project/distribution-panel.tsx');

describe('v12.353 报错可执行化', () => {
  it('源文件丢失时说人话,并给出下一步', () => {
    expect(ROUTE).toMatch(/成片的本地文件已丢失/);
    expect(ROUTE).toMatch(/需要重新合成后再改画幅/);
  });

  it('用机器可判的 code 区分这一类,便于前端特判', () => {
    expect(ROUTE).toMatch(/code: 'source_missing'/);
  });

  it('识别条件覆盖三种常见原文(不只匹配一种拼法)', () => {
    expect(ROUTE).toMatch(/path not found\|ENOENT\|no such file/);
  });

  it('非「文件丢失」类错误仍原样透出,不被一刀切吞掉', () => {
    const win = ROUTE.slice(ROUTE.indexOf('const missing ='));
    expect(win).toMatch(/'重构图失败: ' \+ raw/);
  });
});

describe('v12.353 前端接线', () => {
  it('两个方向都有按钮', () => {
    expect(UI).toMatch(/data-testid="reframe-169"/);
    expect(UI).toMatch(/data-testid="reframe-916"/);
  });

  it('模式可选,且把两种模式的代价说清楚', () => {
    expect(UI).toMatch(/data-testid="reframe-mode"/);
    // 字面量断言用 toContain,不用正则 —— 括号在正则里是捕获组,
    // 写成 /模糊填边(画面完整)/ 匹配的是「模糊填边画面完整」,恒不成立。
    expect(UI).toContain('模糊填边(画面完整)');
    expect(UI).toContain('裁切填满(会切掉边缘)');
  });

  it('**端点的可执行提示要原样转达**,不能被前端换成「操作失败」', () => {
    const win = UI.slice(UI.indexOf('async function doReframe'), UI.indexOf('async function doReframe') + 1200);
    expect(win).toMatch(/setReframeNote\(j\?\.error/);
  });

  it('生成中禁用两个按钮(共用一个 reframing 状态)', () => {
    expect(UI).toMatch(/disabled=\{!!reframing\}/);
    const win = UI.slice(UI.indexOf('async function doReframe'), UI.indexOf('async function doReframe') + 1200);
    expect(win).toMatch(/finally \{[\s\S]{0,50}setReframing\(''\)/);
  });

  it('成功后给出可点开的产物链接', () => {
    expect(UI).toMatch(/setReframeUrl\(j\.videoUrl/);
    expect(UI).toMatch(/href=\{reframeUrl\}/);
  });

  it('结果用 role=status 播报', () => {
    const win = UI.slice(UI.indexOf('改画幅 · 一片两投'));
    expect(win).toMatch(/role="status"/);
  });

  it('明说「不重新生成每一镜」—— 这是用户决定要不要点的关键信息', () => {
    expect(UI).toMatch(/不重新生成每一镜/);
  });
});
