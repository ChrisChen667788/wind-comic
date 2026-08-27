import { getToken } from './auth';

const API_BASE = '';

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as any).message || 'Request failed');
    (err as any).status = res.status;
    // v12.341:**把 Retry-After 一并带出去**。此前只保留 status,于是服务端明明算好了
    // 「还剩多少秒解锁」,界面却拿不到 —— 429 和 401 一样只能显示「登录失败」,
    // 用户以为密码记错了,反复重试(徒劳,锁定窗口是固定的、不会因重试延长,但也不会提前结束)。
    const ra = res.headers.get('Retry-After');
    if (ra) {
      const sec = Number(ra);
      if (Number.isFinite(sec) && sec > 0) (err as any).retryAfterSec = Math.ceil(sec);
    }
    throw err;
  }
  return data;
}

export const api = {
  login: (payload: { email: string; password: string }) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload: { email: string; password: string; name: string }) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/api/auth/me'),
  metrics: () => request('/api/metrics'),
  projects: () => request('/api/projects'),
  createProject: (payload: { title: string; description?: string; covers?: string[] }) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  getProject: (id: string) => request(`/api/projects/${id}`),
  cases: () => request('/api/cases'),
  generations: () => request('/api/generations'),
  createGeneration: (payload: { prompt: string; style: string; projectId?: string }) =>
    request('/api/generations', { method: 'POST', body: JSON.stringify(payload) }),
};
