/**
 * 把题材技能的 BGM 风格词拼进配乐提示词 —— 唯一出口(v12.437)。
 *
 * ## 修前:写进去,没人读
 *
 * v12.193 起,题材镜头包命中后执行 `(orchestrator as any).bgmStyleHint = pack.bgmStyleHint`,
 * 注释写着「BGM prompt 侧读取(软注入)」。但**全仓没有任何代码读这个字段** ——
 * 编辑 agent 的上下文类型里连这个字段都没有。于是每个悬疑/甜宠/古装项目都弹
 * 「题材镜头包已注入」,**BGM 风格那一半从来没生效过**,持续了 9 个大版本。
 *
 * ## 为什么要收成一个函数
 *
 * 配乐提示词在编辑 agent 里有**两条**构造路径:单段 `musicPrompt`,和多幕的三次
 * `moodPromptForAct(...)` —— 后者完全不经过前者。只接一条就是「改了主路径忘旁路」,
 * 长片(≥30 秒、走多幕)会继续悄悄丢掉风格词。四个调用点都过这里,测试逐个锁住。
 */
export function withBgmStyleHint(prompt: string, hint: string | null | undefined): string {
  const h = String(hint ?? '').trim();
  if (!h) return prompt;
  // 已经拼过就别重复(重试/续跑时同一个 prompt 可能被再次加工)
  if (prompt.includes(h)) return prompt;
  return `${prompt}. Genre style: ${h}`;
}
