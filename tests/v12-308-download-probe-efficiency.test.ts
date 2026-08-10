/**
 * v12.308 — 合成前的下载与探测:串行 + 重复探测。
 *
 * 缺口审计的两条性能项,**落在同一个循环里**,分两版改会动同一段代码两次,故合并为一版
 *(计划因此从 15 项变 14 项,如实记下,不假装还是 15)。
 *
 * **① 串行下载。** `for` 里 `await downloadFile` 逐个阻塞下一个。6 个片段各 2-5MB,
 *    串行约 25-35s —— 而这些 CDN URL 彼此完全独立。改为并发(上限 4:再高对家用带宽无益,
 *    且同时开太多 ffprobe 子进程反而互相拖)。
 *
 * **② 重复探测。** `probeVideoIntegrity` **已经返回 `durationSec`**,却只取了 `.ok` 把时长丢掉,
 *    随后第 3 步又对同一批本地文件跑一遍 `getVideoDuration`(内部还是一次 ffprobe)。
 *    等于每个片段白探一次,6 镜多花 3-6s 本机 CPU/IO。
 *
 * 并发改造最容易出的事故是**镜序错乱** —— 完成顺序是乱的,若按完成顺序 push,
 * 整片镜头次序就乱了。所以结果先按原始下标落位,再按序装配(下面重点锁这条)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = strip(fs.readFileSync('services/video-composer.ts', 'utf-8'));

describe('v12.308 · 并发下载', () => {
  it('不再是「for 里 await downloadFile」的串行结构', () => {
    expect(SRC, '串行下载必须消失').not.toMatch(/for \(let i = 0; i < clips\.length; i\+\+\)[\s\S]{0,400}await downloadFile/);
  });

  it('用有上限的并发批次(不是一把梭全开)', () => {
    expect(SRC).toContain('DL_CONCURRENCY');
    expect(SRC).toMatch(/await Promise\.all\(tasks\.slice\(start, start \+ DL_CONCURRENCY\)/);
  });

  it('**结果按原始下标落位**,不按完成顺序 —— 否则整片镜序会乱', () => {
    expect(SRC).toMatch(/probed\[i\] = \{ path: localPath, clip, durationSec: integ\.durationSec \}/);
    // 装配阶段按 probed 的下标顺序遍历
    const i = SRC.indexOf('for (const r of probed)');
    expect(i, '缺按序装配').toBeGreaterThan(0);
    const block = SRC.slice(i, i + 300);
    expect(block).toContain('localClips.push(r.path)');
    expect(block).toContain('validClips.push(r.clip)');
  });

  it('进度回调按完成数而不是下标(并发下下标顺序无意义)', () => {
    expect(SRC).toContain('doneCount++');
    expect(SRC).toMatch(/doneCount \/ clips\.length/);
  });

  it('单个片段失败仍只跳过它自己,不带崩整批', () => {
    const i = SRC.indexOf('const tasks = clips.map');
    const block = SRC.slice(i, i + 1600);
    expect(block).toContain('catch (e)');
    expect(block).toContain('Failed to download clip');
    // 坏片仍旧被删除并跳过
    expect(block).toContain('fs.unlinkSync(localPath)');
  });
});

describe('v12.308 · 复用探测结果,不再白跑一遍 ffprobe', () => {
  it('完整性探测的 durationSec 被留下来了(此前只取 .ok)', () => {
    expect(SRC).toContain('durationSec: integ.durationSec');
    expect(SRC).toContain('probedDurations');
  });

  it('时长优先用缓存,缺失才补探测', () => {
    const i = SRC.indexOf('const durations: number[] = [];');
    const block = SRC.slice(i, i + 700);
    expect(block).toContain('const cached = probedDurations[i]');
    expect(block, '缓存命中直接用,不再 ffprobe').toMatch(/durations\.push\(cached\); continue;/);
    expect(block, '兜底路径要保留').toContain('getVideoDuration(localClips[i])');
  });

  it('探测函数本来就返回时长(证明这不是新加的能力,是白丢的)', () => {
    const i = SRC.indexOf('export async function probeVideoIntegrity');
    expect(SRC.slice(i, i + 240)).toContain('durationSec?: number');
  });

  it('兜底值仍是 8s(零回归:探测失败时行为与旧版一致)', () => {
    const i = SRC.indexOf('const durations: number[] = [];');
    expect(SRC.slice(i, i + 700)).toMatch(/durations\.push\(8\)/);
  });
});

describe('v12.308 · 行为对照:乱序完成不得打乱镜序', () => {
  /** 复刻本版的装配逻辑:结果按原始下标落位,再按序收集 */
  async function assembleIndexed(items: string[], finishDelay: (i: number) => number) {
    const probed = new Array<string | null>(items.length).fill(null);
    await Promise.all(items.map(async (v, i) => {
      await new Promise((r) => setTimeout(r, finishDelay(i)));
      probed[i] = v;
    }));
    return probed.filter((x): x is string => x !== null);
  }

  /** 复刻「按完成顺序 push」的错误写法 */
  async function assembleByCompletion(items: string[], finishDelay: (i: number) => number) {
    const out: string[] = [];
    await Promise.all(items.map(async (v, i) => {
      await new Promise((r) => setTimeout(r, finishDelay(i)));
      out.push(v);
    }));
    return out;
  }

  const SHOTS = ['镜1', '镜2', '镜3', '镜4'];
  /** 故意让后面的先完成 */
  const reverseSpeed = (i: number) => (SHOTS.length - i) * 8;

  it('对照:按完成顺序 push 会把镜序彻底打乱', async () => {
    const got = await assembleByCompletion(SHOTS, reverseSpeed);
    expect(got).not.toEqual(SHOTS);
    expect(got[0], '最后一镜跑到了最前面').toBe('镜4');
  });

  it('**按原始下标落位:无论谁先完成,镜序恒定**', async () => {
    for (const delay of [reverseSpeed, () => 0, (i: number) => (i % 2 ? 20 : 1)]) {
      expect(await assembleIndexed(SHOTS, delay)).toEqual(SHOTS);
    }
  });

  it('中间有片段失败(落位为 null)时,其余镜序仍正确且不留空洞', async () => {
    const probed: Array<string | null> = ['镜1', null, '镜3', null, '镜5'];
    expect(probed.filter((x): x is string => x !== null)).toEqual(['镜1', '镜3', '镜5']);
  });

  it('时长数组与镜头数组必须同序同长(错位会让每镜用到别人的时长)', () => {
    const probed = [{ p: 'a', d: 3 }, null, { p: 'c', d: 5 }] as Array<{ p: string; d: number } | null>;
    const paths: string[] = [], durs: number[] = [];
    for (const r of probed) { if (!r) continue; paths.push(r.p); durs.push(r.d); }
    expect(paths).toEqual(['a', 'c']);
    expect(durs).toEqual([3, 5]);
    expect(paths.length).toBe(durs.length);
  });
});
