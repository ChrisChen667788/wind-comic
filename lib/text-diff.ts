/**
 * 轻量 line-level diff (LCS 回溯), 专给润色前后对比用。
 *
 * 为什么自己写而不是拉 jsdiff 之类:
 *   - 体量小 (< 100 行逻辑), 不想为"剧本润色对比"这一处场景拖一整个 npm 包
 *   - 我们只需要行级 diff (剧本每行都是明确的语义单元, 比如对白 / 动作)
 *     不需要 char-level 的内联高亮, 那反而杂
 *   - 结果形式要适配"左右并排 + 修改行同列对齐"这个 UI, jsdiff 原始 ops
 *     还得再包一层, 不如一次到位
 *
 * 算法: 经典 LCS DP (O(m*n) 时空, 对剧本规模的 1k×1k 行完全够用), 回溯
 *      得到 keep/del/add 操作流, 然后把连续的 del+add 两两配对为 mod,
 *      生成可以直接渲染的 DiffRow[]。
 *
 * 用法:
 *   const rows = diffLines(before, after);
 *   const stats = diffStats(rows);
 *   rows.forEach(row => ...render...);
 */

export type DiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'mod'; left: string; right: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string };

export interface DiffStats {
  same: number;
  mod: number;
  add: number;
  del: number;
  total: number;
  /** mod+add+del 之和, 等价于"与原文不同的行数" */
  changed: number;
  /** 改动占比 0-1 (changed / total), 空 diff 返回 0 */
  changeRatio: number;
}

/**
 * 对两段文本做行级 diff。
 * 换行归一化: \r\n 和 \r 都当 \n 处理, 避免因粘贴换行差异而整段"全变了"。
 */
export function diffLines(before: string, after: string): DiffRow[] {
  // 空字符串不应被 split 成 [''], 否则会出现一个"幽灵空行"干扰配对
  const A = before === '' ? [] : normalize(before).split('\n');
  const B = after === '' ? [] : normalize(after).split('\n');
  const m = A.length;
  const n = B.length;

  // 极端短路径, 省点常量
  if (m === 0 && n === 0) return [];

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i - 1] === B[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 回溯: 从右下角回到 (0,0), 收 ops (逆序)
  type Op = { t: 'k' | 'd' | 'a'; text: string };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) {
      ops.push({ t: 'k', text: A[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ t: 'd', text: A[i - 1] });
      i--;
    } else {
      ops.push({ t: 'a', text: B[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ t: 'd', text: A[i - 1] }); i--; }
  while (j > 0) { ops.push({ t: 'a', text: B[j - 1] }); j--; }
  ops.reverse();

  // 把两个 keep 之间的一整段 "非 keep" ops (d 和 a 可能任意顺序) 整体拎出来,
  // 按出现的 d/a 总数两两配对成 mod, 剩余部分各自 del / add。
  // 这样无论 LCS 回溯选的是 del-then-add 还是 add-then-del, 视觉上都能对齐。
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.t === 'k') {
      rows.push({ kind: 'same', text: op.text });
      k++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].t !== 'k') {
      if (ops[k].t === 'd') dels.push(ops[k].text);
      else adds.push(ops[k].text);
      k++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      rows.push({ kind: 'mod', left: dels[p], right: adds[p] });
    }
    for (let p = pairs; p < dels.length; p++) {
      rows.push({ kind: 'del', text: dels[p] });
    }
    for (let p = pairs; p < adds.length; p++) {
      rows.push({ kind: 'add', text: adds[p] });
    }
  }
  return rows;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let same = 0, mod = 0, add = 0, del = 0;
  for (const r of rows) {
    if (r.kind === 'same') same++;
    else if (r.kind === 'mod') mod++;
    else if (r.kind === 'add') add++;
    else del++;
  }
  const total = rows.length;
  const changed = mod + add + del;
  return {
    same, mod, add, del, total, changed,
    changeRatio: total === 0 ? 0 : changed / total,
  };
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
