/**
 * lib/safe-json — 容错 JSON 解析(纯函数,零依赖)。
 *
 * v12.305。病根:列表类端点在 `rows.map()` 里裸 `JSON.parse(r.xxx)` ——
 * **任意一个项目的字段损坏,整个列表端点 500**,该用户的所有项目一起看不见。
 * 而损坏是会发生的:管道写入被中断后重启写了半截、直接改过 DB、旧版本写入格式变更……
 *
 * 取舍:**坏数据降级成 fallback,而不是让整页崩掉**。一个项目的封面数组坏了,
 * 最坏是它没有封面;不该连累另外九个项目打不开。
 * 但降级要**留痕** —— 静默吞掉就成了本轮反复在修的「静默失败」,
 * 所以 onError 会把出错的字段名与项目 id 打进日志(不打内容,避免把脏数据/隐私刷进日志)。
 */

export interface SafeJsonOptions {
  /** 出错时的上下文,用于日志定位(如 `projects.script_data#proj-abc`) */
  context?: string;
  /** 自定义告警通道;默认 console.warn */
  onError?: (message: string) => void;
}

export function safeJsonParse<T>(raw: unknown, fallback: T, opts: SafeJsonOptions = {}): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') return (raw as T) ?? fallback;
  try {
    const v = JSON.parse(raw);
    return (v === null || v === undefined) ? fallback : (v as T);
  } catch (e) {
    const where = opts.context ? ` @ ${opts.context}` : '';
    const msg = `[safe-json] 解析失败,已降级为兜底值${where}:${e instanceof Error ? e.message : e}`;
    (opts.onError ?? ((m: string) => console.warn(m)))(msg);
    return fallback;
  }
}
