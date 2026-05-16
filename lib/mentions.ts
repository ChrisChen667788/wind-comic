/**
 * v3.0 P0.1 — @-mention 解析
 *
 * 评论里的 @ 语法:
 *   - 文本里写 `@username` 或 `@张三` (支持中英文 + 数字 + 下划线)
 *   - 服务端解析时把名字按 users.name 精确匹配 (case-insensitive for English-only names)
 *   - 命中 → 写入评论 mentions JSON + 创建 notification
 *   - 没命中 → 文本里保留, 不生成通知 (用户可能在写 placeholder)
 *
 * 设计:
 *   - 解析与 user 表 lookup 分离, 让纯函数好测.
 *   - mentions 数组 dedup, 一条评论 N 次 @ 同一人只通知 1 次.
 *   - 上限: 一条评论最多 20 个 @ (防恶意 broadcast).
 */

/**
 * 从文本里抽出所有 @-mention 名字 (不去重, 顺序保留).
 *
 * 规则:
 *   - `@` 后跟连续的中文字符 / 拉丁字母 / 数字 / 下划线
 *   - 中文姓名通常 2-4 字, 但为了不限制用户取名, 上限是 30 个字符
 *   - 边界: 空白 / 标点 / 字符串结尾 都终止 mention
 *
 * 示例:
 *   parseMentionNames("@张三 你怎么看 @lee_w") → ['张三', 'lee_w']
 *   parseMentionNames("email@example.com") → []  (@ 前有字符不算 mention)
 */
export function parseMentionNames(content: string): string[] {
  if (typeof content !== 'string' || !content) return [];
  const out: string[] = [];
  // (?:^|\s|[，。、,.;:!?]) 表示 @ 前必须是行首 / 空白 / 中英标点 (而不能是字母数字 — 否则 user@host 类邮件会误判)
  // ([一-龥A-Za-z0-9_]{1,30}) 是用户名本体 (中文 / 字母 / 数字 / 下划线, 1-30 字符)
  const re = /(?:^|[\s,，。、.;:!?])@([一-龥A-Za-z0-9_]{1,30})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) out.push(m[1]);
    if (out.length >= 20) break; // 上限保护
  }
  return out;
}

/**
 * 去重 + 截断 (一个评论最多 20 个 mention).
 */
export function uniqueMentions(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= 20) break;
  }
  return out;
}
