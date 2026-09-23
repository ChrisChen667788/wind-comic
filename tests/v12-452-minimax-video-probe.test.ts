/**
 * v12.452 · 健康页的 MiniMax 视频探针。
 *
 * 输入一律是**上游实测原文**(Token Plan key 零成本探测所得,标了日期),不是想象出来的报文 ——
 * v12.402 的回落分支就是因为只认英文、而国内站回中文,上线 16 天一次都没走到过。
 * 唯一例外标为「设想」:按量付费账号的回复我们实测不到;判定对它要求正向信号,文案对不上时报「无法判读」而不是报绿。
 *
 * 2026-09-22 复测撞出草稿版的**假绿**:上游校验顺序已变成「格式绑定 → 模型/套餐 → 内容语义」,
 * 只带 model 的请求停在绑定层 —— 真模型和不存在的模型回同一句 —— 草稿把它当成「过了套餐校验」报了绿。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { probeMinimaxVideo, assessProbe, readMinimaxReply, resetVideoProbeForTest, type ProbeFetch } from '@/lib/minimax-video-probe';
import { STATUS_META, overallHealth } from '@/lib/provider-health';

// ── 实测原文(2026-09-18 首测,2026-09-22 复测一致)──
const H3_PLAN_BLOCKED = { httpStatus: 400, body: JSON.stringify({ type: 'error', error: { type: 'bad_request_error', message: 'invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)', http_code: '400' } }) };
const HAILUO_PARAM_ERR = { httpStatus: 200, body: JSON.stringify({ task_id: '', base_resp: { status_code: 2013, status_msg: "invalid params, text to video: prompt can't be empty" } }) };
// ── 实测原文(2026-09-22)──
// 缺必填字段:停在格式绑定层,**真模型与不存在的模型回的一模一样** —— 这正是草稿版假绿的来源
const H3_BINDING = { httpStatus: 400, body: JSON.stringify({ type: 'error', error: { type: 'bad_request_error', message: 'invalid params, binding: expr_path=content, cause=missing required parameter (2013)', http_code: '400' }, request_id: '07019ee882eed6ba715b99665b390c31' }) };
// 字段齐、模型名不存在
const NO_SUCH_MODEL = { httpStatus: 400, body: JSON.stringify({ type: 'error', error: { type: 'bad_request_error', message: 'invalid params, 该模型暂不支持 /v2/video_generation (2013)', http_code: '400' }, request_id: '07019f1331ca13557526690a8842755d' }) };
// ── 设想(实测不到:本账号没有按量付费)── 过了模型与套餐两关、停在「内容为空」
const H3_PARAM_ERR = { httpStatus: 400, body: JSON.stringify({ type: 'error', error: { type: 'bad_request_error', message: 'invalid params, content is required (2013)', http_code: '400' } }) };

const BASE = 'https://api.minimaxi.com';
type Sent = { url: string; body: any };

function fake(replies: Record<string, { httpStatus?: number; body?: string; error?: string }>) {
  const sent: Sent[] = [];
  const fetch: ProbeFetch = async (url, init) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, body });
    const r = replies[body.model];
    if (!r) throw new Error('没预期会探 ' + body.model);
    return r;
  };
  return { fetch, sent };
}

beforeEach(() => { resetVideoProbeForTest(); delete process.env.MINIMAX_VIDEO_MODEL; });

describe('v12.452 · MiniMax 视频探针', () => {
  it('Token Plan(实测原文):H3 用不了、Hailuo-2.3 在套餐内 → 「套餐受限」,点明回落与参考视频不可用', async () => {
    const { fetch, sent } = fake({ 'MiniMax-H3': H3_PLAN_BLOCKED, 'MiniMax-Hailuo-2.3': HAILUO_PARAM_ERR });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).toBe('plan_limited');
    expect(h.detail).toContain('按量付费');
    expect(h.detail).toContain('MiniMax-Hailuo-2.3');
    expect(h.detail).toContain('参考视频');
    // 两次都走对了端点,且请求体里**没有任何可生成的内容** —— 不建任务、不计费
    expect(sent.map((s) => s.url)).toEqual([`${BASE}/v2/video_generation`, `${BASE}/v1/video_generation`]);
    expect(sent[0].body).toEqual({ model: 'MiniMax-H3', content: [], duration: 4, resolution: '768P' });
    expect(sent[1].body).toEqual({ model: 'MiniMax-Hailuo-2.3' });
    for (const s of sent) expect(JSON.stringify(s.body)).not.toMatch(/prompt|"text"|image_url|video_url|first_frame/);
    // 在健康页上是黄灯(整体 warning),不是绿灯,也不是红灯
    expect(STATUS_META[h.status].tone).toBe('warn');
    expect(overallHealth([h])).toBe('warning');
  });

  it('【假绿回归·实测原文】只停在格式绑定层的回复不能报绿 —— 真模型和假模型回的一样,说明根本没走到套餐校验', async () => {
    const { fetch, sent } = fake({ 'MiniMax-H3': H3_BINDING });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).not.toBe('ok');
    expect(STATUS_META[h.status].tone).not.toBe('ok');
    expect(h.detail).toContain('缺 content');
    expect(h.detail).toContain('探针需要更新');
    expect(sent, '没判出套餐结论,不该接着去探回落模型').toHaveLength(1);
  });

  it('【实测原文】模型名不被接口认 → 配置问题,指向 MINIMAX_VIDEO_MODEL', async () => {
    process.env.MINIMAX_VIDEO_MODEL = 'MiniMax-H3-typo';
    const { fetch } = fake({ 'MiniMax-H3-typo': NO_SUCH_MODEL });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).toBe('misconfigured');
    expect(h.detail).toContain('MINIMAX_VIDEO_MODEL');
  });

  it('【实测原文·长得像】2013 但既不是「内容为空」也不是套餐问题 → 不报绿,原文照登', async () => {
    // v12.446.1 实探原文:同时含 model 与 not support,正是最容易被宽规则误判的那种
    process.env.MINIMAX_VIDEO_MODEL = 'MiniMax-Hailuo-2.3-Fast';
    const fastModeErr = { httpStatus: 200, body: JSON.stringify({ task_id: '', base_resp: { status_code: 2013, status_msg: 'invalid params, model MiniMax-Hailuo-2.3-Fast does not support Text-to-Video mode (2013)' } }) };
    const { fetch } = fake({ 'MiniMax-Hailuo-2.3-Fast': fastModeErr });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).not.toBe('ok');
    expect(h.status, '也不是套餐问题').not.toBe('plan_limited');
    expect(h.detail).toContain('does not support Text-to-Video');
  });

  it('【设想报文】过了模型与套餐、停在「内容为空」= 在套餐内 → 正常,只打一次', async () => {
    const { fetch, sent } = fake({ 'MiniMax-H3': H3_PARAM_ERR });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).toBe('ok');
    expect(h.detail).toContain('未建任务');
    expect(sent).toHaveLength(1);
  });

  it('H3 与回落的 Hailuo-2.3 都不在套餐内 → 配置问题(红/黄灯),不是「套餐受限」', async () => {
    const blocked = { httpStatus: 200, body: JSON.stringify({ base_resp: { status_code: 2013, status_msg: 'invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-Hailuo-2.3 模型' } }) };
    const { fetch } = fake({ 'MiniMax-H3': H3_PLAN_BLOCKED, 'MiniMax-Hailuo-2.3': blocked });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).toBe('misconfigured');
    expect(h.detail).toContain('都用不了');
  });

  it('鉴权失败 / 余额不足 / 网络不通:按通用归类,不误判成「在套餐内」', async () => {
    const auth = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch: fake({ 'MiniMax-H3': { httpStatus: 401, body: '{"type":"error","error":{"message":"invalid api key"}}' } }).fetch });
    expect(auth.status).toBe('auth_error');
    const credit = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch: fake({ 'MiniMax-H3': { httpStatus: 200, body: JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }) } }).fetch });
    expect(credit.status).toBe('out_of_credits');
    const net = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch: fake({ 'MiniMax-H3': { error: 'fetch failed' } }).fetch });
    expect(net.status).toBe('down');
  });

  it('HTTP 200 却读不出错误码也没有任务号 → 不能报正常', () => {
    expect(assessProbe({ httpStatus: 200, body: '{"weird":true}' }).kind).toBe('health');
  });

  it('万一缺参请求也建了任务(会扣费):当场自停,之后一个请求都不再发', async () => {
    const created = { httpStatus: 200, body: JSON.stringify({ task_id: 't-123', base_resp: { status_code: 0 } }) };
    const first = fake({ 'MiniMax-H3': created });
    const h1 = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch: first.fetch });
    expect(h1.status).not.toBe('ok');
    expect(h1.detail).toContain('自停');
    const second = fake({});
    const h2 = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch: second.fetch });
    expect(second.sent).toHaveLength(0);
    expect(h2.detail).toContain('自停');
  });

  it('没配 key / 占位 key → 未配置,不发请求;非官方端点 → 配置问题,不发请求', async () => {
    const f = fake({});
    expect((await probeMinimaxVideo({ baseUrl: BASE, key: '', fetch: f.fetch })).status).toBe('not_configured');
    expect((await probeMinimaxVideo({ baseUrl: BASE, key: 'your_minimax_key', fetch: f.fetch })).status).toBe('not_configured');
    expect((await probeMinimaxVideo({ baseUrl: 'https://some-gateway.example', key: 'k', fetch: f.fetch })).status).toBe('misconfigured');
    expect(f.sent).toHaveLength(0);
  });

  it('默认模型可被 MINIMAX_VIDEO_MODEL 覆盖:显式用 legacy 时只探它', async () => {
    process.env.MINIMAX_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';
    const { fetch, sent } = fake({ 'MiniMax-Hailuo-2.3': HAILUO_PARAM_ERR });
    const h = await probeMinimaxVideo({ baseUrl: BASE, key: 'k', fetch });
    expect(h.status).toBe('ok');
    expect(h.label).toContain('MiniMax-Hailuo-2.3');
    expect(sent.map((s) => s.url)).toEqual([`${BASE}/v1/video_generation`]);
  });

  it('报文判读:V2 的错误码在 message 末尾括号里;v1 在 base_resp;空 task_id 不算建了任务', () => {
    expect(readMinimaxReply(H3_PLAN_BLOCKED.body)).toMatchObject({ code: 2013, taskId: undefined });
    expect(readMinimaxReply(HAILUO_PARAM_ERR.body)).toMatchObject({ code: 2013, taskId: undefined });
    expect(readMinimaxReply('not json')).toMatchObject({ code: undefined, message: 'not json' });
  });
});
