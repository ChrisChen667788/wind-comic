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
