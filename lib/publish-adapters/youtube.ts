/**
 * lib/publish-adapters/youtube (v12.3.3) — YouTube Data API v3 参考上传适配器(阶段二十二)。
 *
 * YouTube 有公开发布 API(videos.insert,resumable upload)→ 作 BYO 真上传的参考实现。
 *
 * 安全/诚实(关键):
 *   · 只消费用户已配的 access token(YOUTUBE_ACCESS_TOKEN)—— 我**不代做 OAuth**,
 *     用户自己在 Google OAuth Playground / 自有流程拿 token 填进 .env.local。
 *   · 无 token → isConfigured()=false → upload() 返回 status='manual' 降级,绝不假称 published。
 *   · 真上传需 opts.confirmed=true(outward-facing,路由层拿到用户确认才置)。
 *   · 网络与读视频通过 deps 注入 → 单测全 mock,绝不真打 Google。
 */
import type { PublishAdapter, UploadOptions, UploadResult } from './types';
import type { PublishPackage } from '../publish-package';

const RESUMABLE_INIT = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEO_QUERY = 'https://www.googleapis.com/youtube/v3/videos';

export interface YouTubeDeps {
  fetchImpl?: typeof fetch;
  /** 读成片字节(默认:http(s) 走 fetch,本地路径走 fs)。 */
  readVideo?: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  /** 读 access token(默认 env;便于测试注入) */
  getAccessToken?: () => string | undefined;
}

/** 默认读视频:远端 URL 用 fetch;本地文件路径用 fs。 */
async function defaultReadVideo(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`读取成片失败 HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return { bytes: new Uint8Array(ab), contentType: res.headers.get('content-type') || 'video/mp4' };
  }
  // 本地路径(/api/serve-file 背后的真文件 或绝对路径)
  const fs = await import('fs/promises');
  const path = url.replace(/^file:\/\//, '');
  const buf = await fs.readFile(path);
  return { bytes: new Uint8Array(buf), contentType: 'video/mp4' };
}

export function createYouTubeAdapter(deps: YouTubeDeps = {}): PublishAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readVideo = deps.readVideo ?? defaultReadVideo;
  const getToken = deps.getAccessToken ?? (() => process.env.YOUTUBE_ACCESS_TOKEN);

  function manual(message: string, instructions: string[]): UploadResult {
    return { status: 'manual', externalUrl: null, externalId: null, message, instructions };
  }

  return {
    platform: 'youtube_shorts',
    label: 'YouTube Shorts',
    mode: 'api',
    isConfigured: () => !!getToken(),

    async upload(pkg: PublishPackage, opts?: UploadOptions): Promise<UploadResult> {
      const token = getToken();
      if (!token) {
        return manual(
          '未配置 YOUTUBE_ACCESS_TOKEN —— 已生成可直发包,请手动上传或配置 token 后重试',
          [
            '在 Google Cloud 建 OAuth 凭据,授权 https://www.googleapis.com/auth/youtube.upload',
            '用 OAuth Playground 或自有流程拿 access token(我不代做 OAuth 授权)',
            '把 token 填进 .env.local 的 YOUTUBE_ACCESS_TOKEN,再回来点「发布」',
          ],
        );
      }
      if (!pkg.video.url) {
        return { status: 'failed', externalUrl: null, externalId: null, message: '缺成片 URL,无法上传' };
      }
      // 真上传是 outward-facing → 必须已确认
      if (!(opts?.confirmed)) {
        return manual('真上传需先确认(发布会公开到你的 YouTube 频道)', ['在发布面板勾选「确认真上传到 YouTube」后重试']);
      }

      try {
        const { bytes, contentType } = await readVideo(pkg.video.url);
        const metadata = {
          snippet: {
            title: (pkg.title || '未命名').slice(0, 100),
            description: [pkg.description, pkg.hashtags].filter(Boolean).join('\n\n').slice(0, 4900),
            tags: pkg.tags.slice(0, 15),
          },
          status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
        };

        // 1) 发起 resumable 会话,拿 upload session URI
        const init = await fetchImpl(RESUMABLE_INIT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType,
            'X-Upload-Content-Length': String(bytes.byteLength),
          },
          body: JSON.stringify(metadata),
        });
        if (!init.ok) {
          const t = await init.text().catch(() => '');
          return { status: 'failed', externalUrl: null, externalId: null, message: `YouTube 发起上传失败 HTTP ${init.status} ${t.slice(0, 200)}` };
        }
        const sessionUri = init.headers.get('location') || init.headers.get('Location');
        if (!sessionUri) return { status: 'failed', externalUrl: null, externalId: null, message: 'YouTube 未返回上传会话 URI' };

        // 2) PUT 视频字节到会话 URI
        const put = await fetchImpl(sessionUri, {
          method: 'PUT',
          headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength) },
          body: bytes as unknown as BodyInit,
        });
        if (!put.ok) {
          const t = await put.text().catch(() => '');
          return { status: 'failed', externalUrl: null, externalId: null, message: `YouTube 上传字节失败 HTTP ${put.status} ${t.slice(0, 200)}` };
        }
        const data: any = await put.json().catch(() => ({}));
        const id = data?.id;
        if (!id) return { status: 'failed', externalUrl: null, externalId: null, message: 'YouTube 上传成功但未返回视频 id' };
        return {
          status: 'published',
          externalId: id,
          externalUrl: `https://youtu.be/${id}`,
          message: `已上传到 YouTube(默认私有,去后台改公开)`,
        };
      } catch (e: any) {
        return { status: 'failed', externalUrl: null, externalId: null, message: `YouTube 上传异常:${e?.message || e}` };
      }
    },

    async status(externalId: string) {
      const token = getToken();
      if (!token || !externalId) return null;
      try {
        const res = await fetchImpl(`${VIDEO_QUERY}?part=status,processingDetails&id=${encodeURIComponent(externalId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data: any = await res.json().catch(() => null);
        const item = data?.items?.[0];
        if (!item) return null;
        return { state: item.status?.uploadStatus || 'unknown', url: `https://youtu.be/${externalId}` };
      } catch {
        return null;
      }
    },
  };
}
