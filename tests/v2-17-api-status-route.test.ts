/**
 * Tests for v2.17 P0.3 — public GET /api/api-status + admin /api/admin/api-usage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let MOCK_USER: { sub: string; role?: string } | null = null;

vi.mock('@/lib/db', async () => {
  // 用真 db (其他测试依赖), 这里不 mock
  return await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
});

vi.mock('../app/api/auth/lib', () => ({
  getUserFromRequest: () => MOCK_USER,
}));

import { db } from '@/lib/db';
import { recordApiCall, acknowledgeQuotaAlert, listActiveQuotaAlerts } from '@/lib/api-usage-tracker';

const importPublicGet = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/api-status/route');
  return mod.GET;
};

const importAdminGet = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/admin/api-usage/route');
  return mod.GET;
};

const importAdminPost = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/admin/api-usage/route');
  return mod.POST;
};

const mkReq = (url: string, init?: RequestInit) =>
  new Request(url, init || { method: 'GET' }) as any;

beforeEach(() => {
  MOCK_USER = null;
  db.prepare('DELETE FROM api_usage_events').run();
  db.prepare('DELETE FROM api_quota_alerts').run();
});

describe('GET /api/api-status (public)', () => {
  it('returns empty list when no alerts', async () => {
    const GET = await importPublicGet();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
    expect(body.timestamp).toBeDefined();
  });

  it('returns deduplicated alerts (most severe per provider)', async () => {
    // Same provider, two different alert types — public endpoint dedups by provider
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 1008, errorMessage: '余额不足' });
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 429, errorMessage: 'too many requests' });
    const GET = await importPublicGet();
    const res = await GET();
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].provider).toBe('minimax');
    // exhausted (3) > rate_limited (1)
    expect(body.alerts[0].alertType).toBe('exhausted');
  });

  it('does not leak error_message detail (only provider+type+count+ts)', async () => {
    await recordApiCall({
      provider: 'openai',
      success: false,
      errorMessage: 'sk-xxxx insufficient_quota leaking secrets',
    });
    const GET = await importPublicGet();
    const res = await GET();
    const body = await res.json();
    expect(body.alerts[0]).not.toHaveProperty('errorMessage');
    expect(body.alerts[0]).not.toHaveProperty('error_message');
    // ensure no secret string leaked anywhere
    expect(JSON.stringify(body)).not.toContain('sk-xxxx');
  });
});

describe('GET /api/admin/api-usage', () => {
  it('401 when not authenticated', async () => {
    MOCK_USER = null;
    const GET = await importAdminGet();
    const res = await GET(mkReq('http://localhost/api/admin/api-usage'));
    expect(res.status).toBe(401);
  });

  it('403 when user is not admin', async () => {
    MOCK_USER = { sub: 'u1', role: 'user' };
    const GET = await importAdminGet();
    const res = await GET(mkReq('http://localhost/api/admin/api-usage'));
    expect(res.status).toBe(403);
  });

  it('200 returns activeAlerts + failuresByProvider + recentFailures for admin', async () => {
    MOCK_USER = { sub: 'admin1', role: 'admin' };
    await recordApiCall({
      provider: 'minimax', model: 'I2V-01', method: 'generateVideo',
      success: false, statusCode: 1008, errorMessage: '余额不足',
    });
    const GET = await importAdminGet();
    const res = await GET(mkReq('http://localhost/api/admin/api-usage?hours=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windowHours).toBe(1);
    expect(body.activeAlerts).toHaveLength(1);
    expect(body.failuresByProvider).toHaveLength(1);
    expect(body.failuresByProvider[0].provider).toBe('minimax');
    expect(body.recentFailures).toHaveLength(1);
    // admin endpoint DOES include error_message
    expect(body.recentFailures[0].error_message).toContain('余额不足');
  });
});

describe('POST /api/admin/api-usage (ack alert)', () => {
  it('401/403 when not admin', async () => {
    MOCK_USER = { sub: 'u1', role: 'user' };
    const POST = await importAdminPost();
    const res = await POST(
      mkReq('http://localhost/api/admin/api-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fake' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('400 when id missing', async () => {
    MOCK_USER = { sub: 'admin1', role: 'admin' };
    const POST = await importAdminPost();
    const res = await POST(
      mkReq('http://localhost/api/admin/api-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('200 acks an alert (removes from active list)', async () => {
    MOCK_USER = { sub: 'admin1', role: 'admin' };
    await recordApiCall({ provider: 'minimax', success: false, statusCode: 1008, errorMessage: '余额不足' });
    const before = await listActiveQuotaAlerts();
    expect(before).toHaveLength(1);
    const POST = await importAdminPost();
    const res = await POST(
      mkReq('http://localhost/api/admin/api-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: before[0].id }),
      }),
    );
    expect(res.status).toBe(200);
    const after = await listActiveQuotaAlerts();
    expect(after).toHaveLength(0);
  });
});
