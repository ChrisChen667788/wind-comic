import { Script } from '@/types/agents';
import { SubtitleEntry } from './tts.service';

export interface SubtitleTrack {
  entries: SubtitleEntry[];
  format: 'srt' | 'vtt';
}

// Format seconds as SRT timestamp: HH:MM:SS,mmm
function toSRTTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Format seconds as VTT timestamp: HH:MM:SS.mmm
function toVTTTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Estimate reading duration for a dialogue line (chars/sec for Chinese ≈ 4)
function estimateLineDuration(text: string, shotDuration: number): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  const estimated = chineseChars / 4 + otherChars / 10;
  // Clamp to at most 80% of the shot's duration so it doesn't overflow
  return Math.min(estimated, shotDuration * 0.8);
}

export class SubtitleService {
  /**
   * Generate a timed subtitle track from a script and per-shot durations.
   * Each shot's dialogue is placed in the middle of the shot's time window.
   */
  generateSubtitles(script: Script, shotDurations: number[]): SubtitleTrack {
    const entries: SubtitleEntry[] = [];
    const shots = script.shots || [];

    let currentTime = 0;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const shotDuration = shotDurations[i] ?? 8; // default 8s per shot

      const dialogue = shot.dialogue?.trim();
      if (dialogue) {
        const lineDuration = estimateLineDuration(dialogue, shotDuration);
        // Place subtitle at 20% into the shot, leaving some breathing room
        const startOffset = shotDuration * 0.2;
        const entryStart = currentTime + startOffset;
        const entryEnd = Math.min(entryStart + lineDuration, currentTime + shotDuration - 0.2);

        const character = shot.characters?.[0];
        entries.push({
          start: Math.round(entryStart * 1000) / 1000,
          end: Math.round(entryEnd * 1000) / 1000,
          text: dialogue,
          character,
        });
      }

      currentTime += shotDuration;
    }

    return { entries, format: 'srt' };
  }

  /**
   * Convert a SubtitleTrack to SRT format string.
   */
  toSRT(track: SubtitleTrack): string {
    if (!track.entries.length) return '';

    return track.entries
      .map((entry, index) => {
        const prefix = entry.character ? `${entry.character}: ` : '';
        return [
          `${index + 1}`,
          `${toSRTTimestamp(entry.start)} --> ${toSRTTimestamp(entry.end)}`,
          `${prefix}${entry.text}`,
          '',
        ].join('\n');
      })
      .join('\n');
  }

  /**
   * Convert a SubtitleTrack to WebVTT format string.
   */
  toVTT(track: SubtitleTrack): string {
    const header = 'WEBVTT\n\n';

    if (!track.entries.length) return header;

    const body = track.entries
      .map((entry, index) => {
        const prefix = entry.character ? `<v ${entry.character}>` : '';
        const suffix = entry.character ? '</v>' : '';
        return [
          `cue-${index + 1}`,
          `${toVTTTimestamp(entry.start)} --> ${toVTTTimestamp(entry.end)}`,
          `${prefix}${entry.text}${suffix}`,
          '',
        ].join('\n');
      })
      .join('\n');

    return header + body;
  }
}

// ─────────────────────────────────────────────────────────────────────
// v2.12 Sprint B.2 — 字幕动效引擎(burn-in 用 ffmpeg drawtext filter 生成器)
// ─────────────────────────────────────────────────────────────────────
//
// 设计:
//   · SubtitleService 现在只产 sidecar SRT/VTT(给播放器用),不烧字到画面里
//   · B.2 加入"烧字"路径 — 当 LLM editing plan 把镜头 subtitleStyle 标成 fade/typewriter/pop,
//     composer 可以调本模块拿到 ffmpeg drawtext filter 字符串塞进 complexFilter
//   · 不直接修改 composer(避免破坏现有渲染链路) — 先把算法 + 单测落地, 后续 commit 接入
//
// 四档样式:
//   · static     — 固定时间窗显示, 无淡入淡出 (旧行为)
//   · fade       — 0.3s 淡入 + 0.3s 淡出 (drawtext alpha 表达式)
//   · typewriter — 慢入式 alpha 曲线模拟逐字浮现 (drawtext 单 instance 不能真 per-char,
//                  只能用慢入近似, 真 per-char 需要 N 个 drawtext 串联, 成本高且抖)
//   · pop        — 0.15s 极快 alpha snap-in + snap-out, 制造"砰"出现的高潮感

export type SubtitleStyle = 'static' | 'fade' | 'typewriter' | 'pop';

export interface DrawtextOptions {
  entry: SubtitleEntry;
  style: SubtitleStyle;
  /** TTF/OTF 路径, 缺省让 ffmpeg 用系统默认字体 */
  fontFile?: string;
  /** 字号 px, 默认 36 */
  fontSize?: number;
  /** 字色, ffmpeg 颜色名或 #rrggbb, 默认 white */
  color?: string;
  /**
   * 字幕 y 位置, 可以是数字 px 也可以是 ffmpeg 表达式 (如 'h-th-40').
   * 默认 'h-th-40' = 距底 40px
   */
  yPos?: number | string;
}

/** drawtext 文本里的 : 和 ' 必须转义, 否则 ffmpeg filter 解析报错 */
function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    // 删除 newline 把多行变单行 (drawtext 单 instance 不支持 \n 显示)
    .replace(/[\r\n]+/g, ' ');
}

/**
 * 生成单条字幕的 ffmpeg drawtext filter 字符串(带按 style 设计的 alpha/enable 表达式).
 * 返回值可以直接 push 进 complexFilter 列表 (在 [vN] → [vN+1] 链路里). 如:
 *   filters.push(`[vmain]${buildDrawtextFilter(opts)}[vmain_subbed]`);
 *
 * 失败时返回空字符串(空 entry / 0 长度 text), 调用方应 if 跳过.
 */
export function buildDrawtextFilter(opts: DrawtextOptions): string {
  const { entry, style, fontFile, fontSize = 36, color = 'white', yPos = 'h-th-40' } = opts;
  const rawText = (entry.text || '').trim();
  if (!rawText) return '';
  const text = escapeDrawtextText(rawText);
  const start = entry.start;
  const end = entry.end;
  const duration = Math.max(0.05, end - start);

  // box+padding 是所有档共享的视觉底盘
  const baseParts: string[] = [
    `text='${text}'`,
    fontFile ? `fontfile='${fontFile}'` : '',
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `x=(w-text_w)/2`,
    `y=${yPos}`,
    `box=1`,
    `boxcolor=black@0.55`,
    `boxborderw=8`,
  ].filter(Boolean);

  const enableExpr = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

  if (style === 'static') {
    return `drawtext=${baseParts.join(':')}:enable='${enableExpr}'`;
  }

  // fade 档:0.3s 淡入 + 0.3s 淡出 (alpha 分段函数)
  if (style === 'fade') {
    const FADE = Math.min(0.3, duration / 2);
    const alphaExpr =
      `if(lt(t\\,${start.toFixed(3)})\\,0\\,` +
      `if(lt(t\\,${(start + FADE).toFixed(3)})\\,(t-${start.toFixed(3)})/${FADE.toFixed(3)}\\,` +
      `if(lt(t\\,${(end - FADE).toFixed(3)})\\,1\\,` +
      `if(lt(t\\,${end.toFixed(3)})\\,(${end.toFixed(3)}-t)/${FADE.toFixed(3)}\\,0))))`;
    return `drawtext=${baseParts.join(':')}:alpha='${alphaExpr}':enable='${enableExpr}'`;
  }

  // typewriter 档:慢入式 alpha 曲线近似逐字浮现 (单 drawtext 不能真 per-char)
  if (style === 'typewriter') {
    const SLOW_IN = Math.min(duration * 0.6, duration - 0.05);
    const alphaExpr =
      `if(lt(t\\,${start.toFixed(3)})\\,0\\,` +
      `if(lt(t\\,${(start + SLOW_IN).toFixed(3)})\\,(t-${start.toFixed(3)})/${SLOW_IN.toFixed(3)}\\,1))`;
    return `drawtext=${baseParts.join(':')}:alpha='${alphaExpr}':enable='${enableExpr}'`;
  }

  // pop 档:极快 alpha snap-in + snap-out, 制造高光镜头"砰"的感觉
  if (style === 'pop') {
    const POP = Math.min(0.15, duration / 4);
    const alphaExpr =
      `if(lt(t\\,${start.toFixed(3)})\\,0\\,` +
      `if(lt(t\\,${(start + POP).toFixed(3)})\\,(t-${start.toFixed(3)})/${POP.toFixed(3)}\\,` +
      `if(lt(t\\,${(end - POP).toFixed(3)})\\,1\\,` +
      `if(lt(t\\,${end.toFixed(3)})\\,(${end.toFixed(3)}-t)/${POP.toFixed(3)}\\,0))))`;
    return `drawtext=${baseParts.join(':')}:alpha='${alphaExpr}':enable='${enableExpr}'`;
  }

  // 未知样式 → 退到 static
  return `drawtext=${baseParts.join(':')}:enable='${enableExpr}'`;
}

/** 为整条轨道批量生成 drawtext, 并按时间窗串联成视频侧的 [in] → [out] 链 */
export function buildSubtitleFilterChain(
  track: SubtitleTrack,
  style: SubtitleStyle,
  inLabel: string,
  outLabel: string,
  options?: Partial<DrawtextOptions>,
): string[] {
  const out: string[] = [];
  const entries = track.entries.filter(e => (e.text || '').trim());
  if (entries.length === 0) {
    // 没有字幕也得维持 in→out 拓扑
    out.push(`[${inLabel}]copy[${outLabel}]`);
    return out;
  }
  let prev = inLabel;
  for (let i = 0; i < entries.length; i++) {
    const next = i === entries.length - 1 ? outLabel : `${inLabel}_sub${i}`;
    const dt = buildDrawtextFilter({ ...(options || {}), entry: entries[i], style });
    out.push(`[${prev}]${dt}[${next}]`);
    prev = next;
  }
  return out;
}
