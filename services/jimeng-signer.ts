/**
 * 即梦 / 火山引擎 API 签名工具（v2.0 Sprint 0 D2）
 *
 * 火山引擎使用 Volc4 签名协议（AWS SigV4 衍生版），基于 HMAC-SHA256。
 *
 * 参考文档: https://www.volcengine.com/docs/6369/67269
 *
 * 签名流程：
 *   1. 构造 CanonicalRequest
 *   2. 构造 StringToSign（含 CredentialScope）
 *   3. 派生签名密钥（kDate -> kRegion -> kService -> kSigning）
 *   4. HMAC-SHA256 计算 Signature
 *   5. 组装 Authorization header
 *
 * 典型用法：
 *   const { authorization, headers } = signRequest({
 *     method: 'POST',
 *     host: 'visual.volcengineapi.com',
 *     path: '/',
 *     query: { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' },
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ req_key: 'jimeng_vgfm_i2v_l21', ... }),
 *     accessKey: JIMENG_AK,
 *     secretKey: JIMENG_SK,
 *     region: 'cn-north-1',
 *     service: 'cv',
 *   });
 */

import { createHash, createHmac } from 'crypto';

export interface SignRequestInput {
  /** HTTP 方法（大写），如 'POST' */
  method: string;
  /** Host（不含 schema），如 'visual.volcengineapi.com' */
  host: string;
  /** Path，必须以 / 开头，如 '/' */
  path: string;
  /** Query 参数对象 */
  query?: Record<string, string | number | undefined>;
  /** 请求头对象（key 大小写无关） */
  headers?: Record<string, string>;
  /** Body 字符串（POST/PUT 时为 JSON 序列化字符串，GET/DELETE 为 ''） */
  body?: string;
  /** 火山引擎 Access Key ID */
  accessKey: string;
  /** 火山引擎 Secret Access Key */
  secretKey: string;
  /** 区域，默认 cn-north-1 */
  region?: string;
  /** 服务名，默认 cv（计算机视觉） */
  service?: string;
  /** 固定时间（可选，仅单测使用以保证确定性）；ISO UTC 字符串 */
  timestamp?: Date;
}

export interface SignRequestOutput {
  /** Authorization 头完整值 */
  authorization: string;
  /** 建议的完整请求头（已加入 X-Date / Host / Content-Type / Authorization） */
  headers: Record<string, string>;
  /** ISO8601 basic format 时间戳，如 20260408T123456Z */
  xDate: string;
  /** yyyymmdd 形式的日期，如 20260408 */
  date: string;
  /** Canonical request 字符串（debug 用） */
  canonicalRequest: string;
  /** StringToSign 字符串（debug 用） */
  stringToSign: string;
  /** 最终 Signature (hex) */
  signature: string;
}

const ALGORITHM = 'HMAC-SHA256';

/** HEX 形式的 SHA256 摘要 */
function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Raw Buffer HMAC-SHA256 */
function hmacBuf(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HEX HMAC-SHA256 */
function hmacHex(key: string | Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

/**
 * 规范化（URL encode per Volc4 / RFC 3986）
 * 注意：Volc4 要求 encodeURIComponent 的语义 + 保留 `~` 不转义 + 空格用 %20。
 */
function volcEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/** 把 query 对象序列化为按 key 排序的 canonical form */
function buildCanonicalQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const pairs: string[] = [];
  const keys = Object.keys(query).sort();
  for (const k of keys) {
    const v = query[k];
    if (v === undefined || v === null) continue;
    pairs.push(`${volcEncode(k)}=${volcEncode(String(v))}`);
  }
  return pairs.join('&');
}

/**
 * 构造 canonical headers + signed headers.
 * 要求：
 *  - header name 转小写
 *  - header value 去除首尾空白并压缩内部连续空白
 *  - 按 name 字典序排序
 *  - 行尾 \n
 *  - signed headers = 排序后的 name 列表，; 分隔
 */
function buildCanonicalHeaders(headers: Record<string, string>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowered[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  const sortedKeys = Object.keys(lowered).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${lowered[k]}`).join('\n') + '\n';
  const signedHeaders = sortedKeys.join(';');
  return { canonicalHeaders, signedHeaders };
}

/** 把 Date 拆成 yyyyMMdd + yyyyMMddTHHmmssZ (均为 UTC，basic ISO) */
function formatDate(d: Date): { date: string; xDate: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const date = `${y}${m}${day}`;
  const xDate = `${date}T${hh}${mm}${ss}Z`;
  return { date, xDate };
}

/**
 * 派生签名密钥 —— 逐级 HMAC
 *   kDate = HMAC(SK, date)
 *   kRegion = HMAC(kDate, region)
 *   kService = HMAC(kRegion, service)
 *   kSigning = HMAC(kService, 'request')
 */
export function deriveSigningKey(
  secretKey: string,
  date: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacBuf(secretKey, date);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, service);
  const kSigning = hmacBuf(kService, 'request');
  return kSigning;
}

/** 主入口：对一次 HTTP 请求生成完整签名 */
export function signRequest(input: SignRequestInput): SignRequestOutput {
  const {
    method,
    host,
    path,
    query,
    body = '',
    accessKey,
    secretKey,
    region = 'cn-north-1',
    service = 'cv',
  } = input;

  const now = input.timestamp ?? new Date();
  const { date, xDate } = formatDate(now);

  // 合并用户 headers + 必填 headers（Host / X-Date）
  const mergedHeaders: Record<string, string> = {
    ...(input.headers ?? {}),
    host,
    'x-date': xDate,
  };
  // 火山引擎要求 X-Content-Sha256 也纳入签名（可选但强烈建议）
  const payloadHash = sha256Hex(body);
  mergedHeaders['x-content-sha256'] = payloadHash;

  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(mergedHeaders);
  const canonicalQuery = buildCanonicalQueryString(query);

  // CanonicalRequest
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${date}/${region}/${service}/request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  // StringToSign
  const stringToSign = [ALGORITHM, xDate, credentialScope, hashedCanonicalRequest].join('\n');

  // Signing key -> signature
  const signingKey = deriveSigningKey(secretKey, date, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  const authorization =
    `${ALGORITHM} Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    headers: {
      ...mergedHeaders,
      authorization,
    },
    xDate,
    date,
    canonicalRequest,
    stringToSign,
    signature,
  };
}

/** 从环境变量读取凭证，便于 service 层调用 */
export function getJimengCredentials() {
  const accessKey = process.env.JIMENG_AK || '';
  const secretKey = process.env.JIMENG_SK || '';
  const region = process.env.JIMENG_REGION || 'cn-north-1';
  const service = process.env.JIMENG_SERVICE || 'cv';
  return { accessKey, secretKey, region, service };
}

export function hasJimengCredentials(): boolean {
  const { accessKey, secretKey } = getJimengCredentials();
  return !!(accessKey && secretKey && !accessKey.startsWith('your_'));
}
