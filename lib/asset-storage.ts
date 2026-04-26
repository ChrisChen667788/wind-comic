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
import path from 'path';
import crypto from 'crypto';

const STORAGE_ROOT = path.join(process.cwd(), 'data', 'storage', 'assets');

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
      // 本地 tmp 路径: 解析 ?path=... 并读取
      const urlObj = new URL(sourceUrl, 'http://localhost');
      const localPath = urlObj.searchParams.get('path');
      if (!localPath || !fs.existsSync(localPath)) return null;
      buffer = fs.readFileSync(localPath);
      ext = ext || path.extname(localPath);
    } else if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
      // 外链: fetch 下来(30s 超时)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        console.warn(`[asset-storage] fetch failed ${resp.status}: ${sourceUrl.slice(0, 80)}`);
        return null;
      }
      contentType = contentType || resp.headers.get('content-type') || '';
      buffer = Buffer.from(await resp.arrayBuffer());
    } else {
      // 绝对文件路径 fallback
      if (!fs.existsSync(sourceUrl)) return null;
      buffer = fs.readFileSync(sourceUrl);
      ext = ext || path.extname(sourceUrl);
    }

    // 计算 key (按内容 hash,相同内容只存一份)
    const key = hashKey(buffer);
    ext = ext || extFromContentType(contentType) || extFromUrl(sourceUrl) || '.bin';
    const filename = `${key}${ext}`;
    const absPath = path.join(STORAGE_ROOT, filename);

    // 已存在直接返回(去重)
    if (!fs.existsSync(absPath)) {
      fs.writeFileSync(absPath, buffer);
    }

    return {
      key,
      absPath,
      url: `/api/serve-file?key=${key}`,
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
 * 清理策略(未实装): 按 LRU 保留最近 30 天,防止磁盘爆掉。
 * 可以用 cron 调用 `cleanup({ maxAgeDays: 30 })`。
 */
export function cleanup(opts?: { maxAgeDays?: number }): { removed: number } {
  ensureStorage();
  const days = opts?.maxAgeDays ?? 30;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  try {
    const files = fs.readdirSync(STORAGE_ROOT);
    for (const f of files) {
      const p = path.join(STORAGE_ROOT, f);
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(p);
        removed++;
      }
    }
  } catch { /* ignore */ }
  return { removed };
}
