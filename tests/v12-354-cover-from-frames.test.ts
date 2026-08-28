/**
 * v12.354:成片抽帧做封面接线 —— 端点从 v12.113 就在,前端零引用。
 *
 * 为什么这条值得先接:它**不消耗任何 T2I 额度** —— 直接从已合成的成片里抽帧、
 * VLM 打分排序。owner 眼下的处境正是图像/视频额度都紧张,这时候它是唯一还能出封面的路。
 *
 * 按钮位置是有意的:放在「生成封面候选」**左边**。额度紧张时它才是该先点的那个,
 * 藏在主按钮后面等于没接。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const UI = fs.readFileSync(path.join(process.cwd(), 'components/project/cover-candidates-panel.tsx'), 'utf8');

describe('v12.354 抽帧封面接线', () => {
  it('确实调了 covers/from-frames', () => {
    expect(UI).toMatch(/covers\/from-frames/);
  });

  it('按钮在主生成按钮之前 —— 额度紧张时它该先被看到', () => {
    const iFrames = UI.indexOf('data-testid="cover-from-frames"');
    const iGen = UI.indexOf('onClick={generate}');
    expect(iFrames).toBeGreaterThan(-1);
    expect(iFrames).toBeLessThan(iGen);
  });

  it('按钮文案点明「不耗额度」—— 这是它存在的理由', () => {
    expect(UI).toContain('从成片抽帧(不耗额度)');
    expect(UI).toMatch(/不消耗图像额度/);
  });

  it('**VLM 全挂时如实说没排过序**,不让用户以为这是精选结果', () => {
    expect(UI).toMatch(/c\.scored/);
    expect(UI).toContain('评分引擎不可用,按时间顺序排列');
    expect(UI).toContain('已按画面质量排序');
  });

  it('端点的可执行提示原样转达(「先合成再精选封面」不能被换成「操作失败」)', () => {
    const win = UI.slice(UI.indexOf('async function pickFromFrames'), UI.indexOf('const hasImages'));
    expect(win).toMatch(/setErr\(d\?\.error/);
  });

  it('两个按钮互斥禁用 —— 同时点会互相覆盖候选集', () => {
    expect(UI).toMatch(/disabled=\{fromFrames \|\| loading\}/);
    expect(UI).toMatch(/disabled=\{loading \|\| fromFrames\}/);
  });

  it('进行中有转圈,结束在 finally 复位', () => {
    const win = UI.slice(UI.indexOf('async function pickFromFrames'), UI.indexOf('const hasImages'));
    expect(win).toMatch(/finally \{[\s\S]{0,50}setFromFrames\(false\)/);
    expect(UI).toMatch(/\{fromFrames \? <CircleNotch/);
  });

  it('结果说明用 role=status', () => {
    expect(UI).toMatch(/\{framesNote && \([\s\S]{0,120}role="status"/);
  });

  it('复用既有的安全区/候选渲染,不另起一套(同一语义两份实现是本仓老毛病)', () => {
    const win = UI.slice(UI.indexOf('async function pickFromFrames'), UI.indexOf('const hasImages'));
    expect(win).toMatch(/setCandidates\(d\.candidates/);
    expect(win).toMatch(/setSafeArea\(d\.safeArea\)/);
  });
});
