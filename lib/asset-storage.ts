/**
 * Asset Persistent Storage (v2.9)
 *
 * 背景:
 *   v2.8 之前,生成的图片 / 视频 / 音频都存在 /tmp 或上游 CDN (Midjourney / Minimax
 *   的临时 URL),这两处都会失效 —— /tmp 重启丢,CDN 24h 过期。用户打开老项目
 *   经常看到 404。
 *
 * 解决方案:
 *   在 data/storage/assets/ 下建本地持久盘,按 sha256 分桶存 blob。
 *   每次生成资产时 persistAsset() 把源 URL 下载并存一份,返回 /api/serve-file
 *   的稳定 URL (带 ?key=<sha>) 写进 DB 的 persistent_url 字段。
 *   serve-file 路由按 key 读持久盘,不存在才回退到原始 URL 透传。
 */

import fs from 'fs';
import { shouldRefuseSweep } from './cleanup-guard';
import path from 'path';
import crypto from 'crypto';
import { getStorageDriver, LOCAL_STORAGE_ROOT } from './storage';

// v10.4.4: 目录常量统一收口到 lib/storage(写侧 adapter 与读侧 resolveByKey 同源)
const STORAGE_ROOT = LOCAL_STORAGE_ROOT;

/**
 * v12.253(对抗复检):出站抓取的**单文件字节上限**。此前 http(s) 分支直接
 * `Buffer.from(await resp.arrayBuffer())`,无任何大小限制 —— 登录用户传一个超大图/视频 URL
 * 就能把整份 payload 灌进 Node 堆,几个并发即 OOM。默认 64MB(足够高清漫画/短视频封面),
 * 可用 ASSET_MAX_REMOTE_BYTES 覆盖。
 */
export const MAX_REMOTE_BYTES = (() => {
  const n = Number(process.env.ASSET_MAX_REMOTE_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 64 * 1024 * 1024;
})();

/**
 * 流式读取 Response body,累计字节超过 maxBytes 即中止并返回 null(只会驻留约 maxBytes+一个 chunk,
 * 不会全量入堆)。用于给「按内容 hash 落地」的出站抓取限流。会先看 Content-Length(诚实大文件早拒),
 * 再流式兜底(挡撒谎/chunked)。
 */
export async function readBodyCapped(resp: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(resp.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = resp.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    // 无可读流(少见):退回 arrayBuffer,但读后校验大小(此路径仍可能瞬时入堆,故仅兜底)
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* noop */ }
          return null;
        }
        chunks.push(value);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  return Buffer.concat(chunks);
}

// 确保目录存在(只在首次调用时创建)
let storageEnsured = false;
function ensureStorage() {
  if (storageEnsured) return;
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  storageEnsured = true;
}

/**
 * 根据 URL 或 Buffer 的内容计算 sha256 key。
 */
export function hashKey(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * 推断 MIME / 扩展名
 */
export function extFromContentType(ct: string): string {
  const m: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a',
  };
  const base = ct.split(';')[0].trim().toLowerCase();
  return m[base] || '.bin';
}

export function extFromUrl(url: string): string {
  const u = url.split('?')[0];
  const e = path.extname(u).toLowerCase();
  if (e && e.length <= 6) return e;
  return '';
}

export interface PersistedAsset {
  /** sha256[0..31] 作为 key,也是文件名 stem */
  key: string;
  /** 绝对路径,本地 fs 访问用 */
  absPath: string;
  /** 暴露给前端的 URL: /api/serve-file?key=xxx */
  url: string;
  /** MIME */
  contentType: string;
  /** 字节数 */
  size: number;
}

/**
 * 把一个 URL 或 Buffer 持久化到本地 storage,返回稳定 URL。
 * - 如果 URL 是 data: URI,直接解码持久化
 * - 如果 URL 是本地 /api/serve-file?path=/tmp/... ,解析出 tmp 文件复制过来
 * - 如果 URL 是 http(s),fetch 下载再存
 *
 * 已存在的 key 不会重复下载。
 */
export async function persistAsset(
  sourceUrl: string,
  hint?: { contentType?: string; ext?: string },
): Promise<PersistedAsset | null> {
  if (!sourceUrl) return null;
  ensureStorage();

  let buffer: Buffer;
  let contentType = hint?.contentType || '';
  let ext = hint?.ext || '';

  try {
    if (sourceUrl.startsWith('data:')) {
      // data: URI 直接解码
      const m = sourceUrl.match(/^data:([^;,]+)[^,]*,(.*)$/);
      if (!m) return null;
      contentType = contentType || m[1];
      const isBase64 = /;base64/i.test(sourceUrl.slice(0, sourceUrl.indexOf(',')));
      buffer = isBase64
        ? Buffer.from(m[2], 'base64')
        : Buffer.from(decodeURIComponent(m[2]), 'utf8');
    } else if (sourceUrl.startsWith('/api/serve-file')) {
      // v12.237(第四轮对抗复检 · CRITICAL):此处此前用 URLSearchParams 取 path **直接 readFileSync**,
      // 不验签、无白名单 —— cameo/pull-sheet/video-anchor 把用户 body 的 ?path= 喂进来即可读任意文件。
      // 现在强制走 resolveVerifiedServeFilePath:验 HMAC 签名 + 目录白名单,不过关就拒。
      const { resolveVerifiedServeFilePath } = await import('./serve-file-sign');
      const localPath = resolveVerifiedServeFilePath(sourceUrl);
      if (!localPath) {
        console.warn(`[asset-storage] serve-file ?path= 未签名/越界,拒读:${sourceUrl.slice(0, 90)}`);
        return null;
      }
      buffer = fs.readFileSync(localPath);
      ext = ext || path.extname(localPath);
    } else if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
      // 外链: fetch 下来(30s 超时)
      // v12.235:改走 safeFetch —— 本函数是**服务端按传入 URL 主动出站**的地方,而
      // upload/character-face 等入口可由用户提供 imageUrl,此前零 IP 过滤,等于开放 SSRF;
      // 且 fetch 默认跟随重定向,只校验初始 URL 挡不住 302 到云元数据。safeFetch 逐跳重验。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
      try {
        const { safeFetch } = await import('./ssrf-guard');
        resp = await safeFetch(sourceUrl, { signal: controller.signal });
      } catch (e) {
        clearTimeout(timer);
        console.warn(`[asset-storage] 出站被拒 ${sourceUrl.slice(0, 80)}: ${e instanceof Error ? e.message : 'unknown'}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        console.warn(`[asset-storage] fetch failed ${resp.status}: ${sourceUrl.slice(0, 80)}`);
        return null;
      }
      contentType = contentType || resp.headers.get('content-type') || '';
      // v12.253:限流读取,超 MAX_REMOTE_BYTES 即中止(防超大远端文件 OOM)。
      const capped = await readBodyCapped(resp, MAX_REMOTE_BYTES);
      if (!capped) {
        console.warn(`[asset-storage] 远端文件超过 ${MAX_REMOTE_BYTES}B 上限或过大,拒:${sourceUrl.slice(0, 80)}`);
        return null;
      }
      buffer = capped;
    } else {
      // 绝对文件路径 fallback —— v12.237(第四轮对抗复检):此前直接 readFileSync 任意路径,
      // 无白名单。而 cameo 等入口的 imageUrl 无前缀校验,用户传裸 `/etc/passwd` 就走这里读任意文件
      // (与 ?path= 侧门同源,只是少了 /api/serve-file 前缀)。现在裸路径也必须落在白名单目录内。
      const { isServeFilePathAllowed } = await import('./serve-file-sign');
      if (!isServeFilePathAllowed(sourceUrl) || !fs.existsSync(sourceUrl)) {
        console.warn(`[asset-storage] 裸本地路径越界/不存在,拒读:${String(sourceUrl).slice(0, 90)}`);
        return null;
      }
      buffer = fs.readFileSync(sourceUrl);
      ext = ext || path.extname(sourceUrl);
    }

    // 计算 key (按内容 hash,相同内容只存一份)
    const key = hashKey(buffer);
    ext = ext || extFromContentType(contentType) || extFromUrl(sourceUrl) || '.bin';

    // v12.343:扩展名必须带前导点。调用方写 `{ ext: 'png' }`(5 处这样写过)会落盘成
    // `<key>png` —— serve 侧 resolveByKey 用**前缀匹配**照样能取到,于是没人发现;
    // 而 cleanup 侧用**去扩展名**反推 key,反推不出来 → 判为孤儿 → 到期删除。
    // 「能播放但会被删」是最难发现的一类,所以在源头归一,而不是逐个改调用点。
    if (ext && !ext.startsWith('.')) ext = '.' + ext;

    // v10.4.4: 写入走 storage adapter —— local(默认)同目录同布局,行为与历史一致;
    // s3 时上传对象存储(URL 指向 S3)且同时写本地副本(absPath/serve-file 消费方不变)。
    const put = await getStorageDriver().put(key, ext, buffer, contentType || 'application/octet-stream');

    return {
      key,
      absPath: put.absPath,
      url: put.url,
      contentType: contentType || 'application/octet-stream',
      size: buffer.length,
    };
  } catch (e) {
    console.warn(`[asset-storage] persist failed: ${sourceUrl.slice(0, 80)} — ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * v2.9: 对数据库行做 mediaUrls + persistentUrl 的标准化。
 * - 若 DB 有 persistent_url,用它覆盖 mediaUrls[0] (第一条通常是主封面/主视频)
 * - 同时把 persistentUrl 暴露出去,让前端能显式区分原始 URL 和持久化副本
 *
 * 调用点: /api/assets, /api/projects/[id], /api/projects/[id]/assets, 等。
 */
export function normalizeAssetRow<T extends { media_urls?: string; persistent_url?: string | null }>(
  row: T,
): { mediaUrls: string[]; persistentUrl: string | null } {
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(row.media_urls || '[]');
  } catch {
    mediaUrls = [];
  }
  const persistentUrl = row.persistent_url || null;
  // 持久化 URL 优先 —— 外链可能已 404,持久化文件一定能打开
  if (persistentUrl && mediaUrls.length > 0) {
    mediaUrls = [persistentUrl, ...mediaUrls.slice(1)];
  } else if (persistentUrl && mediaUrls.length === 0) {
    mediaUrls = [persistentUrl];
  }
  return { mediaUrls, persistentUrl };
}

/**
 * v12.228 — S3 回源时的候选扩展名。
 *
 * 背景:`resolveByKey` 是**按前缀扫本地目录**找文件的,所以它天然不需要预先知道扩展名。
 * 但从 S3 回源必须给出完整 objectKey(`<key><ext>`),于是只能按本项目实际会产生的扩展名逐个试。
 * 顺序按命中率排(成片 mp4 / 分镜图 png-jpg 最常被 serve-file 请求),命中即停,
 * 未命中的候选只是一次 404 的 GET,成本可控。列表与 `extFromContentType` 的值域保持一致。
 */
const S3_FALLBACK_EXTS = ['.mp4', '.png', '.jpg', '.webp', '.mp3', '.wav', '.m4a', '.aac', '.webm', '.mov', '.gif', '.svg', '.bin'];

/**
 * 根据 key 拿到**本机可读**的文件;本地缺失时(且配了 S3)自动从 S3 回源一份。
 *
 * 病根(🟠-18 多 Pod serve-file 404):写侧虽然双写本地+S3,但本地副本**只在生成它的那个 Pod**。
 * 负载均衡把 `/api/serve-file?key=X` 打到 Pod-B 时,`resolveByKey` 只 readdir 本 Pod 目录 → null → 404。
 * 回源后本地就有了副本,后续该 Pod 上的 ffmpeg 类消费方(按 absPath 读)也一并受益。
 *
 * 单机(未配 S3):第一步就命中本地,**与原 `resolveByKey` 完全等价、零额外开销**。
 */
export async function resolveByKeyOrFetch(key: string): Promise<{ absPath: string; ext: string } | null> {
  const local = resolveByKey(key);
  if (local) return local;

  if (!/^[a-f0-9]{16,64}$/i.test(key)) return null;
  const { isS3Mode, ensureLocalCopy } = await import('./storage');
  if (!isS3Mode()) return null;

  for (const ext of S3_FALLBACK_EXTS) {
    const absPath = await ensureLocalCopy(key, ext);
    if (absPath) return { absPath, ext };
  }
  return null;
}

/**
 * 根据 key 查本地存储文件。找到返回绝对路径,否则 null。
 */
export function resolveByKey(key: string): { absPath: string; ext: string } | null {
  ensureStorage();
  // key 经过严格校验(仅 hex)
  if (!/^[a-f0-9]{16,64}$/i.test(key)) return null;
  // 遍历找扩展名(通常只有一个)
  try {
    const files = fs.readdirSync(STORAGE_ROOT);
    const match = files.find((f) => f.startsWith(key));
    if (match) {
      return {
        absPath: path.join(STORAGE_ROOT, match),
        ext: path.extname(match),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 按龄清理孤儿文件 —— **被引用的文件永不删除**。
 *
 * ## 这个函数曾经删掉了用户 30 个历史项目的全部素材
 *
 * 原实现只看 `mtimeMs < cutoff` 就 `unlinkSync`,**完全不查文件是否仍被项目引用**;
 * 函数头还写着「清理策略(未实装)」,而 `/api/cron/cleanup-media` 早已在调它。
 * 于是 2026 年 6-14 一次清理把 `data/storage/assets` 按 30 天龄清空:
 * 分镜 34、角色 51、场景 102、视频 168、成片 24 —— **在盘数全部归零**,
 * 而 `project_assets` 里 406 条 `serve-file?key=…` 引用原样保留。
 * 用户看到的是「历史项目视频全都播不了」,系统对此毫无察觉。
 * `unlinkSync` 不进废纸篓,没有 S3、没有 Time Machine —— **不可恢复**。
 *
 * ## 现在的规则
 * 删除前先把库里所有仍被引用的 key 读出来,**命中引用的一律跳过**,不管它多老。
 * 只有「无人引用的孤儿」才按龄清理 —— 那才是这个函数本来该做的事。
 * 读引用失败时(库锁、schema 变更)**一个都不删**:宁可多占磁盘,不可误删不可恢复的产物。
 */
export function listReferencedKeys(): Set<string> {
  const keys = new Set<string>();
  const { db } = require('./db');
  // persistent_url 与 media_urls 两处都可能带 key,都要认
  const rows = db.prepare(
    `SELECT persistent_url, media_urls FROM project_assets
     WHERE persistent_url LIKE '%serve-file%' OR media_urls LIKE '%serve-file%'`,
  ).all() as Array<{ persistent_url?: string; media_urls?: string }>;
  for (const r of rows) {
    for (const blob of [r.persistent_url || '', r.media_urls || '']) {
      for (const m of blob.matchAll(/key=([0-9a-zA-Z_-]+)/g)) keys.add(m[1]);
    }
  }
  return keys;
}

export function cleanup(opts?: { maxAgeDays?: number; dryRun?: boolean }): {
  removed: number; skippedReferenced: number; freedMB: number; aborted?: string;
} {
  ensureStorage();
  const days = opts?.maxAgeDays ?? 30;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;

  // 读不到引用就**什么都不删** —— 删除不可逆,而多占磁盘是可逆的。
  let referenced: Set<string>;
  try {
    referenced = listReferencedKeys();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[storage-cleanup] 读引用失败,本次不删任何文件:${why}`);
    return { removed: 0, skippedReferenced: 0, freedMB: 0, aborted: why.slice(0, 160) };
  }

  let removed = 0, skippedReferenced = 0, freed = 0;
  try {
    // v12.399:先**统计**一遍再决定删不删 —— 与 cleanup-media 的 sweepDir 同一道防线。
    // 边走边删的话,等发现「一个文件都没被引用」时,前面的已经删掉了。
    const tally = { total: 0, referenced: 0 };
    const doomed: Array<{ path: string; size: number }> = [];
    for (const f of fs.readdirSync(STORAGE_ROOT)) {
      const p = path.join(STORAGE_ROOT, f);
      let stat: fs.Stats;
      try { stat = fs.statSync(p); } catch { continue; }
      if (!stat.isFile()) continue;
      tally.total++;
      // v12.343:必须与 resolveByKey 的**前缀匹配**同语义。原来这里用「去扩展名」,
      // 对 `<key>png`(缺点)反推出 `<key>png` ≠ 引用表里的 `<key>` → 误判孤儿。
      // 存量坏文件也靠这行保住(源头修了,但已落盘的还在)。
      const m = f.match(/^([a-f0-9]{16,64})/i);
      const key = m ? m[1] : f.replace(/\.[^.]*$/, '');
      if (referenced.has(key)) { tally.referenced++; continue; }   // 被引用 → 永不删
      if (stat.mtimeMs >= cutoff) continue;
      doomed.push({ path: p, size: stat.size });
    }

    // v12.399:这条 storage 路径此前**没有**这道自检 —— v12.398 只给 sweepDir 加了。
    // 而它管着 160 个素材文件,同一个病要犯第二次的话就是它。
    const verdict = shouldRefuseSweep(tally, 'storage/assets');
    if (verdict.refuse) {
      console.error(`[storage-cleanup] ${verdict.reason}`);
      return { removed: 0, skippedReferenced: 0, freedMB: 0, aborted: 'refused-nothing-referenced' };
    }

    for (const d of doomed) {
      if (!opts?.dryRun) fs.unlinkSync(d.path);
      freed += d.size;
      removed++;
    }
    skippedReferenced = tally.referenced;
  } catch (e) {
    console.warn('[storage-cleanup] 遍历中断:', e instanceof Error ? e.message : e);
  }
  console.log(`[storage-cleanup] ${opts?.dryRun ? '(干跑)' : ''}删除孤儿 ${removed} 个 · 因被引用跳过 ${skippedReferenced} 个 · 释放 ${Math.round(freed / 1048576)}MB`);
  return { removed, skippedReferenced, freedMB: Math.round(freed / 1048576) };
}
