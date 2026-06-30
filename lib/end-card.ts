/**
 * 结构化片尾卡(v12.50.0)。
 *
 * 病根:广告/商业片的收尾「产品卡 / 卖点 / CTA」此前由视频模型在画面里渲染文字 ——
 * minimax/Hailuo 对 CJK 文字渲染力差 + 对 "no text" 负向**软忽略**,结果烤出一片乱码英文
 * (实测精华水广告结尾 "Comamsale El Idolata..." + broken-English tagline)。纯 prompt 无法
 * 100% 杜绝。**根治法**:CTA 文字永远走后期 ffmpeg drawtext(系统 CJK 字体,确定性、零乱码),
 * 拼一张干净片尾卡到成片末尾,模型只负责画面、不负责认字。
 *
 * 本模块只产**布局 + ffmpeg filter 串**(纯函数,可单测);真正跑 ffmpeg + 写 textfile 在
 * video-composer.appendEndCard。
 */

export interface EndCardText {
  title?: string;     // 主标语(大字,1-2 行),如「下一个发光的\n会是你吗?」
  slogan?: string;    // 副标(小字,产品线/品牌),如「熬夜肌救星 · 抗老精华水」
  durationSec?: number; // 片尾卡时长,默认 3.2s
}

/** 广告/宣传/带货等商业题材信号(用原始创意判,决定主管线是否自动加结构化片尾卡)。 */
export function isCommercialIdea(idea: string): boolean {
  return /广告片?|宣传片|宣传短片|promo|commercial|tvc|带货|种草|品牌片|新品发布|产品宣传|营销短片/i.test(idea || '');
}

/**
 * v12.57.0 商业广告 Director 硬锚点。
 * 病根:健康的 Director(sonnet-4)也会把「高级感/冷色调/琥珀/铜」等词过度风格化成「现代古装融合风」
 * —— 实测冷萃咖啡广告跑成 genre=古装职业 + 汉服宫廷。商业题材强制当代现实主义、明令禁古装/年代戏/奇幻。
 * 注入 Director userPrompt(非脚本改编时),不动 system 模板 → 零回归。
 */
export function commercialDirectorAnchor(): string {
  return `\n\n【商业广告·硬性风格要求】这是现代商业广告片,必须用**当代现实主义**:真实当代人物 + 真实现代产品 + 现代生活/职场/都市场景。genre 必须是现代题材(如「现代商业」「都市生活」),**严禁古装/古风/古代/历史剧/戏曲/汉服/宫廷/武侠/玄幻/仙侠**等任何年代戏或奇幻设定;styleKeywords **不得**出现 ancient / period / historical / hanfu / costume / imperial / dynasty 等词。产品按真实现代包装呈现,不要做成古董/铜壶/陶瓷等仿古道具。`;
}

/**
 * 主管线自动派生片尾卡文案:**宁缺毋滥** —— 只有「确为商业题材」且「末镜有一句干净 CTA 台词」
 * 才出卡;否则返回 null(不加卡,避免硬塞低质卡反伤成片)。CTA 文字取 Writer 真实台词(干净中文),
 * 由 ffmpeg drawtext 渲染(不交给视频模型 → 零乱码)。
 */
export function deriveEndCard(idea: string, lastDialogue?: string, productLine?: string): EndCardText | null {
  if (!isCommercialIdea(idea)) return null;
  const cta = (lastDialogue || '').replace(/^[…。\s]+/, '').trim();
  // CTA 句要短而完整:2–24 字、不含换行(单句标语);太长/空 → 不出卡
  if (!cta || cta.length < 2 || cta.length > 24 || /[\r\n]/.test(cta)) return null;
  const slogan = (productLine || '').trim();
  return { title: cta, slogan: slogan && slogan.length <= 20 ? slogan : undefined };
}

/**
 * v12.53.0 开场 Hook 卡文案派生(短视频前 2s 留存):**宁缺毋滥** —— 只有商业题材且有一句
 * 短 hook(显式 hookLine 优先,否则首镜台词)才出卡;太长(>16 字)/含换行/空 → 不出卡。
 */
export function deriveHookCard(idea: string, firstDialogue?: string, hookLine?: string): EndCardText | null {
  if (!isCommercialIdea(idea)) return null;
  const line = (hookLine || firstDialogue || '').replace(/^[…。\s]+/, '').trim();
  if (!line || line.length < 2 || line.length > 16 || /[\r\n]/.test(line)) return null;
  return { title: line };
}

export interface EndCardLayout {
  titleSize: number;
  sloganSize: number;
  titleY: number;     // 主标 y(像素)
  sloganY: number;    // 副标 y
  accentY: number;    // 玫瑰点缀线 y
  accentW: number;
  lineSpacing: number;
}

/** 按画布尺寸算字号/位置 —— 竖屏字相对更大、整体偏上居中;横屏稍小、垂直居中。 */
export function endCardLayout(w: number, h: number): EndCardLayout {
  const vertical = h > w;
  const titleSize = Math.round(h * (vertical ? 0.058 : 0.095));
  const sloganSize = Math.round(h * (vertical ? 0.026 : 0.042));
  // 主标放在 ~40% 高度(双行从这里起),副标在其下方,点缀线居中两者之间
  const titleY = Math.round(h * (vertical ? 0.37 : 0.34));
  const sloganY = Math.round(h * (vertical ? 0.565 : 0.62));
  const accentY = Math.round(h * (vertical ? 0.52 : 0.55));
  return {
    titleSize,
    sloganSize,
    titleY,
    sloganY,
    accentY,
    accentW: Math.round(w * 0.16),
    lineSpacing: Math.round(titleSize * 0.32),
  };
}

/** drawtext 的 fontfile/textfile 路径在 filter 串里要转义 `:`(Win 盘符)与 `\`;单引号包裹防空格。 */
export function escapeDrawtextPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export interface EndCardVfInput {
  w: number;
  h: number;
  fontFile: string;       // 系统 CJK 字体绝对路径
  titleFile?: string;     // 主标 textfile 路径(UTF-8,可含换行)
  sloganFile?: string;    // 副标 textfile 路径
  bg: 'blur' | 'solid';   // blur=用末帧模糊压暗(承接画面);solid=纯色卡
  solidColor?: string;    // bg=solid 时背景色,默认深玫瑰棕
}

/**
 * 构造片尾卡 `-vf` 滤镜串(输入 1 路视频:末帧静图 或 lavfi color)。
 * blur:`scale increase+crop` 填满 → gblur → 压暗提饱和 → drawtext;
 * 文字一律取自 textfile(绝不内联中文,杜绝转义/乱码)。
 */
export function buildEndCardVf(input: EndCardVfInput): string {
  const { w, h, fontFile } = input;
  const L = endCardLayout(w, h);
  const font = escapeDrawtextPath(fontFile);
  const parts: string[] = [];

  if (input.bg === 'blur') {
    parts.push(`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`);
    parts.push(`gblur=sigma=16`);
    parts.push(`eq=brightness=-0.22:saturation=1.05`);
  } else {
    // solid 卡:输入本就是 color 源,无需 scale;仅轻微暗角可选,这里保持纯净
  }

  // 玫瑰点缀线(在主副标之间)
  parts.push(
    `drawbox=x=(w-${L.accentW})/2:y=${L.accentY}:w=${L.accentW}:h=3:color=0xE8A0AE@0.9:t=fill`,
  );

  if (input.titleFile) {
    const tf = escapeDrawtextPath(input.titleFile);
    parts.push(
      `drawtext=fontfile='${font}':textfile='${tf}':fontcolor=white:fontsize=${L.titleSize}` +
        `:line_spacing=${L.lineSpacing}:x=(w-text_w)/2:y=${L.titleY}`,
    );
  }
  if (input.sloganFile) {
    const sf = escapeDrawtextPath(input.sloganFile);
    parts.push(
      `drawtext=fontfile='${font}':textfile='${sf}':fontcolor=0xF3D9DE:fontsize=${L.sloganSize}` +
        `:x=(w-text_w)/2:y=${L.sloganY}`,
    );
  }

  parts.push('format=yuv420p');
  return parts.join(',');
}
