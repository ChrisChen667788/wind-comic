/**
 * v12.452 · 健康页:接口不给 200 时要显示「加载失败」,不能整页白屏;并且要带上令牌。
 *
 * 浏览器真机(3200 与 3100 两个工作树 A/B)撞出来的**早就存在**的问题:
 * `/api/health/providers` 在安全收口时加了鉴权,本页同一组 fetch 里只有拉 providers 那处没带令牌;
 * 更要命的是它不看 res.ok,把 `{message:'Unauthorized'}` 当数据 setState,
 * 于是 `data.providers.map` 抛 TypeError,**整页被错误边界白屏** —— 而健康页正是出事时才去看的那一页。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import HealthPage from '@/app/dashboard/health/page';
import { getTranslations } from '@/lib/i18n';

// 组件按 localStorage('qfmj-locale') 决定语言;测试里钉成中文,断言才好写(页面文案取自同一份词典,不写死)
beforeEach(() => { localStorage.setItem('qfmj-locale', 'zh-CN'); });
const t = getTranslations('zh-CN').healthPage;

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const providersPayload = {
  overall: 'warning', checkedAt: new Date(0).toISOString(),
  providers: [
    { id: 'minimax-video', label: 'MiniMax 视频 · MiniMax-H3', kind: 'video', status: 'plan_limited', detail: '当前套餐用不了 MiniMax-H3(只能按量付费)· 出片自动改用 MiniMax-Hailuo-2.3 · 参考视频动作迁移用不了', latencyMs: 194 },
    { id: 'minimax-tts', label: 'MiniMax TTS', kind: 'tts', status: 'ok', detail: 'HTTP 200' },
  ],
};

/** 只桩 fetch:providers 按传入的响应答,其余一律 401(模型雷达那条本来就要登录) */
function stubFetch(providersRes: { ok: boolean; status: number; body: unknown }) {
  const seen: Array<{ url: string; auth?: string }> = [];
  vi.spyOn(globalThis, 'fetch' as never).mockImplementation((async (url: string, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    if (u.includes('/api/health/providers')) {
      return { ok: providersRes.ok, status: providersRes.status, json: async () => providersRes.body } as Response;
    }
    return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) } as Response;
  }) as never);
  return seen;
}

describe('v12.452 · 健康页加载', () => {
  it('401(cookie 被拦/过期)→ 显示加载失败,页面不崩', async () => {
    stubFetch({ ok: false, status: 401, body: { message: 'Unauthorized' } });
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText(t.loadFailed)).toBeTruthy());
    // 修前:这里会抛 TypeError: Cannot read properties of undefined (reading 'map')
  });

  it('200 → 正常渲染,「受限」黄灯与处置建议都在', async () => {
    stubFetch({ ok: true, status: 200, body: providersPayload });
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText('MiniMax 视频 · MiniMax-H3')).toBeTruthy());
    expect(screen.getByText('受限')).toBeTruthy();
    expect(screen.getByText(/换计费方式/)).toBeTruthy();
    expect(screen.getByText(/只能按量付费/)).toBeTruthy();
  });

  it('拉 providers 时带上令牌 —— 本页另外两处早就带了,只有这处漏了', async () => {
    localStorage.setItem('qfmj-token', 'tok-abc');
    const seen = stubFetch({ ok: true, status: 200, body: providersPayload });
    render(<HealthPage />);
    await waitFor(() => expect(seen.some((s) => s.url.includes('/api/health/providers'))).toBe(true));
    expect(seen.find((s) => s.url.includes('/api/health/providers'))!.auth).toBe('Bearer tok-abc');
  });

  it('响应码不是 200 时,哪怕响应体形状是对的(网关回 503 带陈旧数据)也不当实时数据渲染', async () => {
    stubFetch({ ok: false, status: 503, body: providersPayload });
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText(t.loadFailed)).toBeTruthy());
    expect(screen.queryByText('MiniMax 视频 · MiniMax-H3'), '陈旧数据不能冒充实时探测结果').toBeNull();
  });

  it('200 但响应体不是这个形状(接口改了/网关插了一脚)→ 也当加载失败,不白屏', async () => {
    stubFetch({ ok: true, status: 200, body: { overall: 'healthy' } });
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText(t.loadFailed)).toBeTruthy());
  });
});
