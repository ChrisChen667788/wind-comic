/**
 * v12.374:「URL 非空」不等于「文件还在」。
 *
 * 项目 1 的成片重合成返回 200 + `voiceover: 5`,ffprobe 也确实有音频流,
 * 而实测 mean_volume = **-91.0 dB —— 整条片子是哑的**。
 *
 * 根因不是新 bug,是一个只修了一半的旧 bug:
 * v12.124 把 TTS 落盘从 `os.tmpdir()/qf-audio` 挪到 `data/media/audio`,
 * 提交注释把后果写得清清楚楚 ——「旧 os.tmpdir()/qf-audio 会被 macOS GC
 * → recompose 配音 404」。但那版只动了**写入端**:
 * 历史 timeline 里存下的 /tmp URL 一个没变,而**消费端**至今只校验
 * `vo.audioUrl` 字符串非空。ffmpeg 拿到不存在的输入不会报错退出,
 * 它会安静地产出一条静音轨,于是接口一路绿灯,用户拿到哑片。
 *
 * 所以这里补的是消费端的防线:合成前先问「这个本地文件真的在吗」。
 *
 * 判定刻意做成三态,且**只拦 missing**:
 *   ok      —— 确认是本地文件且确实存在
 *   missing —— 确认指向本地文件,但文件不在了(唯一会被拦下的情况)
 *   unknown —— 远程 URL / 代理 / 解析不出 → 一律放行
 * 宁可放过一个可疑的远程链,也不能误杀一段真配音:
 * 误放的代价是「合成时才失败」,误杀的代价是「静悄悄少了声音」——
 * 而后者正是这个模块要消灭的东西。
 */

import fs from 'fs';
import { resolveByKey } from './asset-storage';
import { isServeFilePathAllowed, resolveVerifiedServeFilePath } from './serve-file-sign';

export type Reachability = 'ok' | 'missing' | 'unknown';

/** serve-file 的三种取材方式,只有前两种是本地文件 */
const SERVE_FILE_PATH = '/api/serve-file';

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * 判断一个媒体 URL 指向的本地文件是否还在。
 * 永不抛错 —— 任何解析失败都退化成 'unknown'(放行)。
 */
export function checkMediaReachable(url: string | null | undefined): Reachability {
  if (!url || typeof url !== 'string') return 'unknown';
  const raw = url.trim();
  if (!raw) return 'unknown';

  // 裸绝对路径(/Users/... 、/tmp/...),但要排开站内 API 路径。
  // 白名单先行:不在合法媒体根内的路径**根本不碰盘** —— 否则这个函数就成了
  // 「任意路径存在性探测器」,而它的入参里确实有用户可控的值(recompose 的 customBgm)。
  if (raw.startsWith('/') && !raw.startsWith('/api/')) {
    if (!isServeFilePathAllowed(raw)) return 'missing';
    return existsSafe(raw) ? 'ok' : 'missing';
  }

  let u: URL;
  try {
    // 相对 URL(/api/serve-file?...)需要 base 才能解析;base 本身不参与判定
    u = new URL(raw, 'http://localhost');
  } catch {
    return 'unknown';
  }

  if (u.protocol === 'file:') {
    const p = decodeURIComponent(u.pathname);
    if (!isServeFilePathAllowed(p)) return 'missing';
    return existsSafe(p) ? 'ok' : 'missing';
  }

  if (u.pathname !== SERVE_FILE_PATH) return 'unknown';

  // ?proxy= 是远程代理,不是本地文件
  const key = u.searchParams.get('key');
  if (key) {
    let hit: { absPath: string } | null = null;
    try {
      hit = resolveByKey(key);
    } catch {
      return 'unknown'; // 存储层自己出问题,不该记到素材头上
    }
    return hit && existsSafe(hit.absPath) ? 'ok' : 'missing';
  }

  if (u.searchParams.has('path')) {
    // v12.374:`?path=` 一律走唯一入口 —— 它做「HMAC 验签 + 白名单 + 存在性」三件事,
    // 任一不过关返回 null。自己解析 path 再 existsSync 正是 v12.237 修过的那个侧门:
    // recompose 的 customBgm 来自用户 body,手拼一个 `?path=/etc/passwd` 就能问出
    // 「这文件在不在」。走这里既堵住探测,判定结果也更准确 ——
    // 历史遗留的无签名 /tmp URL 验不过,而它本来就不该再被拿去合成。
    return resolveVerifiedServeFilePath(raw) ? 'ok' : 'missing';
  }

  return 'unknown';
}

/** 只拦「确认缺失」;远程与不可判定一律放行 */
export function isMediaReachable(url: string | null | undefined): boolean {
  return checkMediaReachable(url) !== 'missing';
}

/**
 * 过滤一批带媒体 URL 的条目,并回报被丢弃的数量。
 * 调用方拿到 dropped > 0 时**必须**把它透出去 —— 静默丢弃正是本模块要防的病。
 */
export function filterReachable<T>(
  items: T[],
  getUrl: (item: T) => string | null | undefined
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const it of items || []) {
    (isMediaReachable(getUrl(it)) ? kept : dropped).push(it);
  }
  return { kept, dropped };
}
