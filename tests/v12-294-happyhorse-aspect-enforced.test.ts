/**
 * v12.294 — HappyHorse 画幅:从「文档里诚实」变成「代码里强制」。
 *
 * **先纠正 v12.272 自己的病因判断。** 那版注释写的是「传 size:'9:16' 未被网关采纳」,
 * 方向偏了。2026-08-09 实测:
 *
 *   传 `size: 'ZZZ_INVALID_PROBE'`  →  HTTP 200,照常建任务
 *
 * **上游根本不校验 `size`** —— 传它不认识的值不报错,而是静默回落默认画幅。
 * 所以传 `'9:16'` 等于什么都没传。不是网关吞了参数,是参数格式不对且上游保持沉默。
 *
 * 同时发现任务结果里有 `usage` 块,**上游自报实际采用的画幅**:
 *   `{"usage": {"SR": 1080, "ratio": "16:9", ...}, "output": {...}}`
 * 基线实测:非法 size → `ratio "16:9" / SR 1080`。核对画幅不必再下载视频量分辨率。
 *
 * 未确证不等于可以装作没事:v12.272 把限制只写进 README(documented 但不 enforced),
 * 竖屏项目照样被路由过来、静默拿到横屏素材。v12.294 把它变成引擎链的硬门禁。
 *
 * ── v12.295:病根查到底了 ──────────────────────────────────────────
 * 四个候选(size:'720*1280' / ratio / aspect_ratio / 三管齐下)串行重试约 88 分钟,
 * 上游通道全程 429,一个任务都没建成 —— 实测这条路走不通。改查**官方 API 文档**
 *(help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference),真相是:
 *
 *   **上游根本没有 `size` 这个参数。** parameters 只有
 *   `resolution`(480P/720P/1080P,默认 1080P)、`ratio`(16:9 默认 / 9:16 / 1:1 / 4:3 / 3:4 / 4:5 / 5:4 / 9:21 / 21:9)、
 *   `duration`、`watermark`、`seed`。
 *
 * 我们从 v12.272 起一直在发一个**不存在的字段**,而上游对不认识的字段不报错、静默忽略。
 * 实测响应里的 `usage: {"SR": 1080, "ratio": "16:9"}` 正是 resolution 与 ratio 的回显 —— 早就摆在眼前。
 *
 * 顺带炸出一个没人注意到的问题:**`watermark` 默认 true**,右下角固定打「Happy Horse」水印
 *(那条探测视频的文件名就是 `..._refiner_watermark.mp4`)。出片素材现在默认关掉。
 *
 * 门禁规则相应放宽:认全部文档取值,但**实测打脸即在本进程内停用该比例**,不再一镜一镜白烧。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  happyHorseAspectSupported,
  reportedHappyHorseAspect,
  happyHorseVisualParams,
  markHappyHorseRatioBroken,
  _resetHappyHorseRatioState,
} from '@/services/happyhorse.service';

const ORCH = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
const SVC = fs.readFileSync('services/happyhorse.service.ts', 'utf-8');

// v12.295 改写:v12.294 的规则是「只认实测确证过的 16:9」—— 那是**在不知道正确参数时**的保守做法。
// 查证官方文档后确认正确字段是 `ratio`(而非我们一直在发的、根本不存在的 `size`),
// 于是规则改为「认全部文档取值,但实测打脸就当场停用那个比例」。
describe('v12.295 · 画幅门禁:认文档取值 + 打脸即停用', () => {
  beforeEach(() => _resetHappyHorseRatioState());

  it('官方文档列出的比例全部放行', () => {
    for (const a of ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9']) {
      expect(happyHorseAspectSupported(a), `${a} 是文档取值却被拦`).toBe(true);
    }
  });

  it('文档没列的比例仍然拦下(不瞎传)', () => {
    for (const a of ['2:1', '16:10', 'portrait', '720*1280']) {
      expect(happyHorseAspectSupported(a), `${a} 不是合法取值`).toBe(false);
    }
  });

  it('没指定画幅 → 用上游默认,不拦', () => {
    expect(happyHorseAspectSupported(undefined)).toBe(true);
    expect(happyHorseAspectSupported('')).toBe(true);
  });

  it('**实测打脸后,该比例本进程内停用**(不再一镜一镜白烧)', () => {
    expect(happyHorseAspectSupported('9:16')).toBe(true);
    markHappyHorseRatioBroken('9:16');
    expect(happyHorseAspectSupported('9:16')).toBe(false);
    expect(happyHorseAspectSupported('16:9'), '只停用出问题的那个比例').toBe(true);
  });
});

describe('v12.295 · 按官方规格拼参数', () => {
  it('画幅走 ratio;不再发不存在的 size / aspect_ratio', () => {
    const p = happyHorseVisualParams('9:16', {});
    expect(p.ratio).toBe('9:16');
    expect(p.size).toBeUndefined();
    expect(p.aspect_ratio).toBeUndefined();
  });

  it('**默认关水印** —— 上游默认 true,右下角固定打「Happy Horse」', () => {
    expect(happyHorseVisualParams('16:9', {}).watermark).toBe(false);
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_WATERMARK: '1' }).watermark).toBe(true);
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_WATERMARK: 'true' }).watermark).toBe(true);
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_WATERMARK: '0' }).watermark).toBe(false);
  });

  it('resolution 只认文档档位,乱填不发', () => {
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_RESOLUTION: '720p' }).resolution).toBe('720P');
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_RESOLUTION: '4K' }).resolution).toBeUndefined();
    expect(happyHorseVisualParams('16:9', {}).resolution, '不设则用上游默认').toBeUndefined();
  });

  it('seed 越界不发(上游范围 0..2147483647)', () => {
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_SEED: '42' }).seed).toBe(42);
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_SEED: '-1' }).seed).toBeUndefined();
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_SEED: '2147483648' }).seed).toBeUndefined();
    expect(happyHorseVisualParams('16:9', { HAPPYHORSE_SEED: 'abc' }).seed).toBeUndefined();
  });

  it('非法比例不塞进请求(交给门禁拦,这里不兜底瞎发)', () => {
    expect(happyHorseVisualParams('2:1', {}).ratio).toBeUndefined();
  });
});

describe('v12.294 · 引擎链真的会跳过(不是只写在文档里)', () => {
  it('登记 happyhorse 前先过画幅门禁', () => {
    const i = ORCH.indexOf("availableEngines.push('happyhorse')");
    expect(i, '未找到登记点').toBeGreaterThan(0);
    // 往前找同一段里的门禁调用
    const before = ORCH.slice(Math.max(0, i - 700), i);
    expect(before, '登记前没有画幅判断 —— 门禁没接上').toContain('happyHorseAspectSupported');
  });

  it('门禁函数确实被 import(而不是同名局部变量)', () => {
    expect(ORCH).toMatch(/import \{[^}]*happyHorseAspectSupported[^}]*\} from '@\/services\/happyhorse\.service'/);
  });

  it('跳过时要说明原因,不能静默消失', () => {
    // 锚真实调用点,不能锚 import 行(第一次写就锚错了,测试当场红)
    const i = ORCH.indexOf('if (happyHorseAspectSupported(');
    expect(i, '未找到门禁调用点').toBeGreaterThan(0);
    const block = ORCH.slice(i, i + 600);
    expect(block).toMatch(/console\.log|emit/);
    // v12.295:提示语不该再推荐已废弃的 HAPPYHORSE_SIZE(上游根本没这个参数)
    expect(block).not.toContain('HAPPYHORSE_SIZE');
    expect(block).toMatch(/ratio/);
  });
});

describe('v12.294 · 上游自报画幅的核对', () => {
  it('从真实响应形态里读出 ratio 与 SR', () => {
    // 这份是 2026-08-09 实测响应的形态(usage 与 output 同级)
    const real = { usage: { SR: 1080, ratio: '16:9', duration: 3, video_count: 1 }, output: { task_status: 'SUCCEEDED' } };
    expect(reportedHappyHorseAspect(real)).toEqual({ ratio: '16:9', sr: 1080 });
  });

  it('没有 usage / 字段缺失时不炸,返回空', () => {
    expect(reportedHappyHorseAspect({})).toEqual({});
    expect(reportedHappyHorseAspect(null)).toEqual({});
    expect(reportedHappyHorseAspect({ usage: {} })).toEqual({ ratio: undefined, sr: undefined });
    expect(reportedHappyHorseAspect({ usage: { ratio: 123, SR: 'x' } })).toEqual({ ratio: undefined, sr: undefined });
  });

  it('轮询成功时会核对画幅并在不符时告警(此前从不核对)', () => {
    const i = SVC.indexOf("status === 'SUCCEEDED'");
    const block = SVC.slice(i, i + 900);
    expect(block).toContain('reportedHappyHorseAspect');
    expect(block).toMatch(/console\.warn/);
    expect(block).toContain('onAspectReport');
  });

  it('只告警不拦截 —— 素材已生成,拦下等于白烧一次', () => {
    const i = SVC.indexOf('reportedHappyHorseAspect(j)');
    expect(i).toBeGreaterThan(0);
    // 只看「核对 → return url」这一段,别把后面 FAILED 分支的 throw 也framed进来
    const end = SVC.indexOf('return url;', i);
    expect(end).toBeGreaterThan(i);
    const block = SVC.slice(i, end);
    expect(block, '画幅不符不应抛错').not.toMatch(/throw new Error/);
    expect(block).toMatch(/console\.warn/);
  });
});

describe('v12.294 · 429 的两种含义要分开报', () => {
  it('quota_not_enough 报成额度问题,并点明文案与代码不一致', () => {
    // 锚真实分支,不是文件头那段病因注释
    const i = SVC.indexOf('res.status === 429');
    expect(i, '未处理该错误码').toBeGreaterThan(0);
    const block = SVC.slice(i, i + 600);
    expect(block).toContain('quota_not_enough');
    expect(block).toContain('额度');
    expect(block).toMatch(/等待通常无效/);
  });

  it('其余非 200 仍走通用报错(不把所有 429 都说成额度问题)', () => {
    expect(SVC).toContain('HappyHorse 建任务失败 (${res.status})');
  });

  // v12.304 更新:v12.295 查证官方文档后,病因说明已从「上游不校验 size」
  // 改写为更准确的「上游根本没有 size 这个参数」—— 断言跟着改口径。
  it('保留病因说明:上游没有 size 参数(防后人再把方向判成「网关不采纳」)', () => {
    const i = SVC.indexOf('export function happyHorseAspectSupported');
    const doc = SVC.slice(Math.max(0, i - 1000), i);
    expect(doc).toMatch(/根本没有 `size` 参数|没有 `size` 参数/);
    expect(doc).toMatch(/静默忽略|静默/);
    expect(doc, '正确字段要写明').toMatch(/ratio/);
  });
});
