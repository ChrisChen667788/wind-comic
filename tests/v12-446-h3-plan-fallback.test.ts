/**
 * v12.446:H3 回落认不出中文报文 —— 套餐里每天 3 条 Hailuo-2.3 白白浪费了 16 天。
 *
 * v12.402 把默认视频模型翻到 MiniMax-H3,并设计了「套餐用不了 H3 → 回落到 legacy 的
 * Hailuo-2.3 并大声告警」。但判定只认英文和 2061,而国内站实际返回的是:
 *
 *   Minimax API error (400): {"type":"error","error":{"type":"bad_request_error",
 *     "message":"invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)", …}}
 *
 * 认不出 → 抛错 → 可灵欠费、Veo 额度尽 → 整镜落成 Ken Burns 占位片 → 重跑脚本判「欠费」整轮停。
 * 每日重跑日志(~/Library/Logs/wind-comic-rerun.log)实证:9-03 ~ 9-18 H3 零成功、回落告警零次;
 * 9-02 及之前 Hailuo-2.3 每天稳定出 3 条后报 2056 —— 正是套餐的「3 条/日」。
 *
 * 这里不只测判定函数:回落分支上线以来**从没被真正走到过**,所以用模拟网络把整条链跑一遍,
 * 证明回落后真的换成 Hailuo-2.3、打到 v1 端点、并拿回视频地址。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isModelUnavailableError, LEGACY_VIDEO_MODEL } from '@/lib/minimax-video-api';
import { detectQuotaError } from '@/lib/api-usage-tracker';
import { MinimaxService } from '@/services/minimax.service';
import { resetH3Availability } from '@/lib/h3-availability';

/** 生产日志原文(request_id 换成占位) */
const REAL_MESSAGE = 'invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)';
const REAL_BODY = {
  type: 'error',
  error: { type: 'bad_request_error', message: REAL_MESSAGE, http_code: '400' },
  request_id: '06fc066bae-test',
};
/** service 实际抛出、再交给判定函数的那串 */
const REAL_EMSG = `Minimax API error (400): ${JSON.stringify(REAL_BODY)}`;

describe('v12.446 · 认得出「套餐不支持 H3」', () => {
  it('生产日志原文(裸报文与 service 实际抛出的整串)都要命中', () => {
    expect(isModelUnavailableError(REAL_MESSAGE)).toBe(true);
    expect(isModelUnavailableError(REAL_EMSG)).toBe(true);
  });

  it('同一语义的其他写法也命中(国际站英文、套餐字样)', () => {
    expect(isModelUnavailableError('TokenPlan or Credit does not support MiniMax-H3 series models (2013)')).toBe(true);
    expect(isModelUnavailableError('your token plan not support this')).toBe(true);
    expect(isModelUnavailableError('当前套餐不支持该模型')).toBe(true);
    // 旧写法不能因为这次改动丢掉
    expect(isModelUnavailableError('base_resp 2061: your current token plan not support model')).toBe(true);
    expect(isModelUnavailableError('invalid model')).toBe(true);
  });

  it('额度用尽不能命中 —— 换模型没用,那要走 Fast 的独立额度', () => {
    // 这条和目标报文一样带「Token Plan」,只差「不支持」—— 最容易误伤的就是它
    expect(isModelUnavailableError('已达到 Token Plan 用量上限 (2056)')).toBe(false);
    expect(isModelUnavailableError('Minimax video-01 error (2056): usage limit exceeded')).toBe(false);
    expect(isModelUnavailableError('insufficient credit balance')).toBe(false);
  });

  it('v12.446.1 · 「模式不支持」不是「套餐不支持」—— 实探原文,旧的宽规则会误判', () => {
    const FAST_T2V = 'invalid params, model MiniMax-Hailuo-2.3-Fast does not support Text-to-Video mode (2013)';
    expect(isModelUnavailableError(FAST_T2V)).toBe(false);
    expect(detectQuotaError('minimax', undefined, FAST_T2V), '看板也不能把它记成套餐问题').not.toBe('model_unavailable');
    // 真正的套餐类英文原文都带 token plan 字样,收紧后照样命中
    expect(isModelUnavailableError('your current token plan not support model')).toBe(true);
  });

  it('不能按 2013 这个码认 —— 它是 MiniMax 的通用「参数错误」码', () => {
    expect(isModelUnavailableError('Minimax video-01 error (2013): invalid params')).toBe(false);
    // 模型能力类的参数错误(没有套餐字样)也不该触发「换成 legacy」
    expect(isModelUnavailableError('invalid params, 该模型不支持 2K 分辨率 (2013)')).toBe(false);
    expect(isModelUnavailableError('')).toBe(false);
  });
});

describe('v12.446 · 用量看板与回落用同一份判定', () => {
  it('看板把生产原文记成 model_unavailable,不再是一次无告警的普通失败', () => {
    expect(detectQuotaError('minimax', undefined, REAL_EMSG)).toBe('model_unavailable');
  });

  it('两边逐条同判 —— 防止再各写一份、再各漏一种写法', () => {
    const samples = [
      REAL_EMSG, REAL_MESSAGE, '当前套餐不支持该模型', 'your current token plan not support model',
      '已达到 Token Plan 用量上限 (2056)', 'Minimax video-01 error (2013): invalid params',
      'invalid params, 该模型不支持 2K 分辨率 (2013)', 'timeout', 'fetch failed',
    ];
    for (const s of samples) {
      const board = detectQuotaError('minimax', undefined, s) === 'model_unavailable';
      expect(board, `看板与回落对「${s.slice(0, 40)}」判得不一样`).toBe(isModelUnavailableError(s));
    }
  });
});

// ─── 整条回落链:模拟网络真跑 generateVideo ──────────────────────────────────

type Call = { url: string; method: string; body: any };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('v12.446 · 回落整条链(模拟网络)', () => {
  let calls: Call[];
  let warn: ReturnType<typeof vi.spyOn>;
  const prevModel = process.env.MINIMAX_VIDEO_MODEL;

  beforeEach(() => {
    // v12.448:「H3 不可用」会在进程内记 30 分钟 —— 每条从「未知」开始,否则上一条记下的状态让下一条直接跳过 H3
    resetH3Availability();
    delete process.env.MINIMAX_VIDEO_MODEL; // 用默认值 = H3,和生产一致
    calls = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (prevModel === undefined) delete process.env.MINIMAX_VIDEO_MODEL;
    else process.env.MINIMAX_VIDEO_MODEL = prevModel;
  });

  /** 按路由回包;create 的第一次(H3)由 onH3 决定 */
  function stubNetwork(onH3: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/v2/video_generation')) return onH3();
      if (url.endsWith('/v1/video_generation')) {
        return jsonResponse(200, { task_id: 'legacy-task', base_resp: { status_code: 0, status_msg: 'success' } });
      }
      if (url.includes('/v1/query/video_generation')) {
        return jsonResponse(200, { status: 'Success', file_id: 'file-1', base_resp: { status_code: 0 } });
      }
      if (url.includes('/v1/files/retrieve')) {
        return jsonResponse(200, { file: { download_url: 'https://cdn.example/legacy.mp4' } });
      }
      return jsonResponse(404, { error: `unexpected ${url}` });
    }));
  }

  function makeService() {
    const svc = new MinimaxService();
    (svc as any).sleep = async () => {}; // 轮询间隔不真等
    return svc;
  }

  it('H3 报「套餐不支持」→ 回落到 Hailuo-2.3 走 v1,拿回视频地址,并留下告警', async () => {
    stubNetwork(() => jsonResponse(400, REAL_BODY));
    const url = await makeService().generateVideo('https://img.example/frame.png', '测试镜头');

    expect(url).toBe('https://cdn.example/legacy.mp4');
    const creates = calls.filter((c) => c.method === 'POST');
    expect(creates.map((c) => new URL(c.url).pathname)).toEqual(['/v2/video_generation', '/v1/video_generation']);
    expect(creates[0].body.model).toBe('MiniMax-H3');
    expect(creates[1].body.model).toBe(LEGACY_VIDEO_MODEL);
    expect(creates[1].body.first_frame_image).toBe('https://img.example/frame.png'); // 首帧没在回落里丢
    // 不许静默替换:得看得见「这次用的不是 H3」
    const warned = warn.mock.calls.map((a) => String(a[0])).join('\n');
    expect(warned).toContain('当前套餐用不了 MiniMax-H3');
  });

  it('回落只发生一次 —— legacy 也报套餐不支持时直接抛错,不回落套回落、不对 H3 反复重试', async () => {
    // 两个模型都报「套餐不支持」:防重入护栏一旦失效,这里会无限递归 —— 计数到 10 就熔断,免得测试挂死
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (calls.length > 10) throw new Error('熔断:回落在无限递归');
      return jsonResponse(400, REAL_BODY);
    }));
    await expect(makeService().generateVideo('https://img.example/frame.png', '测试镜头')).rejects.toThrow(/暂不支持/);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v2/video_generation', '/v1/video_generation']);
  });

  it('另一侧:H3 报额度用尽 → 不走 legacy 回落(换模型没用),而是走 Fast 的独立额度', async () => {
    stubNetwork(() => jsonResponse(400, {
      type: 'error',
      error: { type: 'bad_request_error', message: '已达到 Token Plan 用量上限 (2056)', http_code: '400' },
    }));
    await makeService().generateVideo('https://img.example/frame.png', '测试镜头').catch(() => {});
    const models = calls.filter((c) => c.method === 'POST').map((c) => c.body?.model);
    expect(models[0]).toBe('MiniMax-H3');
    expect(models).not.toContain(LEGACY_VIDEO_MODEL);
    expect(models.some((m) => /Fast/.test(String(m))), `应转到 Fast,实际:${models.join(' → ')}`).toBe(true);
    const warned = warn.mock.calls.map((a) => String(a[0])).join('\n');
    expect(warned).not.toContain('当前套餐用不了');
  });

  it('另一侧:与套餐无关的错误照常抛出,不被回落吞掉', async () => {
    stubNetwork(() => jsonResponse(500, { error: 'upstream exploded' }));
    await expect(makeService().generateVideo('https://img.example/frame.png', '测试镜头')).rejects.toThrow(/500/);
    expect(calls.some((c) => c.url.endsWith('/v1/video_generation'))).toBe(false);
  });
});
