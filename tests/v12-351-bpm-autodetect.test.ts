/**
 * v12.351:MV 的 BPM 自动检测 —— 检测函数从 v12.246 就在,页面却一直让用户自己数拍子。
 *
 * `lib/beat-detect.detectBeats`(ffmpeg silencedetect)早就能拿到拍点序列,
 * 但 `app/dashboard/mv` 里是 `useState(120)` + 一个手填数字框。**造好了没接线**。
 *
 * 补的是「拍点 → BPM」这一段纯函数,里面有两个坑不是「取平均」能绕过的:
 * ① 必须取**中位数** —— silencedetect 会漏拍,漏一拍就产生双倍长间隔,平均值被拉偏;
 * ② **半速/倍速歧义** —— 只在重拍触发时测出的是真实 BPM 的一半,所以要折算进常用区间。
 *
 * 正确性用**已知真值**验证过:ffmpeg 造一条每 0.5s 一拍(=120 BPM)的 12s 节拍轨,
 * 检测到 24 个拍点、推算 120 BPM、齐整度 100%。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { bpmFromBeats, beatGridFromBpm } from '@/lib/beat-detect';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.351 拍点 → BPM(纯函数)', () => {
  it('等间隔 0.5s → 120 BPM', () => {
    const beats = Array.from({ length: 24 }, (_, i) => (i + 1) * 0.5);
    const r = bpmFromBeats(beats)!;
    expect(r.bpm).toBe(120);
    expect(r.confidence).toBe(1);
  });

  it('**漏拍不该带偏结果** —— 取中位数而不是平均', () => {
    // 每 0.5s 一拍,中间漏掉两拍(出现两个 1.0s 的间隔)
    const beats = [0.5, 1.0, 1.5, 2.5, 3.0, 3.5, 4.0, 5.0, 5.5, 6.0];
    const r = bpmFromBeats(beats)!;
    expect(r.bpm).toBe(120);          // 中位数仍是 0.5
    expect(r.confidence).toBeLessThan(1);   // 但齐整度要如实下降
  });

  it('半速歧义:2s 一拍(30 BPM)折算进常用区间', () => {
    const beats = Array.from({ length: 8 }, (_, i) => (i + 1) * 2);
    const r = bpmFromBeats(beats)!;
    expect(r.bpm).toBeGreaterThanOrEqual(70);
    expect(r.bpm).toBeLessThanOrEqual(170);
    expect(r.bpm).toBe(120);          // 30 → ×2 ×2 = 120
  });

  it('倍速歧义:0.2s 一拍(300 BPM)同样折算', () => {
    const beats = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.2);
    const r = bpmFromBeats(beats)!;
    expect(r.bpm).toBe(150);          // 300 ÷ 2
  });

  it('拍点不足 4 个 → **返回 null,不猜**(与本仓既有约定一致)', () => {
    expect(bpmFromBeats([1, 2, 3])).toBeNull();
    expect(bpmFromBeats([])).toBeNull();
    expect(bpmFromBeats(null)).toBeNull();
  });

  it('超长静音间隔被掐掉,不当拍算', () => {
    const beats = [0.5, 1.0, 1.5, 2.0, 30.0, 30.5, 31.0];   // 中间 28s 静音
    const r = bpmFromBeats(beats)!;
    expect(r.bpm).toBe(120);
  });

  it('齐整度反映真实散乱程度', () => {
    const tidy = bpmFromBeats(Array.from({ length: 20 }, (_, i) => (i + 1) * 0.5))!;
    const messy = bpmFromBeats([0.5, 1.1, 1.4, 2.2, 2.5, 3.4, 3.7, 4.1])!;
    expect(tidy.confidence).toBeGreaterThan(messy.confidence);
  });

  it('与既有 beatGridFromBpm 自洽:测出的 BPM 生成的网格应贴合原拍点', () => {
    const beats = Array.from({ length: 16 }, (_, i) => (i + 1) * 0.5);
    const grid = beatGridFromBpm(bpmFromBeats(beats)!.bpm, 8);
    expect(grid.length).toBeGreaterThan(10);
    expect(Math.abs(grid[0] - 0.5)).toBeLessThan(0.01);
  });
});

describe('v12.351 端点', () => {
  const R = read('app/api/mv/detect-bpm/route.ts');

  it('要求登录', () => {
    expect(R).toMatch(/getUserFromRequest/);
    expect(R).toMatch(/status: 401/);
  });

  it('**只接受本仓存储内的文件** —— 否则就成了任意文件探测器', () => {
    expect(R).toMatch(/resolveByKey/);
    expect(R).toMatch(/isServeFilePathAllowed/);
    expect(R).toMatch(/任意文件探测器/);
  });

  it('测不出返回 409 + 原因,不编一个数出来', () => {
    expect(R).toMatch(/status: 409/);
    expect(R).toMatch(/测不出可靠 BPM/);
  });

  it('低置信度要显式提示,不是给个数字了事', () => {
    expect(R).toMatch(/confidence < 0\.6/);
    expect(R).toMatch(/仅供参考/);
  });
});

describe('v12.351 MV 页面接线', () => {
  const UI = read('app/dashboard/mv/page.tsx');

  it('有自动检测按钮', () => {
    expect(UI).toMatch(/data-testid="detect-bpm"/);
  });

  it('没填配乐时禁用(避免空跑)', () => {
    expect(UI).toMatch(/disabled=\{bpmBusy \|\| !musicUrl\.trim\(\)\}/);
  });

  it('**手填仍然保留** —— 自动检测是补充不是替代', () => {
    expect(UI).toMatch(/onChange=\{e => setBpm\(Number\(e\.target\.value\)\)\}/);
  });

  it('结果与失败原因都要显示给用户', () => {
    const win = UI.slice(UI.indexOf('const detectBpm'), UI.indexOf('const plan = async'));
    expect(win).toMatch(/setBpmNote\(j\?\.reason/);
    expect(win).toMatch(/齐整度/);
    expect(win).toMatch(/请手动填写/);
  });

  it('进行中禁用并在 finally 复位', () => {
    const win = UI.slice(UI.indexOf('const detectBpm'), UI.indexOf('const plan = async'));
    expect(win).toMatch(/setBpmBusy\(true\)/);
    expect(win).toMatch(/finally \{[\s\S]{0,50}setBpmBusy\(false\)/);
  });
});
