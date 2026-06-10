/**
 * v10.4.4 — storage adapter 单测。
 * 覆盖:SigV4 对 AWS 官方测试向量验签、local 落盘布局/URL/去重、
 * env 选择器(默认 local / s3 配齐才生效)、S3 失败降级 local、公网 base URL。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  sigv4Headers,
  storagePut,
  contentHashKey,
  getStorageDriver,
  s3ConfigFromEnv,
  LOCAL_STORAGE_ROOT,
} from '@/lib/storage';

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.S3_PUBLIC_BASE_URL;
});

afterEach(() => {
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, savedEnv);
  vi.unstubAllGlobals();
});

describe('v10.4.4 · SigV4(AWS 官方测试向量)', () => {
  it('GET iam ListUsers @20150830 → 官方签名逐字节一致', () => {
    // https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html
    const h = sigv4Headers({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      payloadSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha256("")
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'iam',
      amzDate: '20150830T123600Z',
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
      'SignedHeaders=content-type;host;x-amz-date, ' +
      'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});

describe('v10.4.4 · local driver(默认)', () => {
  it('落盘布局 <sha32><ext> + serve-file URL + 同内容去重', async () => {
    const body = Buffer.from(`storage-test-${Math.PI}`);
    const a = await storagePut(body, 'video/mp4', '.mp4');
    expect(a.driver).toBe('local');
    expect(a.key).toBe(contentHashKey(body));
    expect(a.key).toMatch(/^[a-f0-9]{32}$/);
    expect(a.url).toBe(`/api/serve-file?key=${a.key}`);
    expect(a.absPath).toBe(path.join(LOCAL_STORAGE_ROOT, `${a.key}.mp4`));
    expect(fs.existsSync(a.absPath)).toBe(true);
    const b = await storagePut(body, 'video/mp4', '.mp4');
    expect(b.absPath).toBe(a.absPath); // 同内容同位
  });
});

describe('v10.4.4 · env 选择器', () => {
  it('默认 local;STORAGE_DRIVER=s3 但配置不全 → 回退 local', () => {
    expect(getStorageDriver().id).toBe('local');
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9000'; // 缺 bucket/keys
    expect(s3ConfigFromEnv()).toBeNull();
    expect(getStorageDriver().id).toBe('local');
  });

  it('配齐 → s3(endpoint 去尾斜杠,region 默认 us-east-1)', () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9000/';
    process.env.S3_BUCKET = 'qfmj';
    process.env.S3_ACCESS_KEY_ID = 'ak';
    process.env.S3_SECRET_ACCESS_KEY = 'sk';
    const cfg = s3ConfigFromEnv()!;
    expect(cfg.endpoint).toBe('http://127.0.0.1:9000');
    expect(cfg.region).toBe('us-east-1');
    expect(getStorageDriver().id).toBe('s3');
  });
});

describe('v10.4.4 · s3 driver 行为', () => {
  beforeEach(() => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.S3_BUCKET = 'qfmj';
    process.env.S3_ACCESS_KEY_ID = 'ak';
    process.env.S3_SECRET_ACCESS_KEY = 'sk';
  });

  it('上传成功 → URL 指向对象存储(S3_PUBLIC_BASE_URL 优先),且本地副本仍写', async () => {
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com/assets/';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const body = Buffer.from(`s3-ok-${Math.E}`);
    const r = await storagePut(body, 'image/png', '.png');
    expect(r.driver).toBe('s3');
    expect(r.url).toBe(`https://cdn.example.com/assets/${r.key}.png`);
    expect(fs.existsSync(r.absPath)).toBe(true); // ffmpeg 类消费方依赖本地副本
  });

  it('S3 挂了 → 降级 local URL,产物不丢', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const body = Buffer.from(`s3-down-${Math.SQRT2}`);
    const r = await storagePut(body, 'image/png', '.png');
    expect(r.driver).toBe('local');
    expect(r.url).toBe(`/api/serve-file?key=${r.key}`);
    expect(fs.existsSync(r.absPath)).toBe(true);
  });
});
