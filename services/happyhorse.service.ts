/**
 * HappyHorse(阿里 通义/百炼)视频引擎 —— v12.272。
 *
 * 为什么接:2026-08-07 竞品核验中,HappyHorse 1.1 稳居 Artificial Analysis 双榜前五
 * (T2V 带音频 Elo 1148 / I2V 1111),且**单次 Transformer 联合生成视频+音频**、7 语种原生唇形同步。
 * 本项目的 BYO 主张就是「竞品越强,本管线越强」—— 榜上模型开放 API 即应可被调度。
 *
 * ⚠️ 接口契约是**实测**出来的,不是照文档猜的:
 *   1. 该模型**禁止**走网关通用视频口 —— `/v1/video/create` 与 `/v1/videos` 均返回 400 并明确指路:
 *      「模型 happyhorse-1.1-t2v 属于 阿里百炼(happyhorse/wan) 专属接口,禁止通过通用视频接口调用」。
 *   2. 专属端点为百炼原生异步格式:
 *        POST {base}/alibailian/api/v1/services/aigc/video-generation/video-synthesis
 *        body: { model, input: { prompt, img_url? }, parameters? }
 *        → 200 { request_id, output: { task_id, task_status: 'PENDING' } }
 *      **不需要** X-DashScope-Async 头(实测不带也返回 task_id)。
 *   3. 轮询:GET {base}/alibailian/api/v1/tasks/{task_id}
 *        → { output: { task_status: PENDING|RUNNING|SUCCEEDED|FAILED, video_url? , results? } }
 *
 * 诚实边界:未配 key 或 base 非该网关时 `hasHappyHorse()` 为 false,引擎链自动跳过 —— 不静默假装可用。
 */

export type HappyHorseAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export interface HappyHorseGenerateOptions {
  /** 首帧图(有则走 i2v 模型,无则 t2v) */
  imageUrl?: string;
  aspectRatio?: HappyHorseAspect;
  /** 3~15s(1.1 规格);越界自动夹取 */
  duration?: number;
  onProgress?: (progress: number, status: string) => void;
  /** 轮询上限秒数(默认 600) */
  timeoutSec?: number;
  /** v12.294:上游自报的实际画幅(`usage.ratio`/`usage.SR`)—— 与请求不符时调用方可据此重生成或 reframe */
  onAspectReport?: (r: { requested?: string; actual?: string; sr?: number; matched: boolean }) => void;
}

export interface HappyHorseTaskResult {
  videoUrl: string;
  taskId: string;
}

const BAILIAN_CREATE = '/alibailian/api/v1/services/aigc/video-generation/video-synthesis';
const BAILIAN_TASK = '/alibailian/api/v1/tasks';

/** 3~15s 是 HappyHorse 1.1 的公开规格,越界夹取(不把非法值甩给上游)。 */
export function clampHappyHorseDuration(sec: number | undefined): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.max(3, Math.min(15, Math.round(n)));
}

/** 有首帧走 i2v,否则 t2v —— 模型名可用 HAPPYHORSE_MODEL 覆盖(如切 1.0 或 r2v)。 */
export function happyHorseModelFor(hasImage: boolean, env: Record<string, string | undefined> = process.env): string {
  const explicit = (env.HAPPYHORSE_MODEL || '').trim();
  if (explicit) return explicit;
  return hasImage ? 'happyhorse-1.1-i2v' : 'happyhorse-1.1-t2v';
}

/** 仅在配了 key 时可用;base 缺省复用 VectorEngine(实测承载该专属端点的网关)。 */
export function hasHappyHorse(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.HAPPYHORSE_API_KEY || env.VECTORENGINE_API_KEY || '';
  return !!key && !key.startsWith('your_') && env.HAPPYHORSE_DISABLE !== '1';
}

/** 从百炼 output 里挖视频地址 —— 网关/版本间字段名不统一,逐个兜。 */
export function extractHappyHorseVideoUrl(output: any): string {
  if (!output || typeof output !== 'object') return '';
  const direct = output.video_url || output.videoUrl || output.url;
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const results = output.results || output.video_results;
  if (Array.isArray(results)) {
    for (const r of results) {
      const u = r?.video_url || r?.url || r?.videoUrl;
      if (typeof u === 'string' && u.startsWith('http')) return u;
    }
  }
  return '';
}

/**
 * v12.294:上游 `usage` 块**自报实际采用的画幅** —— 这是 2026-08-09 探测时才发现的字段:
 *   `{"usage": {"SR": 1080, "ratio": "16:9", "duration": 3, ...}, "output": {...}}`
 * 有了它,核对「要的画幅 vs 真出的画幅」不必再下载视频量分辨率,一次 3 秒任务即可判定。
 */
export function reportedHappyHorseAspect(payload: any): { ratio?: string; sr?: number } {
  const u = payload?.usage;
  if (!u || typeof u !== 'object') return {};
  const ratio = typeof u.ratio === 'string' ? u.ratio : undefined;
  const sr = Number.isFinite(Number(u.SR)) ? Number(u.SR) : undefined;
  return { ratio, sr };
}

/** 官方文档(happyhorse-text-to-video-api-reference)列的宽高比取值 */
export const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'] as const;
/** 官方文档列的分辨率档位 */
export const HAPPYHORSE_RESOLUTIONS = ['480P', '720P', '1080P'] as const;

/**
 * v12.295:按**官方文档**拼画幅相关参数。
 *
 * 病根终于查到底了 —— 上游**根本没有 `size` 这个参数**。官方 API 参考里 parameters 只有:
 *   `resolution`(480P/720P/1080P,默认 1080P)、`ratio`(16:9 默认 / 9:16 / 1:1 / 4:3 / 3:4 / 4:5 / 5:4 / 9:21 / 21:9)、
 *   `duration`、`watermark`、`seed`。
 * v12.272 起我们一直在传 `size`,而上游对不认识的字段**不报错、静默忽略**,于是永远出默认 16:9。
 * 这也和实测响应里的 `usage: {"SR": 1080, "ratio": "16:9"}` 对上了 —— 那两个字段正是 resolution 与 ratio 的回显。
 *
 * 同时修掉一个此前没人注意到的问题:**`watermark` 默认 true**,右下角固定打「Happy Horse」水印
 *(实测那条探测视频的文件名就是 `..._refiner_watermark.mp4`)。出片素材默认关掉;
 * 需要保留时设 `HAPPYHORSE_WATERMARK=1`。
 */
export function happyHorseVisualParams(
  aspect: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, any> {
  const out: Record<string, any> = {};
  if (aspect && (HAPPYHORSE_RATIOS as readonly string[]).includes(aspect)) out.ratio = aspect;

  const res = (env.HAPPYHORSE_RESOLUTION || '').trim().toUpperCase();
  if ((HAPPYHORSE_RESOLUTIONS as readonly string[]).includes(res)) out.resolution = res;

  // 默认去水印;显式设 1/true 才保留
  out.watermark = /^(1|true)$/i.test((env.HAPPYHORSE_WATERMARK || '').trim());

  const seed = Number((env.HAPPYHORSE_SEED || '').trim());
  if (Number.isInteger(seed) && seed >= 0 && seed <= 2147483647) out.seed = seed;

  if ((env.HAPPYHORSE_SIZE || '').trim()) {
    console.warn('[HappyHorse] HAPPYHORSE_SIZE 已废弃并忽略:上游没有 size 参数(v12.295 查证官方文档),请改用 HAPPYHORSE_RESOLUTION + 项目画幅');
  }
  return out;
}

/**
 * 请求的画幅**是否已被确证可用**。
 *
 * 病根(2026-08-09 实测):上游**不校验** `size` —— 传 `'ZZZ_INVALID_PROBE'` 照样 HTTP 200 建任务,
 * 然后静默回落默认画幅。所以「请求 9:16 出 16:9」不是网关吞了参数,而是**参数格式不对且上游不报错**。
 * 正确写法至今未能确证:探测期间上游通道持续 429(`local:quota_not_enough`,
 * 文案却写「分组上游负载已饱和」—— 两者不是一回事)。
 *
 * 在确证之前,只承认**已实测出过**的 16:9;其余一律视为不支持,由引擎链跳过 ——
 * v12.272 把这条限制只写在 README 里(documented 但不 enforced),于是竖屏项目照样会被路由过来、
 * 静默拿到横屏素材。运营者若知道自己网关要的确切字符串,设 `HAPPYHORSE_SIZE` 即表示自行担保。
 */
export function happyHorseAspectSupported(aspect: string | undefined): boolean {
  if (!aspect) return true;                                        // 没指定 → 用上游默认
  if (!(HAPPYHORSE_RATIOS as readonly string[]).includes(aspect)) return false;  // 文档没列的比例
  return !_brokenRatios.has(aspect);                               // 实测打过脸的,本进程内不再用
}

/**
 * 运行期自停用:上游 `usage.ratio` 与请求不符时,把该比例记进黑名单 ——
 * 后续镜头不再路由到 HappyHorse,而不是一镜一镜地重复白烧。
 * 只在**本进程**内生效(重启即重试),因为这可能只是上游一次性抽风。
 */
const _brokenRatios = new Set<string>();
export function markHappyHorseRatioBroken(aspect: string): void {
  if (aspect) _brokenRatios.add(aspect);
}
/** 仅供测试:清空运行期黑名单 */
export function _resetHappyHorseRatioState(): void {
  _brokenRatios.clear();
}

export class HappyHorseService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.HAPPYHORSE_API_KEY || process.env.VECTORENGINE_API_KEY || '';
    this.baseURL = (process.env.HAPPYHORSE_BASE_URL || process.env.VECTORENGINE_BASE_URL || 'https://api.vectorengine.ai')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');
  }

  isAvailable(): boolean {
    return hasHappyHorse();
  }

  /** 建任务 → 轮询 → 返回视频 URL(全生命周期)。 */
  async generateVideo(prompt: string, options?: HappyHorseGenerateOptions): Promise<string> {
    const { taskId } = await this.submitTask(prompt, options);
    return await this.pollResult(taskId, options);
  }

  async submitTask(prompt: string, options?: HappyHorseGenerateOptions): Promise<{ taskId: string }> {
    if (!this.apiKey) throw new Error('HappyHorse 未配置(需 HAPPYHORSE_API_KEY 或 VECTORENGINE_API_KEY)');
    const hasImage = !!(options?.imageUrl && options.imageUrl.startsWith('http'));
    const input: Record<string, any> = { prompt };
    if (hasImage) input.img_url = options!.imageUrl;

    const parameters: Record<string, any> = {
      duration: clampHappyHorseDuration(options?.duration),
      ...happyHorseVisualParams(options?.aspectRatio),
    };
    const res = await fetch(`${this.baseURL}${BAILIAN_CREATE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: happyHorseModelFor(hasImage), input, parameters }),
    });
    const text = await res.text();
    if (!res.ok) {
      // v12.294:429 的**代码与文案说的不是一回事** —— 实测拿到
      //   {"code":"local:quota_not_enough","message":"当前分组上游负载已饱和,请稍后再试"}
      // 文案暗示「等等就好」,代码却是额度不足。把两者分开报,免得运营者一直干等一个不会好的东西。
      if (res.status === 429 && /quota_not_enough/i.test(text)) {
        throw new Error(
          `HappyHorse 上游通道额度不足 (429 quota_not_enough):网关文案写「负载已饱和」但代码是额度问题,` +
          `等待通常无效 —— 需网关侧补额度或换通道。原文:${text.slice(0, 160)}`,
        );
      }
      throw new Error(`HappyHorse 建任务失败 (${res.status}): ${text.slice(0, 200)}`);
    }
    let j: any = {};
    try { j = JSON.parse(text); } catch { throw new Error(`HappyHorse 返回非 JSON: ${text.slice(0, 120)}`); }
    const taskId = j?.output?.task_id;
    if (!taskId) throw new Error(`HappyHorse 未返回 task_id: ${text.slice(0, 200)}`);
    console.log(`[HappyHorse] task created: ${taskId} (${happyHorseModelFor(hasImage)})`);
    return { taskId };
  }

  async pollResult(taskId: string, options?: HappyHorseGenerateOptions): Promise<string> {
    const timeoutSec = options?.timeoutSec ?? 600;
    const intervalMs = 5000;
    const maxTries = Math.ceil((timeoutSec * 1000) / intervalMs);
    for (let i = 0; i < maxTries; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const res = await fetch(`${this.baseURL}${BAILIAN_TASK}/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) continue; // 瞬时错误不打断轮询
      const j: any = await res.json().catch(() => ({}));
      const status = j?.output?.task_status;
      if (status === 'SUCCEEDED') {
        const url = extractHappyHorseVideoUrl(j.output);
        if (!url) throw new Error(`HappyHorse 成功但无视频地址: ${JSON.stringify(j.output).slice(0, 200)}`);
        // v12.294:核对上游自报的实际画幅 —— 此前**从不核对**,于是竖屏项目静默拿到横屏素材。
        // 只报不拦:素材已经生成、拦下等于白烧一次;由调用方决定是重生成还是走 reframe。
        const { ratio, sr } = reportedHappyHorseAspect(j);
        const want = options?.aspectRatio;
        if (want && ratio && ratio !== want) {
          // v12.295:不只是告警 —— 把这个比例记进运行期黑名单,后续镜头直接跳过 HappyHorse,
          // 免得一镜一镜重复白烧。重启即重试(可能只是上游一次性抽风)。
          markHappyHorseRatioBroken(want);
          console.warn(
            `[HappyHorse] ⚠️ 画幅不符:请求 ${want},上游实际出 ${ratio}(SR ${sr ?? '?'})。` +
            `已在本进程内停用该比例,后续镜头改走其他引擎。task=${taskId}`,
          );
        }
        options?.onAspectReport?.({ requested: want, actual: ratio, sr, matched: !want || !ratio || ratio === want });
        return url;
      }
      if (status === 'FAILED') {
        throw new Error(`HappyHorse 任务失败: ${j?.output?.message || JSON.stringify(j.output).slice(0, 160)}`);
      }
      options?.onProgress?.(Math.min(90, Math.round((i / maxTries) * 100)), status || 'RUNNING');
    }
    throw new Error(`HappyHorse 轮询超时(${timeoutSec}s),task=${taskId}`);
  }
}

let _svc: HappyHorseService | null = null;
export function getHappyHorseService(): HappyHorseService | null {
  if (!hasHappyHorse()) return null;
  if (!_svc) _svc = new HappyHorseService();
  return _svc;
}
