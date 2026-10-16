# README 赞助位存档

`README.md` 与 `README.zh-CN.md` 顶部(hero 之后、「Why Wind Comic?」之前)有一个赞助位,位置用两行看不见的 HTML 注释标出:

```
<!-- sponsor-slot:start -->
<!-- sponsor-slot:end -->
```

两行之间为空 = 空位;有内容 = 正在展示的赞助商。每个赞助商的原文按目录存档在这里,逐字节取自当时的 README,上下架都只动两行注释之间的内容。

## 上架 / 下架

```bash
npm run sponsor -- status        # 两份 README 现在挂的是谁
npm run sponsor -- on metaso     # 上架:把存档原样放回(中英两份 README 一起)
npm run sponsor -- off           # 下架:清空两行注释之间,存档不动
```

改完会自动重跑 `scripts/gen-modelscope-intro.mjs`,ModelScope 介绍页(`docs/modelscope-intro.md`)跟着变。之后照常 commit、push,再 `npm run ms:sync` 同步 ModelScope。

`tests/v13-1-sponsor-slot.test.ts` 守着三件事:两份 README 的锚点成对且唯一;挂着的内容必须和某份存档逐字一致(手改过就红);任一存档上架后,README 媒体总量仍在预算内、logo 文件存在、落地页链接带着分成参数。

## 存档

| 目录 | 赞助商 | 上架 | 下架 | 备注 |
|---|---|---|---|---|
| `metaso/` | 秘塔科技 · MiniMax H3 视频生成 API | 2026-09-07 | 2026-10-16 | logo `assets/sponsors/metaso.png`(仍在仓库里);落地页 `https://metaso.cn/minimax-h3/?s=wind-comic`,**`?s=wind-comic` 是分成追踪参数,不能丢** |

新增赞助商:建 `docs/sponsors/<id>/README.md.snippet` 与 `README.zh-CN.md.snippet`(内容以 `## ` 标题开头、以 `\n\n---\n\n` 结尾,和现有存档同一版式),logo 放 `assets/sponsors/`,再 `npm run sponsor -- on <id>`。
