/**
 * v12.399:同一道防线,两条清理路径都得有。
 *
 * 这个仓库里有**两套**删文件的逻辑:
 *   · `app/api/cron/cleanup-media` 的 `sweepDir()`  —— 扫 composed / exports / media,按**文件名**比对
 *   · `lib/asset-storage` 的 `cleanup()`            —— 扫 storage/assets,按**内容寻址 key** 比对
 * 两者都由同一个 cron(每天 04:10)触发,都以「有没有被引用」为唯一保护。
 *
 * v12.394 的事故形态是**保护名单恒空**:抽名正则从 URL 编码路径里抽出
 * `2Ffinal-xxx.mp4`,与磁盘上的真名永远对不上,于是每一个被引用的成片
 * 都被判成孤儿 —— owner 那次丢了 30 个项目 534 个素材。
 * v12.398 给 sweepDir 加了自检,但 asset-storage 那条**没有** ——
 * 而它管着 160 个素材文件。同一个病要犯两次的话,第二次就是它了。
 *
 * 判据只有一条,朴素但有效:
 * **一个非空目录里「一个文件都没被引用」,几乎必然是引用集算错了,
 * 而不是真有那么多孤儿。**
 * 正常运行的系统里,磁盘上的文件绝大多数都挂在某条记录下;
 * 「全都是孤儿」这种结论,更可能是判定坏了而不是事实。
 *
 * 与其相信自己的正则,不如在这一刻停手 —— 少清一次磁盘是可逆的,删错文件不是。
 */

export interface SweepTally {
  /** 目录里扫到的文件总数 */
  total: number;
  /** 其中被引用、因此永不删的数量 */
  referenced: number;
}

export interface RefuseVerdict {
  refuse: boolean;
  reason?: string;
}

/**
 * 决定这一轮该不该动手删。
 *
 * @param where 用于报错信息的位置描述(目录名 / 逻辑名)
 */
export function shouldRefuseSweep(tally: SweepTally, where: string): RefuseVerdict {
  const total = Number(tally?.total) || 0;
  const referenced = Number(tally?.referenced) || 0;

  // 空目录没什么可删的,也没什么可判的
  if (total === 0) return { refuse: false };

  if (referenced === 0) {
    return {
      refuse: true,
      reason:
        `拒绝清理 ${where}:目录里 ${total} 个文件,**一个都没被引用** —— ` +
        `这几乎必然是引用集算错了(v12.394 就是这么丢的 534 个素材),` +
        `而不是真有 ${total} 个孤儿。本轮不删,请先查引用集的构造逻辑。`,
    };
  }

  return { refuse: false };
}
