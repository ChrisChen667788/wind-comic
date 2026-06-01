# Postgres 全量切换 · v9.0 runbook + 写路径迁移计划

> 阶段十一 v9.0.x。目标:SQLite → Postgres 全量切换,根治多实例部署下的并发写锁。
> **关键安全性**:默认 `DB_DRIVER=sqlite` 下,raw `db`(better-sqlite3)与 DbDriver **指向同一个 SQLite 文件**,
> 无 split-brain。PG 为 **opt-in**(`DB_DRIVER=pg`),写路径分批迁移,**默认用户零影响**,
> 直到最后一批落地后 PG 才完全可用。

## ✅ v9.0 已验证的地基

| 项 | 状态 |
|---|---|
| `docker-compose.pg.yml` | postgres:17-alpine, 端口 5434(避开他项目 5433), 自助起停 |
| `npm run pg:migrate` | 74 条 DDL, 33 张表 ✅ |
| `npm run pg:smoke` | dual-driver SQL(参数化/upsert/事务)在 PG 正常 ✅ |
| `DB_DRIVER=pg npm run pg:verify` | user-repo / project-repo / DbDriver.transaction 在 PG 往返 ✅ |
| 真实 app on PG | `DB_DRIVER=pg DATABASE_URL=… npm run dev` 启动 + 关键页 200 + 注册走 PG 邀请码校验 ✅ |

### 自助起跑
```bash
docker compose -f docker-compose.pg.yml up -d        # 起 PG
export DATABASE_URL="postgres://wind:wind@localhost:5434/wind"
npm run pg:migrate                                    # 建 33 表
DB_DRIVER=pg npm run pg:verify                         # 域往返验证
DB_DRIVER=pg DATABASE_URL=$DATABASE_URL npm run dev    # 整 app 跑 PG
docker compose -f docker-compose.pg.yml down          # 停 (加 -v 清数据)
```

## 📋 写路径盘点(63 处 raw `db.prepare` / 40 文件)

> 旧文档"写路径全清"仅指 5 个核心 repo(auth/projects/assets/collab),实际 API 路由层仍有 63 处 raw 写。

| 目标表 | raw 写次数 | 已有 async repo? | 批次 |
|---|---|---|---|
| `project_assets` | ✅ **全清 (0 残留)** | ✅ asset-repo | v9.0.1 + **v9.0.1b** |
| `projects` | ✅ **全清** (create-stream/cameo/share) | ✅ project-repo | v9.0.2 + **v9.0.2b** |
| `users` | ✅ **全清** (register/create-stream/stripe) | ✅ user-repo | v9.0.2 + **v9.0.2b** |
| `notifications` | ✅ **已在 repo** (route 用 notification-repo) | ✅ notification-repo | 早已迁 |
| `comments` | ✅ **已在 repo** (route 用 createCommentAsync) | ✅ comment-repo/comments async | 早已迁 |
| `invite_codes` | ✅ **路由写全清** (admin/validate/register);审批发码随 v9.0.4 | ✅ **新建 invite-repo** | **v9.0.3** |
| `global_assets` | ✅ **全清** (6 路由 + create-stream) | ✅ **新建 global-asset-repo** | **v9.0.3b** |
| `character_library` | ✅ **全清** (3 路由) | ✅ **新建 character-repo** | **v9.0.3c** |
| `character_ip_tokens` `character_ip_grants` (+ cameo import 写 character_library) | ✅ **全清** (cameo-ip 3 路由) | ✅ **新建 cameo-ip-repo** | **v9.0.3d** |
| `team_allocations` `generations` `waitlist` `*_share_tokens` `project_collaborators` `api_quota_alerts` `project_track_edits` | ~16 | ❌ 新建 | v9.0.4 |

## 迭代批次(每批 tsc + 全量测试 + dev 实测 PG, 独立提交)

- **v9.0.1 · project_assets → asset-repo**(部分完成 ✅):asset-repo 扩 8 个方法(`updateAssetBySelector`/`updateAssetDataInProject`/`deleteAssetsByType`/`setAssets(Stale|Confirmed)ByTypes`/`setAsset(Stale|Confirmed)` + create/update 加 `id`/`persistentUrl`/`bumpVersion`);**10 文件 / ~14 写**改走 repo(confirm/projects[id]/timeline/assets/extract-dna/regenerate-shot×2/4k/regenerate-storyboard/cameo-retry/narration);**PG 实测 10 方法全往返 ✅**。
- **v9.0.1b · project_assets 全清 ✅**(收尾 defer 的两块):
  - **create-stream**(7 写):`saveAsset`/`updateAssetMedia` 两个同步 helper + DNA `onProgress` UPDATE → `createAsset`/`updateAsset`/`updateAssetBySelector`/`listAssetsByType`。helper 转 `async`,11 处调用点全 `await`,内含 `.forEach` 改 `for...of`(否则不 await);后台 `persistFirstValid → persistent_url` 落盘**仍 fire-and-forget**(`await` 只覆盖毫秒级 INSERT,慢 fetch 不拖 SSE);DNA 持久化在 onProgress(同步回调)里用 fire-and-forget async IIFE,best-effort 不阻塞编排进度。
  - **rerun**(2 写):`db.transaction()`(2× project_assets stale UPDATE + `pipeline_reruns` INSERT)→ `getDbDriver().transaction(async tx ⇒ …)` 用 **tx 作用域 `tx.run`** 跨两表原子(repo 方法走全局 driver、在 PG 下不进本事务 client,故此处直接 inline SQL);两处 project_assets 读也改走 `getDbDriver().query`(避免 pg 模式读 sqlite 脑裂)。
  - 验证:**`app/` 内 raw `project_assets` 写 = 0**(grep 实证);PG 往返 11/11(saveAsset/DNA/updateMedia + 事务 **COMMIT 与 ROLLBACK** 原子性 + 清理);tsc 0 / 1851 测试全绿;Next dev SQLite 三路 HTTP 冒烟(无写)。
- **v9.0.2 · projects / users → 既有 repo ✅**(notifications/comments 早已在 repo):
  - 盘点修正:实际 raw 写远少于估计 —— **register 早已走 `getDbDriver().transaction`**(users insert+邀请码消费原子);**comments route 早已用 `createCommentAsync`/`listCommentsAsync`/`deleteCommentAsync`**(DbDriver 事务版,含 @mention 通知扇出);**notifications route 早已用 `notification-repo`**。`lib/notifications.ts` / `lib/comments.ts` 的同步版是 legacy(route 不再调)。`lib/db.ts` 的 users/projects 写是一次性 demo seed(`if userCount>0 return`),SQLite bootstrap, 非运行时路径。
  - project-repo 补 2 个可复用方法:`insertProjectFull`(客户端 id + style/cameo/locked 创作列)+ `updateProjectById(id, patch)`(列白名单动态 SET, 无 owner 守卫, 自动 updated_at; 挡 key 注入)。+3 单测。
  - **create-stream**(6 projects + 1 users):项目 upsert(存在性读→`getProject`)INSERT→`insertProjectFull`、两条 UPDATE 合一→`updateProjectById`(`style_id` COALESCE 语义用条件展开保留);5 处后续 UPDATE(director_notes×2 / 完成 status+cover+script)→`updateProjectById`;demo 兜底建用户→`user-repo.createUser`。
  - **cameo**(2 projects):设/清 `primary_character_ref`→`updateProjectById`。
  - 验证:PG 往返 10/10(createUser/insertProjectFull/updateProjectById 含 COALESCE 语义 + cameo 设清 + 白名单守卫 + 清理);tsc 0 / 1854 测试(+3)全绿;create-stream/cameo HTTP 冒烟(400/404, 无写)。
  - **defer v9.0.2b**(需 PG schema 补列再迁):**share**(2 projects, `share_token`/`share_created_at` 不在 PG migrate,且 `ensureShareSchema` 用 SQLite PRAGMA/ALTER 需 PG 守卫)+ **stripe webhook**(1 users, 写 `updated_at` 列 PG users 没有)。
- **v9.0.2b · share + stripe webhook ✅**(projects/users 写路径全清):
  - **schema**:`share_token`/`share_created_at` 之前由 share route 的 `ensureShareSchema()` 运行时 SQLite ALTER 热加(PG 不兼容 PRAGMA)→ 纳入 canonical schema(`lib/db.ts` 两条 `addColumnIfMissing`),SQLite 新/旧库 + PG export 都带上;`db/schema.pg.sql` 重新生成(projects CREATE 含两列)。**dev PG 用 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 补列**(pg:migrate 是 `CREATE IF NOT EXISTS` 只建不改,既有 PG 表需 ALTER —— 生产同理)。
  - **share**:删掉 `ensureShareSchema()`(列已在 schema),POST/DELETE 两条 UPDATE → `updateProjectById`(白名单加 `share_token`/`share_created_at`)。
  - **stripe webhook**:`updateUserSubscription(tier/status/stripeCustomerId)` → user-repo。**顺带修历史 bug**:旧 SQL 写 `users.updated_at` —— 该列 SQLite/PG **都不存在**,整条 UPDATE 一直在报错(订阅状态从没落库过);去掉 `updated_at` 后才真正生效。
  - 验证:PG 往返 8/8(updateUserSubscription 含 COALESCE 保留 customer + findUserById 无 updated_at 报错 + share 设/清);tsc 0 / 1857 测试(+3);share GET/POST/DELETE + stripe HTTP 冒烟(share DELETE 实跑 SQLite 写路径无 "no such column")。
- **v9.0.3 · 新建 invite-repo ✅**(invite_codes 路由写全清):新建 `lib/repos/invite-repo.ts`(async, DbDriver)—— create/generate/get/list/validate/revoke + `consumeInviteCodeTx`(tx 作用域, 从 lib/invite-codes 迁来, register 的注册闭环)+ `isInviteRequired`;三条路由(admin `invite-codes` / `validate` / `register`)改走 repo。旧 `lib/invite-codes.ts` sync 版保留(仅其单测 + waitlist 审批发码在用, **后者随 v9.0.4 waitlist 一起迁**)。验证:PG 往返 12/12(含 consumeInviteCodeTx 事务 + FK 用户 + revoke/validate 各态);tsc 0 / 1863 测试(+6);validate HTTP 冒烟(400 NOT_FOUND/INVALID)。
- **v9.0.3b · 新建 global-asset-repo ✅**(global_assets 全清):新建 `lib/repos/global-asset-repo.ts`(async, DbDriver)—— create/get/list/update/delete/recordAssetUsage + Character Bible 跨项目持久化(upsertCharacterBible/findCharacterBibleByName, 即 `type='character'` 的 global_asset.metadata.bible)。**6 路由 + create-stream(角色/场景全局登记 + bible upsert, 9 处调用)** 全改走 repo + await。旧 `lib/global-assets.ts` sync 版仅留给其 3 个单测。验证:PG 往返 12/12(JSON 字段 / list type+q / owner 守卫 / recordUsage 去重 / bible 合并 sampleFaces + referenced_by / 清理);tsc 0 / 153 文件 1869 测试(+6)。**忠实迁移**:发现并保留原行为 —— 首次 upsertCharacterBible 走 createGlobalAsset, referenced_by 留空(创建项目不计入),仅二次起累加(已在测试注释标注, 留作日后单独 fix 候选)。
- **v9.0.3c · 新建 character-repo ✅**(character_library 全清):新建 `lib/repos/character-repo.ts`(async, DbDriver)—— create/get/listByUser/update(全字段)/updateProfile(profile + 可选 image_urls)/delete,**返回原始行**让路由保留自有 snake→camel 映射(改动最小)。3 路由(`characters` POST、`[id]` PUT/DELETE、`[id]/studio` POST)全改走 repo + await;create 路由改用 repo 返回行作响应(DB 真值,顺手去掉散落 nanoid/now)。验证:PG 往返 8/8;tsc 0 / 154 文件 1874 测试(+5);HTTP 冒烟 4/4(list 200 / 400 Missing name / 404×2)。
- **v9.0.3d · 新建 cameo-ip-repo ✅**(character 域 + IP 经济全清):新建 `lib/repos/cameo-ip-repo.ts`(async, DbDriver)—— token issue(upsert)/revoke/list(market/owner)/get + grant request/decide/get/listPending + checkAccess + recordTokenUse(token+grant 双计数, 保留原非事务两写)+ importCameoToLibrary(写 character_library + recordTokenUse)。纯权限逻辑(resolveAccess/accessCanReuse)仍引自 `lib/cameo-ip`(单测核心不重复);旧同步 DB 版留给 tests/v4-0-cameo-ip。cameo-ip **3 路由**(route/[tokenId]/grants)全改走 repo。验证:PG 往返 **13/13**(issue upsert / market+owner 列表 / 各 access 级别 / grant 全流程 / recordTokenUse 双计数 / import 联名+dedup+revoke);tsc 0 / 155 文件 1878 测试(+4);HTTP 冒烟(market 200 真数据 / 404)。**至此 character 域(library + IP token/grant)全清。**
- **v9.0.4 / 4b / 4c · 就地异步化收尾**(team/waitlist/generations · share/collab · timeline-tracks)✅ —— 写路径主体全清(详见 VERSIONS 各条)。剩 `api_quota_alerts`(遥测)+ 低频内部表(yjs_docs/agent_workflows/shot_vision_audits/preview_history/plugin_chain_events/chat_messages 等)用 raw `db`(SQLite),**默认无 split-brain**,留 **v9.0.4d 机会主义**收尾。
- **v9.0.5 · PG 生产就绪声明 ✅**:核心读写路径(17 张表/簇:project_assets/projects/users/notifications/comments/invite_codes/global_assets/character_library/character_ip_*/team_*/generations/waitlist/project_share_tokens/project_collaborators/template_share_tokens/project_track_edits)全走 DbDriver,**逐 repo PG 往返已验**(v9.0.1b→4c 累计 ~90 项断言全绿)+ **真实 app 跑 PG**(v9.0)。→ **生产建议 `DB_DRIVER=pg` + `DATABASE_URL`**;dev/test 默认 SQLite(raw db 与 DbDriver 同文件,无 split-brain)。

## 备注
- **为什么 vitest 默认仍 SQLite,不是「全量测试在 PG 跑」**:测试隔离靠**每文件独占 SQLite 库**(`qfmj.test.<pid>.<rand>.db`);共享 PG 无此隔离模型,全量并发跑会互相踩。让整套 vitest PG-native 需重构隔离(每测 schema / 事务回滚级),属独立工程,后置。PG 正确性由**逐 repo 往返脚本** + **app 实跑** 双重保证。
- 测试偶发 DB-lock flake 实为 **进程卫生**(残留 dev/vitest 持锁),非 SQLite-vs-PG 本质问题;PG 真正价值是**多实例部署并发写锁根治**。
