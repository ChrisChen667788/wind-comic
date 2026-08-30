/**
 * v12.395:视频有配额判定,图像没有 —— 同样的失败每天重试三次。
 *
 * owner 的重跑日志里,同样 4 个场景图在 09:00 / 14:00 / 20:00 各白跑一轮:
 *   ❌ 场景 万人演唱会现场  图像生成失败: Minimax multi-ref needs at least 1 ref
 *      | image(flux-2-pro) 401: {"error":{"message":"Token quota exhausted (request id: …)"}}
 *      | MJ submit failed: …
 *
 * 报文说得很清楚(**Token quota exhausted** —— 青云top 的口径,既不是 402
 * 也不含 insufficient,quota-vocab 的注释里专门记过这个坑),而 v12.376 的分类器
 * 也确实把它判成 `PROVIDER_ARREARS` / `retryable: false`。
 *
 * 问题是**脚本对图像失败压根不调那个判定** —— v12.377 只给视频接了 `shouldStopForQuota`。
 * 于是额度耗尽后,剩下的角色 / 场景 / 分镜被一个个全试一遍,每个都必然失败。
 * 一天三轮 = 同一批图白跑 12 次。
 *
 * 修法把判定放进三步**共用**的 `log()`,循环头短路 —— 一处接线覆盖三步。
 * 关键边界:**只停图像、不碰视频**。两套额度是分开的,v12.367 就是反过来栽过一次
 * (视频尽了却把图像也停了,卡住 53 张图)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { shouldStopForQuota } from '@/lib/quota-vocab.mjs';
import { normalizeError } from '@/lib/pipeline-error';

const SRC = fs.readFileSync(path.join(process.cwd(), 'scripts/rerun-project.mjs'), 'utf-8');
const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** owner 日志里的真实报文,不是编的 */
const REAL_IMAGE_ERR =
  'Minimax multi-ref needs at least 1 ref | image(flux-2-pro) 401: {"error":{"message":"Token quota exhausted (request id: 20260830204512)"}} | MJ submit failed';

describe('真实图像报文能被判成配额耗尽', () => {
  it('分类器判 PROVIDER_ARREARS 且不可重试', () => {
    const e = normalizeError(new Error(REAL_IMAGE_ERR));
    expect(e.code).toBe('PROVIDER_ARREARS');
    expect(e.retryable).toBe(false);
  });

  it('shouldStopForQuota 判 stop —— 401 + Token quota exhausted 是欠费不是鉴权', () => {
    const v = shouldStopForQuota([{ engine: '场景', error: REAL_IMAGE_ERR }]);
    expect(v.stop).toBe(true);
    expect(v.reason).toBe('arrears');
  });

  it('普通生成失败不该触发停止 —— 那是这一张的问题,不是额度', () => {
    for (const err of ['所有图像引擎都失败了 (返回 mock 或空), 请稍后再试', 'fetch failed', 'HTTP 500']) {
      expect(shouldStopForQuota([{ engine: '场景', error: err }]).reason, err).not.toBe('arrears');
    }
  });
});

describe('脚本接线', () => {
  it('图像失败走 shouldStopForQuota,而不是只计数', () => {
    const i = code.indexOf('function log(');
    const end = code.indexOf('\n}', code.indexOf('stat.fail++', i));
    expect(i).toBeGreaterThan(0);
    expect(end, '窗口右界找不到').toBeGreaterThan(i);
    const win = code.slice(i, end);
    expect(win, '窗口自证').toContain('stat.fail++');
    expect(win).toContain('shouldStopForQuota');
    expect(win).toContain('imageQuotaStop');
  });

  it('三个图像步骤的循环头都短路 —— 一处判定,三步生效', () => {
    const breaks = code.match(/if \(stat\.imageQuotaStop\) break;/g) || [];
    expect(breaks.length, '角色 / 场景 / 分镜 三步都要短路').toBeGreaterThanOrEqual(3);
  });

  it('**不碰视频步骤** —— 两套额度分开(v12.367 反过来栽过一次)', () => {
    const videoAt = code.indexOf("STEPS.has('videos')");
    expect(videoAt).toBeGreaterThan(0);
    const videoBlock = code.slice(videoAt);
    expect(videoBlock, '视频循环不该被图像额度短路').not.toContain('imageQuotaStop');
    // 视频那侧仍用它自己的 quotaStop
    expect(videoBlock).toContain('quotaStop');
  });

  it('拿不到证据时不停 —— 图像侧宁可多试,别把一次网络抖动当成额度耗尽', () => {
    const i = code.indexOf('imageQuotaStop = true');
    const win = code.slice(Math.max(0, i - 300), i);
    expect(win, '窗口自证').toContain('shouldStopForQuota');
    expect(win, "no-evidence 时不该停").toContain("'no-evidence'");
  });

  it('退出码 3 仍只由视频配额决定 —— 它会让调用方关掉后续项目的视频步骤', () => {
    const i = code.indexOf('process.exit(3)');
    expect(i).toBeGreaterThan(0);
    const before = code.slice(Math.max(0, i - 400), i);
    expect(before).toContain('stat.quotaStop');
    expect(before, '图像额度不该触发这个后果').not.toContain('imageQuotaStop');
  });
});
