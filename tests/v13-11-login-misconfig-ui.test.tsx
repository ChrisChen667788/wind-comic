/**
 * v13.11 — 登录页把服务端的 503 原因原样显示出来(「服务端没配置 JWT_SECRET……」),
 * 并说明「不是你的密码错了」;没有 JSON 的 5xx 不再显示英文的「Request failed」。
 *
 * 走真链路:真 lib/api-client(只把 fetch 换掉)→ 真登录页渲染。useAuth 的 login/register
 * 直接调真 api-client,和 components/auth-provider 里一样。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { MISCONFIG_MESSAGES } from '@/lib/server-misconfig';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/auth',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/ui/toast-provider', () => ({ useToast: () => ({ showToast: () => {} }) }));
vi.mock('@/components/auth-provider', async () => {
  const { api } = await import('@/lib/api-client');
  return {
    useAuth: () => ({
      user: null,
      loading: false,
      login: async (email: string, password: string) => { await api.login({ email, password }); },
      register: async (email: string, password: string, name: string) => { await api.register({ email, password, name }); },
      logout: () => {},
    }),
  };
});

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(status: number, body: unknown, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status, headers: { 'content-type': contentType } })));
}

const misconfig = (reason: keyof typeof MISCONFIG_MESSAGES) => ({
  code: 'server_misconfigured',
  reason,
  message: MISCONFIG_MESSAGES[reason],
});

async function submit(mode: 'login' | 'register' = 'login') {
  const { render, screen, fireEvent } = await import('@testing-library/react');
  const { default: AuthPage } = await import('@/app/auth/page');
  render(<AuthPage />);
  if (mode === 'register') {
    fireEvent.click(screen.getByRole('button', { name: '立即注册' }));
    fireEvent.change(screen.getByPlaceholderText('输入用户名'), { target: { value: 'N' } });
  }
  fireEvent.change(screen.getByPlaceholderText('输入密码'), { target: { value: 'pw-123456' } });
  fireEvent.submit(screen.getByPlaceholderText('输入密码').closest('form')!);
  return screen.findByRole('alert');
}

describe('v13.11 · api-client 把原因代码带到 error 上', () => {
  it('503 server_misconfigured → status / code / reason / message 都在', async () => {
    stubFetch(503, misconfig('jwt_secret_missing'));
    const { api } = await import('@/lib/api-client');
    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      status: 503,
      code: 'server_misconfigured',
      reason: 'jwt_secret_missing',
      message: MISCONFIG_MESSAGES.jwt_secret_missing,
    });
  });
});

describe('v13.11 · 登录页:503 显示服务端给的原因', () => {
  it('没配 JWT_SECRET → 显示「服务端没配置 JWT_SECRET……」+「不是你的账号或密码错了」', async () => {
    stubFetch(503, misconfig('jwt_secret_missing'));
    const alert = await submit();
    expect(alert.textContent).toContain('服务端没配置 JWT_SECRET');
    expect(alert.textContent).toContain('openssl rand -hex 32');
    expect(alert.textContent).toContain('不是你的账号或密码错了');
    expect(alert.textContent).not.toMatch(/登录失败|Request failed|邮箱或密码不正确/);
  });

  it('数据库打不开 → 显示 chown / 命名卷那段', async () => {
    stubFetch(503, misconfig('db_unavailable'));
    const alert = await submit();
    expect(alert.textContent).toContain(MISCONFIG_MESSAGES.db_unavailable);
    expect(alert.textContent).toContain('不是你的账号或密码错了');
  });

  it('注册页同样显示', async () => {
    stubFetch(503, misconfig('jwt_secret_weak'));
    const alert = await submit('register');
    expect(alert.textContent).toContain('服务端没配置 JWT_SECRET');
    expect(alert.textContent).toContain('不是你的账号或密码错了');
  });

  it('对照:401 仍是「邮箱或密码不正确」,没有服务端配置的提示', async () => {
    stubFetch(401, { message: 'Invalid credentials' });
    const alert = await submit();
    expect(alert.textContent).toBe('邮箱或密码不正确');
  });

  it('没有 JSON 的 500(反代/网关错误页)→ 中文说明 + HTTP 状态,不再是「Request failed」', async () => {
    stubFetch(500, '<html>Internal Server Error</html>', 'text/html');
    const alert = await submit();
    expect(alert.textContent).toContain('登录失败:服务端出错(HTTP 500)');
    expect(alert.textContent).not.toContain('Request failed');
    expect(alert.textContent).not.toContain('不是你的账号或密码错了');
  });

  it('不带 server_misconfigured 标记的 503(比如反代自己的 503)→ 不冒充「服务端配置问题」', async () => {
    stubFetch(503, '<html>Service Unavailable</html>', 'text/html');
    const alert = await submit();
    expect(alert.textContent).toContain('HTTP 503');
    expect(alert.textContent).not.toContain('不是你的账号或密码错了');
  });
});
