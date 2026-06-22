/**
 * 阶段二十七 P3 — 宣传片/预告片模板「大脑」(纯函数,可单测)。
 *
 * 把「一句话品牌/产品简介」按**促销叙事弧**(钩子 → 痛点 → 卖点×N → 实证 → CTA)拆成分镜骨架,
 * 喂给**现有管线**(storyTemplate.structureHint 引导 Writer → storyboard → 视频 → TTS → BGM → composer)。
 * 不新增任何重渲染依赖;视觉由现有引擎链生成,剪辑走「快节奏燃向」促销节奏。
 *
 * 设计:骨架是**确定性规则**(可单测),AI 只填具体画面/文案 prose。
 */

import type { StoryTemplate } from './story-templates';

/** 单个促销节拍的功能角色。 */
export type PromoBeatRole = 'hook' | 'problem' | 'value' | 'proof' | 'cta';

export interface PromoArc {
  id: string;
  name: string;
  /** 节拍角色序列(value 可按目标镜数伸缩)。 */
  sequence: PromoBeatRole[];
}

/** 三套促销弧:产品发布(全)、品牌预告(短促)、功能罗列(卖点密集)。 */
export const PROMO_ARCS: PromoArc[] = [
  { id: 'product-launch', name: '产品发布', sequence: ['hook', 'problem', 'value', 'value', 'value', 'proof', 'cta'] },
  { id: 'brand-teaser', name: '品牌预告', sequence: ['hook', 'value', 'value', 'cta'] },
  { id: 'feature-showcase', name: '功能罗列', sequence: ['hook', 'value', 'value', 'value', 'value', 'cta'] },
];

export function getPromoArc(id: string): PromoArc | undefined {
  return PROMO_ARCS.find((a) => a.id === id);
}

/** 各角色的导演意图 + 默认中文 VO 模板(brief 注入)。 */
const ROLE_INTENT: Record<PromoBeatRole, { intent: string; line: (brief: string) => string }> = {
  hook:    { intent: '前3秒钩子:一个最抓眼的冲突/反差画面,瞬间立住主题', line: () => '如果只用一句话,就能……' },
  problem: { intent: '点出目标用户的痛点,制造共鸣与张力', line: () => '过去,这件事又慢又难。' },
  value:   { intent: '一镜一个核心卖点:用具体画面把卖点演出来,而不是念参数', line: (b) => `${b.slice(0, 18)} —— 这一点,做到了。` },
  proof:   { intent: '实证/数据/真实成片闪回,建立可信度', line: () => '不是概念,是真的能交付。' },
  cta:     { intent: '收尾行动号召:品牌名 + 一句邀请 + 行动指令', line: () => '现在就开始,做你的第一支。' },
};

export interface PromoShotPlan {
  shotNumber: number;
  role: PromoBeatRole;
  /** 给 Writer/storyboard 的导演意图 */
  intent: string;
  /** 默认 VO/字幕草稿(AI 可改写) */
  suggestedLine: string;
}

export interface PromoPlan {
  arcId: string;
  aspect: string;
  perShotSec: number;
  totalSec: number;
  editStyle: string;
  shots: PromoShotPlan[];
}

/** 促销片默认走「快节奏燃向」剪辑(对接 lib/edit-style.ts 的规则档)。 */
export const PROMO_EDIT_STYLE = '快节奏燃向';

/**
 * 把促销弧伸缩到目标镜数:固定保留 hook(首)+ cta(尾),中间 value 段按需增减,
 * problem/proof 仅在镜数充裕时保留。纯函数、确定性。
 */
export function scalePromoSequence(arc: PromoArc, shotCount: number): PromoBeatRole[] {
  const n = Math.max(3, Math.min(12, Math.round(shotCount)));
  const mids = arc.sequence.slice(1, -1); // 去掉首 hook、尾 cta
  const needMid = n - 2;
  let chosen: PromoBeatRole[];
  if (needMid <= mids.length) {
    // 镜数不足:优先保 value,丢 problem/proof
    const values = mids.filter((r) => r === 'value');
    const nonValues = mids.filter((r) => r !== 'value');
    chosen = [...nonValues, ...values].slice(0, needMid);
    // 还原大致顺序(problem 在前、value 居中、proof 在后)
    chosen = [
      ...chosen.filter((r) => r === 'problem'),
      ...chosen.filter((r) => r === 'value'),
      ...chosen.filter((r) => r === 'proof'),
    ];
  } else {
    // 镜数富裕:补足额外的 value 卖点镜
    chosen = [...mids, ...Array.from({ length: needMid - mids.length }, () => 'value' as PromoBeatRole)];
  }
  return ['hook', ...chosen, 'cta'];
}

export interface BuildPromoOptions {
  shotCount?: number;       // 目标镜数(默认按弧长)
  aspect?: string;          // 画幅,默认 16:9(主页/落地页)
  perShotSec?: number;      // 单镜秒数,默认 5(促销宜短促)
}

/** 一句话简介 + 弧 → 结构化分镜骨架(确定性、可单测)。 */
export function buildPromoPlan(brief: string, arcId = 'product-launch', opts: BuildPromoOptions = {}): PromoPlan {
  const arc = getPromoArc(arcId) || PROMO_ARCS[0];
  const aspect = opts.aspect || '16:9';
  const perShotSec = opts.perShotSec ?? 5;
  const shotCount = opts.shotCount ?? arc.sequence.length;
  const roles = scalePromoSequence(arc, shotCount);
  const b = (brief || '').trim();
  const shots: PromoShotPlan[] = roles.map((role, i) => ({
    shotNumber: i + 1,
    role,
    intent: ROLE_INTENT[role].intent,
    suggestedLine: ROLE_INTENT[role].line(b),
  }));
  return { arcId: arc.id, aspect, perShotSec, totalSec: shots.length * perShotSec, editStyle: PROMO_EDIT_STYLE, shots };
}

/** 生成喂给 Writer 的 structureHint(促销纪律:钩子/一镜一卖点/CTA)。> 50 字。 */
export function buildPromoStructureHint(arcId = 'product-launch'): string {
  const arc = getPromoArc(arcId) || PROMO_ARCS[0];
  return (
    `这是一支**${arc.name}型宣传片/预告片**,不是叙事剧:节奏要快、信息密度高、每一镜都为「让观众记住并行动」服务。` +
    `结构:① 前 3 秒钩子镜——用最抓眼的冲突/反差画面瞬间立住主题(切忌平铺直叙);` +
    `② 中段「一镜一个核心卖点」——把卖点用具体画面演出来,而非罗列参数,必要时先点痛点再给解法;` +
    `③ 可选实证镜——数据/真实成片闪回建立可信度;` +
    `④ 结尾 CTA——品牌名 + 一句邀请 + 明确行动指令(如「现在就开始」)。` +
    `全片硬切为主、卡点剪辑、留白少;每镜时长短(3–6s),首尾各一个记忆点。`
  );
}

/** 两套可选的促销 StoryTemplate(供 create 页模板选择器,复用现有管线生成)。 */
export const PROMO_TEMPLATES: StoryTemplate[] = [
  {
    id: 'product-promo',
    name: '产品宣传片',
    nameEn: 'Product Promo',
    icon: '🎬',
    category: '商业宣传',
    description: '一句话产品简介 → 钩子·卖点·CTA 的促销短片',
    exampleIdea: '一款一句话就能生成整部短剧的 AI 制作台:从剧本、分镜、配音到成片一条龙,让任何人都能做出院线质感的短片',
    structureHint: buildPromoStructureHint('product-launch'),
    emotionCurve: '钩子抓眼→痛点共鸣→卖点爆发→实证可信→CTA 行动',
    keyElements: ['前3秒钩子', '一镜一卖点', '痛点共鸣', '实证闪回', '结尾 CTA'],
    styleRecommendation: 'Cinematic',
    shotCount: { min: 5, max: 8 },
    colorPalette: 'premium dark, gold accent, high-contrast product hero lighting',
    tags: ['宣传片', '营销', '产品', '预告片'],
    recommendedDuration: 5,
    recommendedAspect: '16:9',
    recommendedCamera: 'push-in',
  },
  {
    id: 'brand-teaser',
    name: '品牌预告',
    nameEn: 'Brand Teaser',
    icon: '✨',
    category: '商业宣传',
    description: '短促有力的品牌悬念预告(竖屏社媒向)',
    exampleIdea: '一个神秘新品牌即将登场:用极简留白与一句悬念文案吊足胃口,最后一帧亮出 logo 与上线日期,引爆社媒期待',
    structureHint: buildPromoStructureHint('brand-teaser'),
    emotionCurve: '悬念钩子→价值暗示→情绪拉满→logo 揭晓',
    keyElements: ['悬念开场', '极简留白', '情绪张力', 'logo 揭晓', '上线钩子'],
    styleRecommendation: 'Cinematic',
    shotCount: { min: 4, max: 6 },
    colorPalette: 'moody teal-orange, neon accent, dramatic negative space',
    tags: ['预告片', '品牌', '悬念', '社媒'],
    recommendedDuration: 5,
    recommendedAspect: '9:16',
    recommendedCamera: 'crash-zoom',
  },
];
