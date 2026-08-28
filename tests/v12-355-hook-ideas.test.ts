/**
 * v12.355:开场钩子接线 —— 端点从 v12.86 就在,前端零引用。
 *
 * 接线扫描(184 端点 → 12 个零引用)里的第三条。钩子是「投出去会不会被划走」的
 * 第一决定因素,而它的产物正好是 `recompose` 的 `hookVariants` 输入,可直接做 A/B。
 * 所以放在分发面板,不放创作页。
 *
 * 同批扫出的 `director-review` **本版未接** —— 它是 SSE 流式端点,复杂度高一档,
 * 与这条按钮式交互不同,硬塞进来会做成半吊子。如实记为后续项,不假装一起做了。
 *
 * 实测(《月挂不下来》):deepseek-chat-v3.1 产出 5 条,如「嫂子深夜敲门所为何事？」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const UI = fs.readFileSync(path.join(process.cwd(), 'components/project/distribution-panel.tsx'), 'utf8');
const WIN = UI.slice(UI.indexOf('async function loadHooks'), UI.indexOf('async function doReframe'));

describe('v12.355 开场钩子接线', () => {
  it('确实调了 hook-ideas', () => {
    expect(WIN).toMatch(/\/hook-ideas/);
    expect(WIN).toMatch(/method: 'POST'/);
  });

  it('端点的可执行提示原样转达(「项目缺 plan/script」不能变成「操作失败」)', () => {
    expect(WIN).toMatch(/setHooksErr\(j\?\.message/);
  });

  it('**返回形态兼容字符串与 {title}** —— 端点 hint 说它可直接作 hookVariants:[{title}]', () => {
    expect(WIN).toMatch(/typeof h === 'string' \? h :/);
    expect(WIN).toMatch(/\.title/);
  });

  it('空列表要明说,不留一个空白区让人以为在加载', () => {
    expect(WIN).toMatch(/if \(!list\.length\)/);
    expect(WIN).toContain('返回为空');
  });

  it('失败有 role=alert,不是只 console', () => {
    expect(UI).toMatch(/\{hooksErr && <p role="alert"/);
  });

  it('进行中禁用并在 finally 复位', () => {
    expect(UI).toMatch(/disabled=\{hooksBusy\}/);
    expect(WIN).toMatch(/finally \{[\s\S]{0,50}setHooksBusy\(false\)/);
  });

  it('复用面板已有的复制助手,不另写一套', () => {
    expect(UI).toMatch(/copy\(h, `hook-\$\{i\}`\)/);
    expect(UI).toMatch(/copiedKey === `hook-\$\{i\}`/);
  });

  it('按钮文案随状态变化(首次「生成 5 条」/ 之后「换一批」)', () => {
    expect(UI).toContain("hooks.length ? '换一批' : '生成 5 条'");
  });

  it('说明写清用途 —— 用户要知道拿它干什么', () => {
    expect(UI).toContain('可直接作 A/B 变体投放对比');
  });

  it('有 testid 便于 e2e 定位', () => {
    expect(UI).toMatch(/data-testid="hook-ideas"/);
    expect(UI).toMatch(/data-testid="hook-list"/);
  });
});
