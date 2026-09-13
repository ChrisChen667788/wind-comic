/**
 * 素材库卡片上那行标题(v12.436)。
 *
 * 修前直接显示 `asset.name`,而 1095 个资产里 **488 个是机器名**:
 * `镜头 1` / `视频 10` / `Shot 1 (re-gen)`。一屏十几张卡全叫「镜头 N」,
 * 用户得一张张点开才知道哪张是哪个画面 —— 标题没有承担标题的职能。
 *
 * 实测数据决定了取法:
 *   · 分镜 309 个机器名,**全部**有 description(就是分镜提示词)→ 取它的第一小句;
 *   · 视频 179 个机器名,**一个都没有** description → 借同项目、同镜号那张分镜的描述。
 *     视频和分镜按 (projectId, shotNumber) 一一对应,这是流水线的结构事实,不是猜。
 * 两边都拿不到时**老实显示原名**,不编。
 *
 * 机器名不丢:卡片上仍以副标签形式保留「镜头 N」,镜号是用户找片时真正要的索引。
 */

const MACHINE_NAME = /^(shot\s*\d+(\s*\(re-gen\))?|镜头\s*\d+|视频\s*\d+|分镜\s*\d+|场景\s*\d+)$/i;

export interface AssetLike {
  type?: string | null;
  name?: string | null;
  projectId?: string | null;
  shotNumber?: number | null;
  data?: unknown;
}

export function isMachineName(name: string | null | undefined): boolean {
  return MACHINE_NAME.test(String(name ?? '').trim());
}

function descOf(data: unknown): string {
  let o: any = data;
  if (typeof data === 'string') {
    try { o = JSON.parse(data); } catch { return ''; }
  }
  return String(o?.description || o?.prompt || '').trim();
}

/**
 * 镜头规格前缀里才会出现的词。只用于判断「冒号前面那一段是不是镜头语言」,
 * 不用来删正文里的词 —— 画面内容里也可能出现「特写」二字。
 */
const CAMERA_SPEC = /\b\d+\s*mm\b|\blens\b|\b(dolly|truck|pan|tilt|orbit|handheld|static|crane|push-in|pull-out|drone|zoom|arc)\b/i;
const CAMERA_CLAUSE_ZH = /^(大?[远中近全]景|特写|大特写|俯[视拍]|仰[视拍]|平视|定焦|手持|航拍)|[推拉摇移跟升降]镜|运镜|镜头(平稳|缓慢|轻微|快速)/;

/**
 * 从分镜描述里剥出**画面内容**(v12.436 真机截图后补)。
 *
 * 初版直接取第一小句,截图里首屏 5 张卡的标题是「Dolly-in on 85mm lens」
 * 「Static on 50mm lens」—— 那是运镜指令,不是画面里有什么,只比「镜头 N」好一点点。
 * 实测 294 条分镜描述里 59 条(20%)是这样。
 *
 * 流水线出的描述有两种固定格式,按格式解析而不是猜:
 *   · 英文镜头规格:`<运镜> on <焦距> lens, <景别>, <角度>: <画面内容>` —— 内容在冒号之后;
 *   · 中文剧本式:`<地点>,<时间>。<动作>` —— 首句即地点,原样可用;
 *     少数中文以景别/运镜开头(「大远景缓慢推镜入中景。李长安靠在门框…」)→ 跳过这一句。
 */
export function contentOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const colon = t.search(/[:：]/);
  if (colon > 0 && CAMERA_SPEC.test(t.slice(0, colon))) {
    const rest = t.slice(colon + 1).trim();
    if (rest) return rest;
  }
  const firstStop = t.search(/[。;；]/);
  if (firstStop > 0 && CAMERA_CLAUSE_ZH.test(t.slice(0, firstStop))) {
    const rest = t.slice(firstStop + 1).trim();
    if (rest) return rest;
  }
  return t;
}

/** 取描述的第一小句,别把一整段分镜提示词塞进标题。 */
export function firstClause(text: string, max = 22): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const cut = t.search(/[。,，;；!！?？\n]/);
  const head = cut > 0 ? t.slice(0, cut) : t;
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

/** 按 (projectId, shotNumber) 建分镜描述索引,供视频借用。 */
export function buildStoryboardIndex(assets: AssetLike[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const a of assets) {
    if (a.type !== 'storyboard' || !a.projectId || a.shotNumber == null) continue;
    const d = descOf(a.data);
    if (d) idx.set(`${a.projectId}#${a.shotNumber}`, d);
  }
  return idx;
}

export function assetDisplayTitle(a: AssetLike, storyboardIdx?: Map<string, string>): string {
  const name = String(a.name ?? '').trim();
  if (!isMachineName(name)) return name;

  const own = descOf(a.data);
  if (own) return firstClause(contentOf(own));

  if (storyboardIdx && a.projectId && a.shotNumber != null) {
    const borrowed = storyboardIdx.get(`${a.projectId}#${a.shotNumber}`);
    if (borrowed) return firstClause(contentOf(borrowed));
  }
  return name; // 两边都没有 → 老实显示原名
}
