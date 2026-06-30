/**
 * 词级动效字幕(ASS karaoke,v12.54.0)。
 *
 * 调研「embedded-captions」动效字幕 → 落地词级高亮:字幕随配音逐字「亮起」(karaoke 扫光),
 * 短视频/电商成片的节奏感与可读性显著上一档。
 *
 * 时间轴说明:TTS provider 返回的是**行级**时间(整句 start/end,见 vectorengine-tts),无字级时间戳;
 * 故这里把每句时长**均摊到字**(CJK 逐字、连续 ASCII 词整体)合成 `\kf` 扫光 —— 不依赖 TTS 字级数据、
 * 零外部依赖,视觉上与配音同步(精度到句级,字内为线性扫光)。纯函数产 ASS 文本,libass(ffmpeg 已用)渲染。
 */

export interface KaraokeLine {
  text: string;
  startSec: number;
  durSec: number;
}

export interface KaraokeAssOptions {
  w: number;
  h: number;
  fontName: string;
  vertical?: boolean;
  /** 已扫过(高亮)字色,ASS &HAABBGGRR。默认亮金。 */
  primaryColour?: string;
  /** 未扫到的底色。默认白。 */
  secondaryColour?: string;
}

/** 秒 → ASS 时间 H:MM:SS.cs(厘秒)。 */
export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cs2 = cs === 100 ? 99 : cs; // 防进位越界
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs2).padStart(2, '0')}`;
}

/** 把一行切成 token:CJK/标点逐字;连续 ASCII 字母数字合成一个词(英文整词高亮)。 */
export function tokenizeForKaraoke(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of (text || '').trim()) {
    if (/[A-Za-z0-9'’]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) { out.push(buf); buf = ''; }
      if (ch === ' ') { if (out.length) out[out.length - 1] += ' '; } // 空格并入前词,不单独成 token
      else out.push(ch);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 单行 → 带 `\kf` 的 ASS 文本(厘秒均摊,余数给末 token)。 */
export function buildKaraokeLineText(text: string, durSec: number): string {
  const tokens = tokenizeForKaraoke(text);
  if (tokens.length === 0) return '';
  const totalCs = Math.max(1, Math.round(durSec * 100));
  const per = Math.floor(totalCs / tokens.length);
  let used = 0;
  return tokens
    .map((t, i) => {
      const cs = i === tokens.length - 1 ? totalCs - used : per;
      used += cs;
      // 转义 ASS 花括号/反斜杠(token 里出现的话)
      const safe = t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      return `{\\kf${cs}}${safe}`;
    })
    .join('');
}

/** 生成完整 ASS 文件文本(卡拉OK扫光字幕)。 */
export function buildKaraokeAss(lines: KaraokeLine[], opts: KaraokeAssOptions): string {
  const { w, h, fontName } = opts;
  const vertical = !!opts.vertical;
  const primary = opts.primaryColour || '&H0000D7FF'; // 亮金(已扫)
  const secondary = opts.secondaryColour || '&H00FFFFFF'; // 白(未扫)
  // ASS 用真实分辨率作 PlayRes,字号/边距按高度百分比算(libass 在 PlayResY 坐标系里量字号),
  // 否则像 30 这种绝对值在 1280 高的画布上会非常小。竖屏 ~7.5%H、横屏 ~6%H,抬高避 CTA/UI。
  const fontSize = Math.round(h * (vertical ? 0.075 : 0.06));
  const marginV = Math.round(h * (vertical ? 0.1 : 0.08));
  const outline = Math.max(2, Math.round(fontSize * 0.06));

  // V4+ Style:PrimaryColour=扫过色,SecondaryColour=未扫色(karaoke 由二者间扫光),Bold=1,底部居中
  const styleLine = `Style: Default,${fontName},${fontSize},${primary},${secondary},&H00101010,&H64000000,1,0,0,0,100,100,0,0,1,${outline},1,2,40,40,${marginV},1`;

  const events = lines
    .filter((l) => (l.text || '').trim())
    .map((l) => {
      const start = assTime(l.startSec);
      const end = assTime(l.startSec + Math.max(0.2, l.durSec));
      const body = buildKaraokeLineText(l.text, l.durSec);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${body}`;
    });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
