/**
 * 案例库 →「复制提示词 / 用这个创作」送出去的那句话(v12.436)。
 *
 * ## 修前是个空壳
 *
 * 两个按钮都取 `c.prompt || c.description || c.title`。但 `cases` 表**根本没有**
 * prompt / description 列,接口也不返回 —— 所以永远落到标题:
 *   · 「复制提示词」复制到的是「月华藏境」四个字;
 *   · 「用这个创作」把这四个字带进创作页,而开机门槛是 10 个字,**按钮是灰的**。
 * 副标题还写着「点击一键复用创意」。看起来能用,实际是条断头路。
 *
 * ## 为什么不编一段提示词
 *
 * 表里没有的东西就是没有。这里不替案例虚构剧情,只用**真有的字段**(标题 + 题材)
 * 拼一句能直接开机的种子创意;将来 cases 表补上 prompt 列,自动优先用它。
 */
import { IDEA_MIN_CHARS } from './idea-gate';

export interface CaseLike {
  title?: string | null;
  category?: string | null;
  prompt?: string | null;
  description?: string | null;
}

export function caseSeedIdea(c: CaseLike): string {
  const real = String(c.prompt || c.description || '').trim();
  if (real.length >= IDEA_MIN_CHARS) return real;

  const title = String(c.title || '').trim() || '无题';
  const genre = String(c.category || '').trim();
  const seed = genre
    ? `以《${title}》为题,拍一部${genre}风格的短剧`
    : `以《${title}》为题,拍一部短剧,讲一个完整的故事`;
  // 兜底:无论标题多短,送出去的这句都必须过得了开机门槛
  return seed.length >= IDEA_MIN_CHARS ? seed : `${seed},请展开成完整的剧情`;
}
