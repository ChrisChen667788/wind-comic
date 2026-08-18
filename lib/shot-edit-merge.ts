/**
 * lib/shot-edit-merge — 自然语言改单镜:把用户的一句话**合并**进原镜描述(v12.337)。
 *
 * ## 为什么必须是「合并」而不是「替换」
 *
 * 竞品对标清单的最后一项是 Seko 的「自然语言改单镜」。本仓 v12.248 已能把
 * 「第 3 镜改成夜景」解析成 `{ op:'regenShot', shotNumber:3, note:'改成夜景' }`,
 * v12.251 也把**组合级**编辑接到了 `recompose`。唯独单镜这一支**解析了却不执行** ——
 * 界面只显示「第 3 镜需重生画面」,让用户自己跑去项目页手动重来。
 *
 * 接线时踩到的真陷阱:`regenerate-shot` 端点里是
 *   `prompt: [description || '', cameraPrompt].join('. ')`
 * 也就是说 `description` **就是整条视频提示词**。若把 note(「改成夜景」)直接当
 * description 传进去,原镜的人物、场景、动作、光线**会被整个抹掉**,生成出一个
 * 毫不相干的镜头 —— 而且它会「成功」返回,没有任何报错。这正是本模块存在的理由:
 * **原描述非空时,绝不允许只拿 note 出门。**
 *
 * ## 只做确定性的部分,冲突交给人
 *
 * 视频模型吃的是场景描述,不是编辑指令。规则层能做的是:把 note 作为**后置覆盖句**
 * 接在原描述之后(同一属性后出现的表述通常压过先出现的),并把**可能冲突的属性**
 * (时间/天气/景别/色调)如实报给调用方 —— 由用户决定,而不是这里悄悄替他选。
 * 与 `lib/edit-intent` 同一套哲学:规则层确定可测,LLM 增强作为后续叠加。
 */

export type MergeMode = 'merged' | 'noteOnly' | 'originalOnly' | 'empty';

/** note 里出现这些词,说明它想**改写**原描述里的同名属性,而非追加细节。 */
const CONFLICT_RULES: Array<{ kind: string; note: RegExp; original: RegExp }> = [
  { kind: '时间',
    note: /夜|晚上|黄昏|清晨|白天|正午|傍晚|night|dusk|dawn|noon/i,
    original: /夜|晚上|黄昏|清晨|白天|正午|傍晚|晚霞|日出|日落|night|dusk|dawn|noon/i },
  { kind: '天气',
    note: /雨|雪|雾|晴|阴天|rain|snow|fog|sunny/i,
    original: /雨|雪|雾|晴|阴天|rain|snow|fog|sunny/i },
  { kind: '景别',
    note: /特写|近景|中景|全景|远景|大远景|close.?up|wide|medium shot/i,
    original: /特写|近景|中景|全景|远景|大远景|close.?up|wide|medium shot/i },
  { kind: '色调',
    note: /暖|冷|橘|蓝调|黑白|冷色|暖色|warm|cool|monochrome/i,
    original: /暖|冷|橘|蓝调|黑白|冷色|暖色|色温|warm|cool|monochrome/i },
];

export interface ShotEditMerge {
  /** 最终送给视频引擎的提示词。 */
  prompt: string;
  mode: MergeMode;
  /** 双方都提到、note 很可能是在覆盖的属性 —— 只报不判,交给用户确认。 */
  conflicts: string[];
}

/**
 * 把一句自然语言修改指令合并进原镜描述。
 *
 * @param original 原镜描述(storyboard 资产的 data.description)
 * @param note     用户那句话(如「改成夜景」「让她转过身来」)
 */
export function mergeShotEdit(original: string | null | undefined, note: string | null | undefined): ShotEditMerge {
  const o = (original || '').trim();
  const n = (note || '').trim();

  if (!o && !n) return { prompt: '', mode: 'empty', conflicts: [] };
  // 原描述丢失(老项目/资产被清)时才允许只用 note —— 调用方应据此提示「这镜将按你这句话重画」
  if (!o) return { prompt: n, mode: 'noteOnly', conflicts: [] };
  if (!n) return { prompt: o, mode: 'originalOnly', conflicts: [] };

  const conflicts = CONFLICT_RULES
    .filter((r) => r.note.test(n) && r.original.test(o))
    .map((r) => r.kind);

  // 覆盖句放最后:同一属性后出现的表述通常压过先出现的。
  // 用「在此基础上」把两段的关系说清楚,免得模型把 note 读成画面里的字。
  const prompt = `${o.replace(/[。.\s]+$/, '')}。在此基础上修改:${n.replace(/[。.\s]+$/, '')}。`;
  return { prompt, mode: 'merged', conflicts };
}

/** 给界面用的一句话说明 —— 不确定的地方要说出来,不能装作没有。 */
export function describeMerge(m: ShotEditMerge): string {
  if (m.mode === 'empty') return '没有可用的描述,无法重生这一镜。';
  if (m.mode === 'originalOnly') return '未给出修改说明,将按原描述重生。';
  if (m.mode === 'noteOnly') return '⚠️ 找不到这一镜的原描述,将**仅按你这句话**重画(画面可能与原镜差别很大)。';
  return m.conflicts.length
    ? `将在原描述基础上修改;注意你改动了${m.conflicts.join('、')},与原描述冲突,以你的说法为准。`
    : '将在原描述基础上修改,其余保持不变。';
}
