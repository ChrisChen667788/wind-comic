/**
 * lib/media-local-path — 把数据库里存的媒体地址解析成**本地文件**(ffmpeg 要的是文件,不是 URL)。v12.459。
 *
 * 此前这段逻辑只在逐帧检视(frame-strip 路由)里写过一份;片段重拍接线要读同样的「该镜活动版视频」,
 * 再抄一份就是这个仓最常见的病(同一语义各写一套,改了一处忘另一处)。收口到这里,两处共用。
 *
 * 认三种形态,顺序即优先级:
 *   1. `/api/serve-file?path=…&sig=…` —— **必须走验签入口** `resolveVerifiedServeFilePath`
 *      (v12.236 的教训:只给 HTTP 端点验签、漏了服务端本地读盘,于是 ?path= 可读任意文件)。
 *   2. `/api/serve-file?key=<内容哈希>` —— persistAsset 洗过的地址,走内容寻址;key 是哈希,不构成路径穿越面。
 *   3. `http(s)://…` 远端地址 —— 仅当调用方显式 `allowRemote`,经 `safeFetch`(SSRF 逐跳重验)下载到临时文件,
 *      由调用方用完删掉(返回的 tempFile 非 null 即需删除)。
 * 都不是 → null(不猜)。
 */
import { resolveVerifiedServeFilePath } from './serve-file-sign';

export interface LocalMediaFile {
  /** 本地绝对路径 */
  path: string;
  /** 非 null = 这是为本次调用下载的临时文件,调用方用完必须删除 */
  tempFile: string | null;
}

export async function resolveLocalMediaPath(
  url: string | null | undefined,
  opts: { allowRemote?: boolean; ext?: string; maxBytes?: number } = {},
): Promise<LocalMediaFile | null> {
  const u = String(url || '').trim();
  if (!u) return null;

  const verified = resolveVerifiedServeFilePath(u);
  if (verified) return { path: verified, tempFile: null };

  if (u.startsWith('/api/serve-file')) {
    try {
      const key = new URL(u, 'http://localhost').searchParams.get('key');
      if (key) {
        const { resolveByKey } = await import('./asset-storage');
        const hit = resolveByKey(key)?.absPath;
        return hit ? { path: hit, tempFile: null } : null;
      }
    } catch { /* 不是可解析的 URL */ }
    return null;
  }

  if (opts.allowRemote && /^https?:\/\//i.test(u)) {
    const [{ downloadToTempFile }, { safeFetch }] = await Promise.all([
      import('./remote-media'),
      import('./ssrf-guard'),
    ]);
    const file = await downloadToTempFile(u, {
      fetchImpl: ((input: string, init?: RequestInit) => safeFetch(input, init)) as unknown as typeof fetch,
      ext: opts.ext,
      maxBytes: opts.maxBytes,
    });
    return { path: file, tempFile: file };
  }
  return null;
}
