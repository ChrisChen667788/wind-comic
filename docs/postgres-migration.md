# SQLite → Postgres 迁移 Runbook (v4.2)

> 现状: 全站用 `better-sqlite3` (同步 API), `data/qfmj.db` 单文件. 并发写偶发
> `database is locked` (靠 `busy_timeout=5000` + 测试 `retry:1` 兜). 上量后必须迁 PG.
>
> v4.2 交付的是**迁移路径地基** (方言转换 + schema 导出, 全部带单测), 不是一键
> cutover —— cutover 的真正工作量在把 ~250 处同步 `db.prepare().get()` 改成 PG 异步.

## 难点: 同步 vs 异步

`better-sqlite3` 是同步的 (`db.prepare(sql).get()` 直接返结果). `pg` / `postgres.js`
是异步的 (`await client.query(...)`). 这是迁移最大的工作量 —— 不是搬数据, 是把
全站调用点改成 `await`. 三种策略:

| 策略 | 说明 | 取舍 |
|---|---|---|
| A. 全量异步化 | 所有 `db.xxx()` → `await dbAsync.xxx()`, 调用链一路加 async | 最干净, 工作量最大 (~250 点) |
| B. 同步桥接 | 用 `pg` 同步包装 (如 worker thread + Atomics) 保持同步签名 | 风险高, 性能差, 不推荐 |
| C. 双写过渡 | 新表走 PG, 老表留 SQLite, 逐表迁 | 复杂度高但可灰度 |

推荐 **A**, 分模块 PR 推进 (auth → projects → assets → 协作 → v3/v4 新表).

## v4.2 已提供的工具 (lib/, 带单测)

### `lib/db-dialect.ts`
- `sqliteParamsToPg(sql)` — `?` 占位符 → `$1,$2,...` (跳过字符串字面量里的 `?`)
- `translateDDL(ddl)` — 建表语句翻译: `BLOB→BYTEA`, `DATETIME→TEXT`,
  `INTEGER PRIMARY KEY AUTOINCREMENT→BIGSERIAL`, 反引号→双引号
- `translateUpsert(sql, conflictCols)` — `INSERT OR REPLACE`→`ON CONFLICT DO UPDATE`
- `isSqliteOnlyStatement(sql)` — 标记 PRAGMA/VACUUM 等迁移时跳过

### `lib/db-schema-export.ts`
- `exportPostgresSchema()` — 读活 SQLite schema, 输出 PG 兼容建表脚本
- `listUserTables()` — 列出所有用户表 (数据搬迁按表遍历)

## Cutover 步骤 (建议)

1. **起 PG**: `docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`
2. **建 schema**: 在 server 端跑 `exportPostgresSchema()` 拿 DDL → 在 PG 执行
   ```ts
   import { exportPostgresSchema } from '@/lib/db-schema-export';
   console.log(exportPostgresSchema()); // 复制到 psql 执行
   ```
3. **搬数据**: 对 `listUserTables()` 每张表 `SELECT *` from SQLite → 批量 `INSERT`
   到 PG (列名一致, 时间戳都是 ISO TEXT 无需转换)
4. **加 DB 抽象层**: 引入 `lib/db-driver.ts` 接口, 让 SQLite/PG 两实现并存,
   `DB_DRIVER=pg` env 切换
5. **逐模块异步化**: 按策略 A, 一个 PR 一个领域改 `await`, 配套测试
6. **灰度**: 先内部环境 `DB_DRIVER=pg`, 观察一周, 再切生产
7. **退路**: 出问题 `DB_DRIVER=sqlite` 回滚 (保留 SQLite 实现到下个大版本)

## 注意事项

- **时间戳**: 现全是 ISO 字符串存 TEXT. PG 上保持 TEXT 最省事; 真要 `timestamptz`
  需配套改所有读写 (不建议首轮做)
- **布尔**: SQLite 用 0/1 (INTEGER). PG 有原生 `boolean` —— 首轮保持 INTEGER 列,
  代码不动; 后续再优化
- **`yjs_docs.state` BLOB** → PG `BYTEA`, 读写需 Buffer 适配 (y-websocket persistence)
- **并发**: 迁 PG 后 `database is locked` 根治, 可去掉 `vitest.config` 的 `retry:1`
  和 `busy_timeout` 依赖

## v6.6 — 一键本地验证 (已在 Docker PG 跑通)

三条命令把"全量切换"从纸面验到可运行 (本地 Docker Postgres):

```bash
# 1) 起一个本地 PG (端口按需改, 这里用 5434 避让常见占用)
docker run --name wind-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=wind -p 5434:5432 -d postgres:16

# 2) bootstrap 全量 schema 到 PG (从活 SQLite 导出 apply-ready DDL → 写 db/schema.pg.sql → 顺序执行)
DATABASE_URL=postgres://postgres:pw@localhost:5434/wind npm run pg:migrate

# 3) async repo 真连 PG 往返 (user/project/transaction 全经 PgDriver)
DB_DRIVER=pg DATABASE_URL=postgres://postgres:pw@localhost:5434/wind npm run pg:verify
```

- `npm run pg:smoke` — 裸 SQL 冒烟 (连接/建表/参数化/UPSERT/DELETE), 已通过
- `npm run pg:migrate` — `exportPostgresSchema({ applyReady: true })` 产出**去 FK 约束**
  (SQLite 未开 PRAGMA foreign_keys, FK 本不强制 → 去掉免按依赖排序) + **去行注释**
  (有的注释含 `;` 会坑分号切语句) + **补 `IF NOT EXISTS`** (sqlite_master 丢了它 → 幂等),
  顺序 apply; **幂等可重复跑**。生成的 `db/schema.pg.sql` 一并入库供 review
- `npm run pg:verify` — `DB_DRIVER=pg` 下跑 `user-repo` / `project-repo` 的
  create/get/list/update + `DbDriver.transaction`, 证业务层 (非裸 SQL) 在 PG 工作
- **bigint 坑已修**: `pg` 默认把 `int8`/`BIGSERIAL`/`COUNT(*)` 解析成 string,
  `PgDriver` 统一 `setTypeParser(20, Number)` → 与 SQLite 的 number 行为一致
  (一处修, `countUsers` / `countProjectAssets` 等全部受益)

实测: 清库后 `pg:migrate` 应用 **74 条 DDL → 33 张表**, 再跑一次仍 OK (幂等);
`pg:verify` 三组断言全绿。剩下的仅是**生产 PG 实例 + 数据搬迁** (按上面"搬数据"一节),
代码侧已就绪。
