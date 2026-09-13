/**
 * 列表卡片上那一行梗概(v12.436)。
 *
 * 真库里两个来源都不能原样用:
 *   · synopsis 多数是好文字,但剧本导入的项目会是结构化倒出 ——
 *     「主要角色：Lip、Shirley、经理。剧情概要：[1-1卡内基音乐厅门口,白天] Lip穿着…」,
 *     卡片上第一眼读到的是「主要角色」四个字和一个场景编号;
 *   · description 大多以「第 1 章 <标题>」开头,和卡片上方的标题逐字重复。
 * 所以剥掉这两类前缀再显示。剥完是空的就退到另一个来源,都没有就返回空串(不编)。
 */

export function cleanSynopsis(raw: string | null | undefined): string {
  // 最后再收一次空白:去掉右括号时补的空格会和原有空格叠成双空格
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // 「主要角色：…。剧情概要：」结构前缀
  t = t.replace(/^主要角色[:：][^。]*[。.]\s*/, '');
  t = t.replace(/^(剧情概要|故事梗概|梗概|简介)[:：]\s*/, '');
  // 开头的场景编号「[1-1…]」:只去掉编号标记和配对的右括号,**保留括号里的内容** ——
  // 初版整段删掉短标签,可真库里有的方括号里就是整段场景正文(「[1-1虚无中矗立一座八角铁笼,…]」),
  // 删了就只剩空串或半句话。
  if (/^\[\s*\d+\s*-\s*\d+/.test(t)) {
    t = t.replace(/^\[\s*\d+\s*-\s*\d+\s*/, '');
    const close = t.indexOf(']');
    if (close >= 0) t = `${t.slice(0, close)} ${t.slice(close + 1)}`;
  }
  return t.replace(/\s+/g, ' ').trim();
}

export function cleanDescription(raw: string | null | undefined, title: string | null | undefined): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const ti = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (ti && t.startsWith(ti)) t = t.slice(ti.length);
  // 标题本身常是「第 1 章 xxx」,描述里又重复一遍章节号
  t = t.replace(/^第\s*\d+\s*章\s*/, '');
  return t.replace(/^[,，:：\s]+/, '').trim();
}

export function loglineFrom(p: { title?: string | null; description?: string | null; scriptData?: any }): string {
  const syn = cleanSynopsis(p?.scriptData?.synopsis);
  if (syn) return syn;
  return cleanDescription(p?.description, p?.title);
}
