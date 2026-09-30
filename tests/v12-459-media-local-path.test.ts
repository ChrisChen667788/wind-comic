/**
 * v12.459 · lib/media-local-path —— 数据库里的媒体地址 → 本地文件,逐帧检视与片段重拍共用一份。
 *
 * 读盘是任意文件读取面(v12.236:只给 HTTP 端点验签、漏了服务端本地读盘)。这里按**行为**锁:
 * 签名对且在白名单内才给路径;签名不对、越出白名单、裸路径一律 null;远端地址不开 allowRemote 不下载。
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLocalMediaPath } from '@/lib/media-local-path';
import { serveFilePathUrl } from '@/lib/serve-file-sign';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v12459-mlp-'));
const file = path.join(dir, 'clip.mp4');
fs.writeFileSync(file, 'x');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('v12.459 · resolveLocalMediaPath', () => {
  it('签名正确、在白名单内的 ?path= → 本地路径,不是临时文件', async () => {
    const r = await resolveLocalMediaPath(serveFilePathUrl(file));
    expect(r).toEqual({ path: path.resolve(file), tempFile: null });
  });

  it('**签名被篡改** → null(不退化成「直接读 path 参数」)', async () => {
    const forged = serveFilePathUrl(file).replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === '0' ? '1' : '0'}`);
    expect(forged).not.toBe(serveFilePathUrl(file));
    expect(await resolveLocalMediaPath(forged)).toBeNull();
  });

  it('**没签名的 ?path=** → null', async () => {
    expect(await resolveLocalMediaPath(`/api/serve-file?path=${encodeURIComponent(file)}`)).toBeNull();
  });

  it('签名对但**越出白名单**(如 /etc/hosts)→ null', async () => {
    expect(await resolveLocalMediaPath(serveFilePathUrl('/etc/hosts'))).toBeNull();
  });

  it('裸绝对路径、空值、看不懂的字符串 → null(不猜)', async () => {
    expect(await resolveLocalMediaPath(file)).toBeNull();
    expect(await resolveLocalMediaPath('')).toBeNull();
    expect(await resolveLocalMediaPath(null)).toBeNull();
    expect(await resolveLocalMediaPath('ftp://x/y.mp4', { allowRemote: true })).toBeNull();
  });

  it('远端地址:不开 allowRemote 就不下载(逐帧检视只认站内文件)', async () => {
    expect(await resolveLocalMediaPath('https://cdn.example.com/a.mp4')).toBeNull();
  });

  it('远端地址走 safeFetch(SSRF 防护):指向内网的地址被拒,而不是被下载', async () => {
    await expect(resolveLocalMediaPath('http://127.0.0.1:1/a.mp4', { allowRemote: true })).rejects.toThrow();
  });

  it('?key= 形态解析不到内容时 → null(key 是内容哈希,不构成路径)', async () => {
    expect(await resolveLocalMediaPath('/api/serve-file?key=deadbeef00000000000000000000000000000000')).toBeNull();
  });
});

describe('v12.459 · 远端下载先看声明大小', () => {
  it('Content-Length 超上限 → 直接拒,**不读响应体**(先读完再比会把进程撑爆)', async () => {
    const { downloadToTempFile } = await import('@/lib/remote-media');
    let bodyRead = false;
    const fetchImpl = (async () => ({
      ok: true, status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? String(3 * 1024 * 1024 * 1024) : null) },
      arrayBuffer: async () => { bodyRead = true; return new ArrayBuffer(8); },
    })) as unknown as typeof fetch;
    await expect(downloadToTempFile('https://cdn.example.com/huge.mp4', { fetchImpl, maxBytes: 512 * 1024 * 1024 })).rejects.toThrow(/过大/);
    expect(bodyRead).toBe(false);
  });

  it('没给 Content-Length 的照旧读完再比', async () => {
    const { downloadToTempFile } = await import('@/lib/remote-media');
    const fetchImpl = (async () => ({
      ok: true, status: 200, headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(64),
    })) as unknown as typeof fetch;
    await expect(downloadToTempFile('https://cdn.example.com/x.mp4', { fetchImpl, maxBytes: 16 })).rejects.toThrow(/过大/);
  });
});
