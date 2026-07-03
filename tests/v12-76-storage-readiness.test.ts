/**
 * v12.76 — 存储就绪度:local vs S3 与公网可达性。
 */
import { describe, it, expect } from 'vitest';
import { computeStorageReadiness } from '@/lib/engine-readiness';

describe('v12.76 · computeStorageReadiness', () => {
  it('缺省 local:不公网可达 + 提示配 S3', () => {
    const r = computeStorageReadiness({} as any);
    expect(r.driver).toBe('local');
    expect(r.publicReachable).toBe(false);
    expect(r.hint).toContain('S3');
  });

  it('S3 配齐 → 公网可达', () => {
    const r = computeStorageReadiness({ STORAGE_DRIVER: 's3', S3_ENDPOINT: 'e', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' } as any);
    expect(r.driver).toBe('s3');
    expect(r.publicReachable).toBe(true);
  });

  it('要 S3 但缺 key → 如实标降级 local', () => {
    const r = computeStorageReadiness({ STORAGE_DRIVER: 's3', S3_ENDPOINT: 'e' } as any);
    expect(r.driver).toBe('local');
    expect(r.hint).toContain('降级');
  });
});
