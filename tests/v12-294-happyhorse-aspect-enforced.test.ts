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
 * 正确写法**至今仍未确证**:四个候选(size:'720*1280' / ratio / aspect_ratio / 三管齐下)
 * 逐个串行重试,上游通道从当日 14:37 起持续 429 —— 且代码是 `local:quota_not_enough`
 * 而文案写「分组上游负载已饱和」,两者不是一回事。
 *
 * 未确证不等于可以装作没事:v12.272 把限制只写进 README(documented 但不 enforced),
 * 竖屏项目照样被路由过来、静默拿到横屏素材。本版把它变成引擎链的硬门禁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  happyHorseAspectSupported,
  reportedHappyHorseAspect,
} from '@/services/happyhorse.service';

const ORCH = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
const SVC = fs.readFileSync('services/happyhorse.service.ts', 'utf-8');

describe('v12.294 · 未确证的画幅一律不承认', () => {
  it('只有 16:9 被实测确证 —— 其余全部判不支持', () => {
    expect(happyHorseAspectSupported('16:9', {})).toBe(true);
    for (const a of ['9:16', '1:1', '4:3', '3:4']) {
      expect(happyHorseAspectSupported(a, {}), `${a} 未确证却被放行`).toBe(false);
    }
  });

  it('没指定画幅 → 用上游默认,不拦', () => {
    expect(happyHorseAspectSupported(undefined, {})).toBe(true);
    expect(happyHorseAspectSupported('', {})).toBe(true);
  });

  it('运营者设了 HAPPYHORSE_SIZE = 自行担保,放行任意画幅', () => {
    expect(happyHorseAspectSupported('9:16', { HAPPYHORSE_SIZE: '720*1280' })).toBe(true);
    expect(happyHorseAspectSupported('3:4', { HAPPYHORSE_SIZE: '1088*832' })).toBe(true);
  });

  it('空白的 HAPPYHORSE_SIZE 不算担保(避免 `HAPPYHORSE_SIZE=` 这种半吊子配置放行)', () => {
    expect(happyHorseAspectSupported('9:16', { HAPPYHORSE_SIZE: '   ' })).toBe(false);
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
    expect(block).toContain('HAPPYHORSE_SIZE');
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

  it('保留病因说明:上游不校验 size(防后人再把方向判成「网关不采纳」)', () => {
    const i = SVC.indexOf('happyHorseAspectSupported');
    const doc = SVC.slice(Math.max(0, i - 1200), i);
    expect(doc).toMatch(/不校验/);
    expect(doc).toMatch(/静默回落|静默/);
  });
});
