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
| `projects` | 14 (11U/3I) | ✅ project-repo | v9.0.2 |
| `users` | 8 (4U/4I) | ✅ user-repo | v9.0.2 |
| `notifications` | 7 | ✅ notification-repo | v9.0.2 |
| `comments` | 6 | ✅ comment-repo | v9.0.2 |
| `invite_codes` | 5 | ❌ 新建 | v9.0.3 |
| `global_assets` `character_library` `character_ip_tokens/grants` | ~13 | ❌ 新建 | v9.0.3 |
| `team_allocations` `generations` `waitlist` `*_share_tokens` `project_collaborators` `api_quota_alerts` `project_track_edits` | ~16 | ❌ 新建 | v9.0.4 |

## 迭代批次(每批 tsc + 全量测试 + dev 实测 PG, 独立提交)

- **v9.0.1 · project_assets → asset-repo**(部分完成 ✅):asset-repo 扩 8 个方法(`updateAssetBySelector`/`updateAssetDataInProject`/`deleteAssetsByType`/`setAssets(Stale|Confirmed)ByTypes`/`setAsset(Stale|Confirmed)` + create/update 加 `id`/`persistentUrl`/`bumpVersion`);**10 文件 / ~14 写**改走 repo(confirm/projects[id]/timeline/assets/extract-dna/regenerate-shot×2/4k/regenerate-storyboard/cameo-retry/narration);**PG 实测 10 方法全往返 ✅**。
- **v9.0.1b · project_assets 全清 ✅**(收尾 defer 的两块):
  - **create-stream**(7 写):`saveAsset`/`updateAssetMedia` 两个同步 helper + DNA `onProgress` UPDATE → `createAsset`/`updateAsset`/`updateAssetBySelector`/`listAssetsByType`。helper 转 `async`,11 处调用点全 `await`,内含 `.forEach` 改 `for...of`(否则不 await);后台 `persistFirstValid → persistent_url` 落盘**仍 fire-and-forget**(`await` 只覆盖毫秒级 INSERT,慢 fetch 不拖 SSE);DNA 持久化在 onProgress(同步回调)里用 fire-and-forget async IIFE,best-effort 不阻塞编排进度。
  - **rerun**(2 写):`db.transaction()`(2× project_assets stale UPDATE + `pipeline_reruns` INSERT)→ `getDbDriver().transaction(async tx ⇒ …)` 用 **tx 作用域 `tx.run`** 跨两表原子(repo 方法走全局 driver、在 PG 下不进本事务 client,故此处直接 inline SQL);两处 project_assets 读也改走 `getDbDriver().query`(避免 pg 模式读 sqlite 脑裂)。
  - 验证:**`app/` 内 raw `project_assets` 写 = 0**(grep 实证);PG 往返 11/11(saveAsset/DNA/updateMedia + 事务 **COMMIT 与 ROLLBACK** 原子性 + 清理);tsc 0 / 1851 测试全绿;Next dev SQLite 三路 HTTP 冒烟(无写)。
- **v9.0.2 · projects / users / notifications / comments → 既有 repo**:复用 project-repo / user-repo / notification-repo / comment-repo,补缺的方法
- **v9.0.3 · 新建 invite-repo / global-asset-repo / character-repo**(含 IP token/grant)
- **v9.0.4 · 新建 team/generations/waitlist/share/collaborator/quota/track-edit repo** —— 写路径全清
- **v9.0.5 · 切默认**:全量测试在 `DB_DRIVER=pg` 绿 → 文档建议生产 `DB_DRIVER=pg`;SQLite 仍可 env 回退

## 备注
- 测试偶发 DB-lock flake 实为 **进程卫生**(残留 dev/vitest 持锁),非 SQLite-vs-PG 本质问题;PG 真正价值是**多实例部署并发**。两者独立,后者由本计划解决。
