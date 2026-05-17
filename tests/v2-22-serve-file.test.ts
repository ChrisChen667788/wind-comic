/**
 * v2.22 fix #3 — serve-file allow data/composed + data/exports + data/storage,
 * 同时锁死 /etc /tmp 之外的随机路径 (security).
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 不 mock asset-storage — 直接走真路径
const { GET } = await import('@/app/api/serve-file/route');

function mkReq(qs: string): any {
  const url = new URL(`http://localhost:3000/api/serve-file?${qs}`);
  return {
    nextUrl: url,
    headers: { get: () => null },
  };
}

describe('v2.22 fix #3 · serve-file path allowlist', () => {
  it('允许 data/composed 下的文件 (200 or 404 if 缺)', async () => {
    const composedDir = path.join(process.cwd(), 'data', 'composed');
    if (!fs.existsSync(composedDir)) fs.mkdirSync(composedDir, { recursive: true });
    const testFile = path.join(composedDir, 'test-v2-22-allowlist.mp4');
    fs.writeFileSync(testFile, 'fake mp4');
    try {
      const req = mkReq(`path=${encodeURIComponent(testFile)}`);
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('允许 data/exports 下的文件', async () => {
    const dir = path.join(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, 'test-v2-22-allowlist.mp4');
    fs.writeFileSync(testFile, 'fake mp4');
    try {
      const req = mkReq(`path=${encodeURIComponent(testFile)}`);
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('允许 /tmp 路径 (legacy)', async () => {
    const tmp = path.join(os.tmpdir(), 'test-v2-22-tmp.mp4');
    fs.writeFileSync(tmp, 'fake');
    try {
      const req = mkReq(`path=${encodeURIComponent(tmp)}`);
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('拒绝 /etc/passwd (path traversal block)', async () => {
    const req = mkReq(`path=${encodeURIComponent('/etc/passwd')}`);
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('拒绝 data/composed/../../etc/passwd (resolved path traversal)', async () => {
    const evil = path.join(process.cwd(), 'data', 'composed', '..', '..', '..', 'etc', 'passwd');
    const req = mkReq(`path=${encodeURIComponent(evil)}`);
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('合法目录但文件不存在 → 404', async () => {
    const missing = path.join(process.cwd(), 'data', 'composed', 'nope-' + Date.now() + '.mp4');
    const req = mkReq(`path=${encodeURIComponent(missing)}`);
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('缺 path/key/proxy 参数 → 400', async () => {
    const req = mkReq('');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
