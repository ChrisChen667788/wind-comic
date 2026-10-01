/**
 * lib/storage (v10.4.4) — 产物存储 adapter(local-disk 默认 / S3 兼容 BYO)。
 *
 * 动机(阶段十八 A):资产持久化此前只有本地盘一种归宿(data/storage/assets),
 * 多实例部署无法共享;lipsync 兜底引擎更是直接吐 data:video/mp4(多 MB base64
 * 走内存/JSON 边界)。本模块统一「写」侧:
 *
 *   - local(默认,零配置):与历史完全同目录同布局(<sha32><ext>),
 *     URL = /api/serve-file?key=<sha> —— 行为与 v10.4.3 前逐字节一致。
 *   - s3(BYO):`STORAGE_DRIVER=s3` + S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/
 *     S3_SECRET_ACCESS_KEY(可选 S3_REGION 默认 us-east-1、S3_PUBLIC_BASE_URL)。
 *     SigV4 手写(零新依赖,经 AWS 官方测试向量验签),path-style(MinIO/R2 兼容)。
 *     上传同时**仍写本地副本** —— absPath/serve-file 的 ffmpeg 类消费方
 *     (editor-score 抽帧、last-frame-extractor)需要本地文件;S3 失败降级 local-only。
 *
 * 读侧(serve-file/resolveByKey)不动:旧 URL 不迁移,新产物走本模块。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), 'data', 'storage', 'assets');

export interface StoragePutResult {
  key: string;
  ext: string;
  /** 暴露给消费方的 URL(local: /api/serve-file?key=…;s3: 公网对象 URL) */
  url: string;
  /** 本地副本绝对路径(两种 driver 都保证存在 —— ffmpeg 类消费方依赖) */
  absPath: string;
  size: number;
  driver: 'local' | 's3';
}

export interface StorageDriver {
  id: 'local' | 's3';
  put(key: string, ext: string, body: Buffer, contentType: string): Promise<StoragePutResult>;
}

export function contentHashKey(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

// ── local driver ────────────────────────────────────────────────────────────

function ensureRoot(): void {
  if (!fs.existsSync(LOCAL_STORAGE_ROOT)) fs.mkdirSync(LOCAL_STORAGE_ROOT, { recursive: true });
}

const localDriver: StorageDriver = {
  id: 'local',
  async put(key, ext, body) {
    ensureRoot();
    const absPath = path.join(LOCAL_STORAGE_ROOT, `${key}${ext}`);
    if (!fs.existsSync(absPath)) {
      // 临时名 + rename 原子落位(与 mock-assets 同款,防并发读到半截文件)
      const tmp = `${absPath}.part-${process.pid}`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, absPath);
    }
    return { key, ext, url: `/api/serve-file?key=${key}`, absPath, size: body.length, driver: 'local' };
  },
};

// ── SigV4(手写,零依赖)──────────────────────────────────────────────────

/** RFC 3986 严格编码(AWS 要求;encodeURIComponent 会放过 !'()*) */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function sha256Hex(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

export interface SigV4Input {
  method: string;
  url: URL;
  /** 需要签名的头(host 外自动补);键任意大小写 */
  headers: Record<string, string>;
  payloadSha256: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** ISO basic 格式 20150830T123600Z(测试向量注入用;生产取当前时间) */
  amzDate: string;
}

/**
 * 计算 SigV4 Authorization 头(经 AWS 官方测试向量验证,见 tests/storage.test.ts)。
 * 返回应附加到请求上的全部头(含 x-amz-date / x-amz-content-sha256 / authorization)。
 */
export function sigv4Headers(input: SigV4Input): Record<string, string> {
  const { method, url, payloadSha256, accessKeyId, secretAccessKey, region, service, amzDate } = input;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { host: url.host, ...Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
  ) };
  headers['x-amz-date'] = amzDate;

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalUri = url.pathname.split('/').map((seg) => rfc3986(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = Array.from(url.searchParams.entries())
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadSha256].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ── s3 driver ───────────────────────────────────────────────────────────────

interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicBaseUrl: string;
}

export function s3ConfigFromEnv(): S3Config | null {
  if (process.env.STORAGE_DRIVER !== 's3') return null;
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = process.env.S3_BUCKET || '';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || '';
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    if (!warnedIncomplete) {
      warnedIncomplete = true;
      console.warn('[storage] STORAGE_DRIVER=s3 但 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY 不全 —— 回退 local');
    }
    return null;
  }
  return {
    endpoint, bucket, accessKeyId, secretAccessKey,
    region: process.env.S3_REGION || 'us-east-1',
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  };
}
let warnedIncomplete = false;

/** S3 兼容 PUT(path-style)。导出供 MinIO 冒烟脚本复用。 */
export async function s3PutObject(cfg: S3Config, objectKey: string, body: Buffer, contentType: string): Promise<string> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const payloadSha256 = sha256Hex(body);
  const headers = sigv4Headers({
    method: 'PUT', url,
    headers: { 'content-type': contentType, 'x-amz-content-sha256': payloadSha256 },
    payloadSha256,
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    region: cfg.region, service: 's3', amzDate,
  });
  const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${objectKey}` : url.toString();
}

/**
 * v12.228 — S3 兼容 GET(path-style)。找不到对象返回 null(404/403 都算"没有")。
 *
 * 为什么以前没有:写侧一直**双写本地**,单 Pod 下本地必有副本,从没人需要从 S3 读回来。
 * 多 Pod 才暴露问题 —— Pod-A 写的文件,Pod-B 本地盘没有,而 `resolveByKey` 只 readdir 本地,
 * 于是 `/api/serve-file?key=…` 在 Pod-B 上必 404。补上 GET 才谈得上"回源"。
 * 同样手写 SigV4,零新依赖(不引 aws-sdk)。
 */
export async function s3GetObject(cfg: S3Config, objectKey: string): Promise<Buffer | null> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // GET 无 body,payload hash 是空串的 sha256(AWS 规定)
  const payloadSha256 = sha256Hex('');
  const headers = sigv4Headers({
    method: 'GET', url,
    headers: { 'x-amz-content-sha256': payloadSha256 },
    payloadSha256,
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    region: cfg.region, service: 's3', amzDate,
  });
  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`S3 GET ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * v12.228 — 按需回源:确保 `key+ext` 在**本机**有一份副本,返回其绝对路径;拿不到返回 null。
 *
 * 设计取舍(为什么是"按需回源"而不是路线图字面的"ffmpeg 全改成 S3 拉取→处理→回传"):
 * ffmpeg 消费方散布在 video-composer / last-frame-extractor / film-health-io / video-anchor 等
 * 十几处,逐处改成"拉取-处理-回传"改动面巨大且每处都要重写临时文件生命周期,风险远大于收益。
 * 而它们真正需要的只是**一个能读到的本地路径**。所以把"保证本地有副本"收敛成这一个函数:
 * 本地已有 → 直接用(单机永远走这条,**零行为变化、零额外 I/O**);本地缺失且配了 S3 → 从 S3 拉一份
 * 落到同一位置,后续所有消费方(含 ffmpeg)照旧按 absPath 读。
 */
export async function ensureLocalCopy(key: string, ext: string): Promise<string | null> {
  ensureRoot();
  const absPath = path.join(LOCAL_STORAGE_ROOT, `${key}${ext}`);
  if (fs.existsSync(absPath)) return absPath;

  const cfg = s3ConfigFromEnv();
  if (!cfg) return null; // 未配 S3 → 本地就是唯一真相,缺了就是真缺

  try {
    const buf = await s3GetObject(cfg, `${key}${ext}`);
    if (!buf) return null;
    // 临时名 + rename 原子落位(与 localDriver.put 同款,防并发读到半截文件)
    const tmp = `${absPath}.part-${process.pid}`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, absPath);
    return absPath;
  } catch (e) {
    console.warn(`[storage] S3 回源失败 ${key}${ext}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** v12.228:当前是否 S3 模式(供 serve-file 决定要不要回源/重定向)。 */
export function isS3Mode(): boolean {
  return s3ConfigFromEnv() !== null;
}

/** v12.228:对象的公网直链(配了 S3_PUBLIC_BASE_URL 才有),供 serve-file 302 重定向。 */
export function s3PublicUrl(objectKey: string): string | null {
  const cfg = s3ConfigFromEnv();
  if (!cfg || !cfg.publicBaseUrl) return null;
  return `${cfg.publicBaseUrl}/${objectKey}`;
}

function makeS3Driver(cfg: S3Config): StorageDriver {
  return {
    id: 's3',
    async put(key, ext, body, contentType) {
      // 本地副本先落(ffmpeg 类消费方依赖 absPath;S3 挂了也不丢产物)
      const local = await localDriver.put(key, ext, body, contentType);
      try {
        const url = await s3PutObject(cfg, `${key}${ext}`, body, contentType);
        return { ...local, url, driver: 's3' };
      } catch (e) {
        console.warn(`[storage] S3 上传失败,降级本地 URL: ${e instanceof Error ? e.message : e}`);
        return local;
      }
    },
  };
}

// ── 入口 ────────────────────────────────────────────────────────────────────

export function getStorageDriver(): StorageDriver {
  const cfg = s3ConfigFromEnv();
  return cfg ? makeS3Driver(cfg) : localDriver;
}

/** 便捷写入:按内容 hash 取 key(同内容只存一份)。 */
export async function storagePut(body: Buffer, contentType: string, ext: string): Promise<StoragePutResult> {
  // v12.463:扩展名统一带点。驱动直接拼 `${key}${ext}`,而导演台草图(v12.317 起)与逐帧检视的帧图传的是 'png' / 'jpg' ——
  // 落盘成 `<key>png`,没有扩展名:浏览器靠嗅探还能显示,toEngineImage 却认不出 MIME,本地图转不成 base64 送引擎。
  const e = ext && !ext.startsWith('.') ? `.${ext}` : ext;
  return getStorageDriver().put(contentHashKey(body), e, body, contentType);
}

/** 测试/工具用:本地临时目录写法(不进持久盘)。 */
export function tmpFilePath(name: string): string {
  const dir = path.join(os.tmpdir(), 'qfmj-storage-tmp');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
