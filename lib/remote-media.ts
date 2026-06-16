/**
 * lib/remote-media (v12.3.4) — 远端/云媒体下载到临时文件(阶段二十二收官)。
 *
 * 背景:export-platform 此前只吃本地绝对路径,成片在云/远端(http(s) URL)→ 400 不可用。
 * 这里提供「选出远端 URL + 下载到临时文件」的最小工具,供 export-platform 在无本地源时回退。
 * 纯 URL 选取可单测;下载用注入式 fetch,单测不真打网络。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export function isRemoteUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

/** 从候选里挑第一个 http(s) 远端 URL(本地路径/serve-file/占位都跳过)。 */
export function pickRemoteVideoUrl(candidates: (string | null | undefined)[]): string | null {
  for (const u of candidates) if (isRemoteUrl(u)) return u;
  return null;
}

function guessExt(url: string, contentType: string | null): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mp4')) return '.mp4';
  if (ct.includes('webm')) return '.webm';
  if (ct.includes('quicktime') || ct.includes('mov')) return '.mov';
  const m = url.split('?')[0].match(/\.(mp4|webm|mov|m4v)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  dir?: string;
  ext?: string;
  /** 防御:超过此字节数视为异常拒绝(默认 2GB) */
  maxBytes?: number;
}

/** 下载远端视频到临时文件,返回本地绝对路径。调用方用完应自行删除。 */
export async function downloadToTempFile(url: string, opts: DownloadOptions = {}): Promise<string> {
  if (!isRemoteUrl(url)) throw new Error(`downloadToTempFile: 非远端 URL: ${url}`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`下载远端成片失败 HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  const max = opts.maxBytes ?? 2 * 1024 * 1024 * 1024;
  if (ab.byteLength > max) throw new Error(`远端成片过大(${ab.byteLength} > ${max})`);
  const ext = opts.ext || guessExt(url, res.headers?.get?.('content-type') ?? null);
  const dir = opts.dir || path.join(os.tmpdir(), 'qfmj-remote');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `vid-${crypto.randomBytes(8).toString('hex')}${ext}`);
  await fs.promises.writeFile(file, Buffer.from(ab));
  return file;
}
