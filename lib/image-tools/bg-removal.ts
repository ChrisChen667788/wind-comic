/**
 * 产品抠图 / 背景移除 provider(v12.55.0)。
 *
 * 电商核心痛点:产品在不同分镜里背景杂乱、产品本体不一致。抠图后可把**同一张干净产品图**
 * 复用到多镜 / 片尾卡 / 场景合成,保产品一致性。
 *
 * **商用许可**:本集成默认走 `rembg`(库 MIT + 默认 u2net 模型 Apache-2.0)—— 对商业产品安全;
 * 刻意**不**用 BRIA RMBG(CC BY-NC 非商用,商用需付费)。两种后端,按 env 探测,都没有则优雅报错(调用方可跳过):
 *   - HTTP:`BG_REMOVAL_URL`(如自托管 `rembg s` 服务)→ POST 图片拿回透明 PNG。
 *   - CLI:`REMBG_CMD`(默认 `rembg`)在 PATH 里 → `rembg i <in> <out>`。
 *
 * 本文件纯逻辑(命令拼装 / 后端探测)可单测;真正跑子进程 / HTTP 在 removeBackground。
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';

export type BgRemovalBackend =
  | { kind: 'http'; url: string }
  | { kind: 'rembg-cli'; cmd: string };

/** `rembg i [-m model] <input> <output>` 的参数(纯函数,可测)。 */
export function rembgCliArgs(input: string, output: string, model?: string): string[] {
  return ['i', ...(model ? ['-m', model] : []), input, output];
}

/** 按 env 解析后端:HTTP 优先(无需本机装 Python),否则 rembg CLI。都没显式配置则探测 PATH 里的 rembg。 */
export function resolveBgRemovalBackend(env: NodeJS.ProcessEnv = process.env): BgRemovalBackend | null {
  if (env.BG_REMOVAL_URL && /^https?:\/\//.test(env.BG_REMOVAL_URL)) {
    return { kind: 'http', url: env.BG_REMOVAL_URL };
  }
  if (env.REMBG_CMD && env.REMBG_CMD.trim()) {
    return { kind: 'rembg-cli', cmd: env.REMBG_CMD.trim() };
  }
  return null;
}

/** 探测 rembg CLI 是否在 PATH(显式 REMBG_CMD 未设时的兜底)。 */
function probeRembgInPath(): string | null {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(which, ['rembg'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.split('\n')[0] || null;
  } catch {
    return null;
  }
}

/** 当前环境是否可用抠图(给调用方 gate:不可用就跳过,不报错连累主流程)。 */
export function bgRemovalAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!resolveBgRemovalBackend(env) || !!probeRembgInPath();
}

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return downloadToFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode && res.statusCode >= 400) { file.close(); fs.unlinkSync(dest); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

export interface BgRemovalResult { outputPath: string; method: 'http' | 'rembg-cli'; }

/**
 * 移除背景 → 透明 PNG。input 可为 http(s) URL / 本地路径。无可用后端 → 抛错(调用方应先 bgRemovalAvailable gate)。
 */
export async function removeBackground(
  inputPathOrUrl: string,
  opts?: { model?: string; outputDir?: string },
): Promise<BgRemovalResult> {
  const backend = resolveBgRemovalBackend() || (probeRembgInPath() ? { kind: 'rembg-cli' as const, cmd: 'rembg' } : null);
  if (!backend) throw new Error('背景抠图不可用:未配置 BG_REMOVAL_URL,且 PATH 无 rembg(pip install rembg)');

  const outDir = opts?.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'rembg-'));
  fs.mkdirSync(outDir, { recursive: true });

  // 取本地输入(支持 http(s) / data: / /api/serve-file?path= / 本地路径)
  let localInput = inputPathOrUrl;
  if (/^https?:\/\//.test(inputPathOrUrl)) {
    localInput = path.join(outDir, 'src');
    await downloadToFile(inputPathOrUrl, localInput);
  } else if (inputPathOrUrl.startsWith('data:')) {
    const m = inputPathOrUrl.match(/^data:[^;,]*;base64,(.*)$/);
    if (!m) throw new Error('removeBackground: 不支持的 data: URI');
    localInput = path.join(outDir, 'src.png');
    fs.writeFileSync(localInput, Buffer.from(m[1], 'base64'));
  } else if (inputPathOrUrl.startsWith('/api/serve-file')) {
    const lp = new URL(inputPathOrUrl, 'http://localhost').searchParams.get('path');
    if (!lp || !fs.existsSync(lp)) throw new Error('removeBackground: serve-file 本地路径不存在');
    localInput = lp;
  } else if (!fs.existsSync(inputPathOrUrl)) {
    throw new Error(`removeBackground: 源不存在 ${inputPathOrUrl.slice(0, 80)}`);
  }
  const outputPath = path.join(outDir, `cutout-${path.basename(localInput).replace(/\.[a-z0-9]+$/i, '')}.png`);

  if (backend.kind === 'rembg-cli') {
    execFileSync(backend.cmd, rembgCliArgs(localInput, outputPath, opts?.model), { stdio: 'pipe' });
    if (!fs.existsSync(outputPath)) throw new Error('rembg 未产出输出文件');
    return { outputPath, method: 'rembg-cli' };
  }

  // HTTP:POST 图片字节,拿回透明 PNG(兼容 rembg server `POST /api/remove`,字段名 file)
  const buf = fs.readFileSync(localInput);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'input.png');
  const res = await fetch(backend.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`抠图服务 HTTP ${res.status}`);
  const outBuf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, outBuf);
  return { outputPath, method: 'http' };
}

/**
 * v12.56.0 主管线产品/角色参考图自动抠净 → 跨镜复用保一致(电商核心痛点:产品本体跨镜漂移)。
 * **gated**:抠图后端不可用(默认)→ 原样返回,零行为改动;可用时逐张 removeBackground + persistAsset
 * (存储适配器:local serve-file / S3 公网 URL),失败保留原图(非阻塞)。
 * 注:抠图产物要喂外部图像/视频引擎需公网可达 → 生产建议 STORAGE_DRIVER=s3,本地 local 仅 UI/合成可用。
 */
export async function prepProductReferences(refUrls: Array<string | null | undefined>): Promise<string[]> {
  const refs = (refUrls || []).filter((u): u is string => !!u);
  if (!bgRemovalAvailable() || refs.length === 0) return refs;
  const { persistAsset } = await import('@/lib/asset-storage');
  const out: string[] = [];
  for (const url of refs) {
    if (url.startsWith('data:image/svg')) { out.push(url); continue; } // seed svg 不抠
    try {
      const { outputPath } = await removeBackground(url);
      const persisted = await persistAsset(outputPath, { contentType: 'image/png', ext: '.png' });
      out.push(persisted?.url || url); // 持久化失败 → 保留原图
    } catch (e) {
      console.warn('[bg-removal] 产品抠图失败,保留原图:', e instanceof Error ? e.message : e);
      out.push(url);
    }
  }
  return out;
}
