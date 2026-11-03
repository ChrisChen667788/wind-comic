# 生产级部署指南(v11.0)

> 本文档由 v11.0 收口时对仓库的全量盘点生成,所有事实以代码为准(标注来源文件)。
> 两种拓扑:**单机**(默认,SQLite + 本地盘,零外部依赖)与 **多副本**(PG + Redis + S3)。

---

## 拓扑一:单机(推荐起步)

```bash
# 最小可跑(演示模式,零密钥):
MOCK_ENGINES=1 PIPELINE_QUEUE=1 npm run build && npm start

# 生产单机最小集:
JWT_SECRET=<强随机串>            # 必改 —— auth fail-fast 会拒绝默认值
OPENAI_API_KEY=<key>             # 通用 LLM(任意 OpenAI 兼容端点)
MINIMAX_API_KEY=<key>            # 视频/TTS + LLM 兜底
PIPELINE_QUEUE=1                 # 任务队列(断线续跑/kill -9 恢复)
```

单机下:SQLite(`data/qfmj.db`,WAL)+ 本地存储(`data/storage/assets/`)+ 进程内事件总线,全部零配置。

## Docker 与 NAS 自托管

> v13.6 新增。适用:群晖 / 威联通 / Unraid / 任意装了 Docker 的 Linux 主机上的**单机**部署(SQLite + 本地盘)。
> 文中命令与数字都在官方镜像里实跑过(colima arm64,模拟 NAS 的属主与内存限制);**群晖 DSM 的图形界面路径没有在真机上核对**,下文只给 SSH 命令。

### 硬件要求(v13.6 镜像实测)

| 项 | 要求 | 依据 |
|---|---|---|
| 架构 | `linux/amd64` 或 `linux/arm64`;**不支持 32 位 ARM**(armv7) | 镜像只发布这两个架构 |
| 显卡 | 不需要 | 生成全走引擎 API;本机只有 ffmpeg 合成,用 CPU |
| CPU | 2 核可用 | 核数只影响合成耗时:6 镜 30 秒 720p 成片 2 核约 16 秒、4 核约 10 秒;竖屏 1080×1920 约 29 / 18 秒 |
| 内存(空闲) | 70–120 MB | Node 服务常驻 |
| 内存(合成峰值) | 整容器:**720p ≈ 0.95 GB**(943 MiB),**竖屏 1080×1920 ≈ 1.75 GB**(1751 MiB);其中 ffmpeg 自身 858–869 MiB / 1648–1680 MiB | 6 镜 × 5 秒(其中一镜调速)、xfade 转场 + 中文字幕 + 响度归一,读 cgroup `memory.peak`,2 核与 4 核都测;v13.1 镜像里的 ffmpeg 7.0.2 同场景高 1–5% |
| 给容器的内存 | 实测最低能过:720p 1 GB(余量仅约 80 MiB)、竖屏 2 GB;**建议 720p 至少 1.5 GB,竖屏 1080p 至少 2.5 GB** | 限 768 MB 时 720p 合成被 OOM 杀,限 1 GB 时竖屏被杀;整机建议 4 GB 起(还要留给 NAS 系统本身) |
| 磁盘 | 镜像下载约 830 MB、解压约 3 GB;`data/` 另留 10 GB 以上 | 素材与成片都落在 `data/storage/`、`data/composed/` |

### 一步一步部署

```bash
# 1. 建目录(群晖示例:/volume1/docker/wind-comic)
mkdir -p /volume1/docker/wind-comic && cd /volume1/docker/wind-comic

# 2. 取 compose 与 .env 模板(也可以从仓库 deploy/ 目录手动拷)
curl -fsSLO https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/deploy/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/deploy/.env.example -o .env

# 3. 填 .env 里的两项必填
openssl rand -hex 32          # 输出填到 JWT_SECRET=
#    DEMO_PASSWORD=<首个账号 demo@qfmanju.ai 的密码>

# 4. 数据目录交给容器用户(uid/gid 1001)—— 不做这一步登录不了(登录页会提示「服务端数据库打不开」)
mkdir -p data && sudo chown -R 1001:1001 data

# 5. 起
sudo docker compose up -d     # 旧版群晖:sudo docker-compose up -d

# 6. 等健康检查变绿,再登录
sudo docker ps                # STATUS 里出现 (healthy)
curl http://localhost:3100/api/health
# → {"ok":true,"checks":{"db":"ok","auth":"ok"}}
```

然后浏览器打开 `http://<NAS 局域网 IP>:3100`,用 `demo@qfmanju.ai` + `DEMO_PASSWORD` 登录。

**不方便 SSH / 不想 chown**:把 `deploy/docker-compose.yml` 里的 `- ./data:/app/data` 换成 `- wind-comic-data:/app/data`,并取消文件末尾 `volumes:` 两行的注释。命名卷由 Docker 创建,属主天然正确;代价是数据不在你能直接看到的共享文件夹里(在 Docker 自己的卷目录下)。

**升级**:`sudo docker compose pull && sudo docker compose up -d`。数据都在 `data/`(或命名卷)里,换镜像不丢。
**备份**:先 `sudo docker compose stop` 再整目录拷走 `data/` —— SQLite 开着 WAL,运行中直接拷可能拷到不一致的库。

### 首次登录与首次创作

- **第一个账号**是 `demo@qfmanju.ai`,密码 = `DEMO_PASSWORD`。没设的话首次启动随机生成,只在 `docker logs` 里打印一次(`[seed] DEMO_PASSWORD 未设置,demo 账号使用一次性随机密码: …`);事后补设 `DEMO_PASSWORD` 再重启,密码会自动改成它。生产环境下 demo 账号一律是普通成员,不是管理员。
- **注册默认要邀请码**。设 `BETA_INVITE_REQUIRED=false` 可开放注册 —— 只在纯内网、信任每一个能打开这个地址的人时这么做。
- **免费档月预算 ¥5**:新账号的月度花费上限是 ¥5,而一部真引擎成片的预检估价是 ¥11.6–18.8(默认 8 镜 × 6 秒,按视频引擎单价),第一次点「开机」就会被拦:「本次预估 ¥… 将越过硬上限 ¥5」。到 `/dashboard/usage` 把「月预算 ¥」调高即可(输入框失焦即保存)。零 key 演示(`MOCK_ENGINES=1` 且没配任何真引擎)从 v13.6 起按 ¥0 估价,不会被拦。
- **从别的设备访问**:局域网内直接 `http://<NAS 局域网 IP>:3100` 即可登录和创作(v13.5 起 `COOKIE_SECURE` 默认 `auto`,不需要反代);纯 HTTP 下令牌明文传输,只在可信内网这样用,公网访问请放到 HTTPS 后面。细节与反代配置见 [§12 会话 Cookie 与 HTTPS](#12-会话-cookie-与-https)。

### 健康检查 `/api/health`(v13.6)

镜像自带的 `HEALTHCHECK` 从 v13.6 起探 `/api/health`(之前探首页 —— 首页是静态壳,下面几种「登录不了」时首页照样 200、容器照样 healthy)。它只做两件便宜的事:数据库跑一句 `SELECT 1`(SQLite 再确认数据目录和库文件可写),以及用当前 `JWT_SECRET` 签一枚不外发的令牌。不打外网,不读引擎 key。数据库和密钥分开查,两个问题同时存在时一次报全。

| 返回 | 含义 |
|---|---|
| `200 {"ok":true,"checks":{"db":"ok","auth":"ok"}}` | 能登录 |
| `503 … "reasons":["db_unavailable"]` | SQLite 数据库打不开(数据目录属主/挂载不对) |
| `503 … "reasons":["db_unreachable"]` | `DB_DRIVER=pg` 时连不上 PostgreSQL:地址不对或库没起来、账号密码或库名不对、没设 `DATABASE_URL` |
| `503 … "reasons":["db_not_writable"]` | 库能读但写不进去(数据目录或库文件不可写) |
| `503 … "reasons":["jwt_secret_missing"]` | 没设 `JWT_SECRET` |
| `503 … "reasons":["jwt_secret_weak"]` | `JWT_SECRET` 是公开占位串(`.env.example` / 教程里的 `change_me_…` 等) |

原因代码与登录/注册返回的 503 里的 `reason` 是同一套(v13.11 起;v13.6–v13.10 两种 JWT 问题合并报 `jwt_secret_invalid`)。对外只给原因代码;详情(含容器 uid)只写进服务端日志,而且只在状态变化时打一次。

### 首页正常、登录不了:常见成因

v13.11 起,下面几种情况登录页和注册页会**直接显示原因和修法**(PostgreSQL 那一行从 v13.12 起)(接口返回 `503 {"code":"server_misconfigured","reason":"…","message":"…"}`),不论密码对错;页面照常能打开。此前都是一个不带说明的 **500**:库打不开时密码对错都 500,开了 `PIPELINE_QUEUE=1` 时连首页也 500;JWT 两种是「密码错 401、密码对 500」。

再 `sudo docker logs wind-comic 2>&1 | grep -E "SQLITE|unable to open|JWT_SECRET|PostgreSQL"` 对号入座(日志原文均为实测):

| 登录页提示(`reason`) | 日志 | 成因 | 修法 |
|---|---|---|---|
| 「服务端数据库打不开……」(`db_unavailable`) | `[db] 数据库打不开(SQLITE_CANTOPEN: unable to open database file)—— 库文件 …,运行用户 uid 1001`;开了 `PIPELINE_QUEUE=1` 还会有一行 `[instrumentation] 数据库打不开 —— 本次不启动……任务队列 worker`(v13.11 前:`SqliteError: unable to open database file`,`PIPELINE_QUEUE=1` 时是 `… loading instrumentation hook: unable to open database file`) | 绑定挂载的 `data/` 属于 NAS 账号(群晖默认 `1026:100`),容器以 `nextjs`(1001:1001)运行,建不了库文件 | `sudo chown -R 1001:1001 data`,或改用命名卷;然后 `sudo docker compose restart`(库只在开机时打开一次,修好权限要重启才生效) |
| 「服务端没配置 JWT_SECRET……」(`jwt_secret_missing`) | `[auth] JWT_SECRET 未设置 —— 生产环境必须配置一个高强度随机密钥…` | 没设 `JWT_SECRET` | `openssl rand -hex 32` 填进 `.env`,`docker compose up -d` 重建 |
| 「服务端没配置 JWT_SECRET(现在填的是示例里的公开占位值……)」(`jwt_secret_weak`) | `[auth] JWT_SECRET 是公开占位/弱默认值…` | 用了 `.env.example` 或教程里的占位串(黑名单在 `app/api/auth/lib.ts`) | 同上 |
| 「服务端连不上数据库(PostgreSQL)……」(`db_unreachable`,仅 `DB_DRIVER=pg`) | `[db] PostgreSQL 连不上或没配好(<原因>):…`,`<原因>` 是 `ECONNREFUSED`(端口没人听)/ `ENOTFOUND`(主机名解析不到)/ `ETIMEDOUT` / `28P01`(密码错或无此用户)/ `3D000`(库不存在)/ `57P03`(库正在启动)/ `53300`(连接数满)/ `database_url_missing` / `pg_not_installed` | `DATABASE_URL` 写错或没设;PG 没起来,或从容器里访问不到(容器里的 `localhost` 是容器自己,要写 PG 容器的服务名);账号密码或库名不对 | 改对 `DATABASE_URL` 或把 PG 起来;改了环境变量要 `docker compose up -d` 重建。库起来之后不用重启,下一次登录会重新连 |

每次被拒的登录/注册还会记一行 `[auth/login] 503 server_misconfigured/<reason> —— <原文>`。对外的提示不带路径、异常原文和密钥值。
PostgreSQL 仍回 500 的情况(都不是 `db_unreachable` 能概括的,看日志里 `pg` 的原始报错):连上了但还没建表(`42P01 relation "users" does not exist`,先跑 `npm run pg:migrate`);`DATABASE_URL` 带 `sslmode=require` 而库没开 SSL(`The server does not support SSL connections`);端口上跑的不是 PG(`Connection terminated unexpectedly`)。PG 地址丢包不回应时,驱动没设连接超时,登录要一直等到操作系统放弃建连(`ETIMEDOUT`)才回 503。
运行中 PG 重启或网络闪断:池里的空闲连接会断,日志记一行 `[db-driver] PostgreSQL 空闲连接断开(57P01)…`,进程不退出,下一次查询重新连(v13.12 前这一下会让整个 Node 进程因未处理的 `error` 事件退出)。

### 在 NAS 上跑零 key 演示

`MOCK_ENGINES=1` 时演示素材(分镜 SVG、假视频)的链接按 `APP_URL` 拼。默认的 `http://localhost:3100` 只在 NAS 本机浏览器里有效;从别的电脑打开要把 `APP_URL` 设成浏览器实际访问的地址(例:`http://192.168.1.10:3100`),否则分镜图显示不出来。演示产物是确定性假素材,不代表真实生成质量。

## 拓扑二:多副本(水平扩容)

三个就绪件 **必须同时配齐**:

| 件 | 环境变量 | 作用 |
|---|---|---|
| PostgreSQL | `DB_DRIVER=pg` + `DATABASE_URL=postgresql://...` | 任务认领乐观锁在 PG 行级锁下多实例安全 |
| Redis 事件桥 | `REDIS_URL=redis://...`(支持 rediss TLS) | SSE 实时事件跨副本互通(否则评论/进度只在本副本可见) |
| S3 兼容存储 | `STORAGE_DRIVER=s3` + `S3_*` 四件套 | 媒体产物全副本共享(内容 hash 去重;本地副本仍会写,ffmpeg 消费需要) |

### 多副本已知限位(诚实清单)

**1. ~~recoverJobsAtBoot 多副本竞争~~（✅ v11.0.1 已修）**
v11.0.1 起孤儿判定改为**心跳超时**(`recoverOrphanJobs`,`lib/repos/pipeline-job-repo.ts`):running 任务每 15s 心跳,超 90s 未达才回收(开机 + 运行期每 30s 扫描共用同一函数);心跳新鲜的 running 不再被动 —— 多副本同时启动不会互踢双跑。残余假设:各副本 NTP 对时(时间戳跨副本比较,偏差需 ≪ 90s)。

**2. ~~appendJobProgress 读改写非原子~~（✅ v11.0.3 已修）**
v11.0.3 起进度事件改 **append-only INSERT**(`pipeline_job_events` 表):天然原子,多副本/PG 下无 lost update,也消除了 JSON 越长写放大越狠的 O(n²)。回放按 `(at, ord)` 升序取最近 400 条;历史任务自动回退旧 `progress_log` 列;超 24h 任务的事件随过期清扫一并删除。

**3. `lib/db.ts` 直接 import 绕过 DbDriver 抽象**
`app/api/projects/[id]/export/route.ts:2` 仍直接 `import { db } from '@/lib/db'`（raw better-sqlite3），切 `DB_DRIVER=pg` 时此路径仍走 SQLite。需检查所有直接 import `@/lib/db` 的 API 路由是否已完全迁移到 repo 层。

**4. S3 驱动下本地磁盘仍必须可写**
S3 mode 不能彻底去掉本地盘：写入时先落 `data/storage/assets/` 本地副本，ffmpeg 消费方（抽帧、口型渲染）依赖 `absPath`（`lib/storage.ts:184-199`）。容器化时必须挂载持久 volume 覆盖 `/app/data`，否则重启后本地副本丢失。

**5. Redis `qfmj-bus` 单频道所有事件走同一线路**
所有逻辑频道（notif/comment/pipeline）都序列化进同一个 Redis `qfmj-bus` 频道（`lib/event-bus-redis.ts:120`）。高并发下该频道可能成为瓶颈；Redis 不可用时降级进程内（无跨副本同步）而非报错，需监控。

**6. ~~Docker HEALTHCHECK 探测首页而非专用 /api/health~~（✅ v13.6 已修）**
v13.6 起 `HEALTHCHECK` 探 `/api/health`(数据库可读写 + JWT 密钥可用),start-period 20 s → 60 s。没有选 `/api/runtime/readiness`:它只读 env、不碰数据库,探不出「登录不了」;也没选 `/api/health/providers`:它打外网,网关抖一下不该让编排器把容器判死重启。见上文「Docker 与 NAS 自托管」。

**7. `scripts/llm-call.mjs` 子进程需随镜像一起部署**
`Dockerfile:48` 已 `COPY scripts ./scripts`，但必须确认 CI 构建时 `scripts/` 目录完整复制。子进程调用走 `process.cwd()/scripts/llm-call.mjs`（`services/hybrid-orchestrator.ts:791`），路径硬编码。

**8. SQLite WAL 文件在多 worker 并发写下的 busy_timeout**
`busy_timeout = 5000 ms`（`lib/db.ts:39`）。pipeline worker `MAX_ACTIVE=2` 时，两个 job 同时写 `progress_log`（每个 SSE 事件一次读改写）加上 heartbeat 写，4 路并发写 SQLite 在低 I/O 环境可能偶发超时。生产建议切 PG。

---

## 1. 进程模型：`next start` 单进程内启动了什么

**入口文件：** `instrumentation.ts`（Next.js `register()` hook，仅 `NEXT_RUNTIME === 'nodejs'` 时运行，每次进程启动执行一次）。

启动序列（按代码顺序）：

| 步骤 | 操作 | 条件 | 来源 |
|------|------|------|------|
| 1 | `initSentry()` → 加载 `@sentry/nextjs`，读 `SENTRY_DSN` | 未设置 `SENTRY_DSN` 或包未安装时静默降级为 console | `instrumentation.ts` + `lib/telemetry.ts` |
| 2 | `loadModelOverridesIntoEnv()` → 从 `model_overrides` 表读所有模型覆盖写回 `process.env` | 总是尝试；表未建时静默（首次建库时序） | `instrumentation.ts` + `lib/model-overrides.ts` |
| 3 | `ensurePipelineWorker()` → 启动 `setInterval` tick（1.5 s），同时异步调 `recoverJobsAtBoot()`（running→queued 孤儿恢复） | 仅 `PIPELINE_QUEUE=1` | `instrumentation.ts` + `lib/pipeline-worker.ts` |

**Sentry 初始化细节（`lib/telemetry.ts`）：**
- `tracesSampleRate` 默认 `0.1`，可 `SENTRY_TRACES_SAMPLE_RATE` 覆盖
- `release` 读 `NEXT_PUBLIC_APP_VERSION`
- Sentry 未安装/未配置时降级 console，不抛错

**Pipeline worker 细节（`lib/pipeline-worker.ts`）：**
- 并发上限 `MAX_ACTIVE = 2`
- Tick 间隔 `TICK_MS = 1500 ms`
- 心跳间隔 `HEARTBEAT_MS = 15 000 ms`
- globalThis key: `__qfmjPipelineWorker`
- `setInterval` 和心跳 timer 均调用 `.unref()`（不阻止进程退出）

**注意：** `PIPELINE_QUEUE=1` 时，`create-stream` 路由和 `voice-retake` 路由也会在请求到达时各自调一次 `ensurePipelineWorker()`（幂等，globalThis 保护）。来源：`app/api/create-stream/route.ts:84-89`、`app/api/projects/[id]/voice-retake/route.ts:52-55`。

## 2. globalThis 单例假设与多副本风险

**涉及 globalThis 的单例：**

| globalThis key | 用途 | 定义位置 |
|----------------|------|----------|
| `__qfmjBus` | 进程内 EventEmitter（事件总线） | `lib/event-bus.ts:21-23` |
| `__qfmjBusOrigin` | 本进程唯一标识（`${pid}-${uuid8}`，用于 Redis 防自回环） | `lib/event-bus.ts:27-28` |
| `__qfmjRedisBus` | RedisBusClient 实例 | `lib/event-bus.ts:18` |
| `__qfmjRedisBusStarted` | Redis 桥是否已初始化（幂等标志） | `lib/event-bus.ts:19` |
| `__qfmjPipelineWorker` | Pipeline worker 定时器引用（幂等标志） | `lib/pipeline-worker.ts:37` |

**多副本下的问题（未配 `REDIS_URL` 时）：**

1. `__qfmjBus`（`lib/event-bus.ts`）：纯进程内 EventEmitter。多副本时，副本 A 发出的 `emitPipeline`/`emitComment`/`emitNotification` 不能到达订阅在副本 B 的 SSE 连接，导致实时推送漏发。代码注释明确：「多实例部署事件互通」需 `REDIS_URL`。

2. `__qfmjPipelineWorker`（`lib/pipeline-worker.ts`）：每个副本进程启动一个 worker，`recoverJobsAtBoot()` 会把所有 `state='running'` 的任务重置为 `queued`。多副本同时启动时，两个副本的 boot recovery 可能互相把对方正在执行的任务踢回 queued，导致任务双跑。代码注释：「单进程 worker 假设，与 event-bus 同款取舍」（`lib/pipeline-worker.ts:9-11`）。

3. `DbDriver` singleton（`lib/db-driver.ts:162-168`）：进程级单例（`let singleton`），不在 globalThis 上，但每个副本进程独立建立自己的 PG pool，这部分在 PG 驱动下多副本是安全的。

## 3. 多副本就绪件：event-bus-redis 开启方式

**开启方式（`lib/event-bus.ts:33` + `lib/event-bus-redis.ts`）：**

```
REDIS_URL=redis://[:password@]host:port    # 明文
REDIS_URL=rediss://[:password@]host:port   # TLS
```

**内部机制：**

- 首次调 `busEmit` 或 `subscribe` 时触发 `ensureRedisBridge()`（幂等，`__qfmjRedisBusStarted` 标志保护）
- `startRedisBus()` 同步创建 `RedisBusClient`（`lib/event-bus-redis.ts:220-231`），socket 连接异步建立，未就绪期间发布请求进内部队列（上限 200 条，超出丢最旧）
- 使用两条独立 socket：pub socket（`PUBLISH`）和 sub socket（`SUBSCRIBE`），原因：Redis 规定订阅态连接不能发普通命令
- 所有事件走统一线路频道 `qfmj-bus`，信封携带 `channel`+`origin`+`event`；`shouldDeliver()` 按 `origin !== selfOrigin` 防自回环
- 断线退避重连：初始 1 s，每次翻倍，最大 30 s（`lib/event-bus-redis.ts:204-216`）
- `REDIS_URL` 不合法或连接失败时静默降级进程内模式（`lib/event-bus.ts:41-43`）
- 零新依赖：手写最小 RESP 子集（仅 AUTH/SUBSCRIBE/PUBLISH）

**必要性：** 不配 `REDIS_URL` 时，SSE 推送（评论、通知、pipeline 进度）仅在同一副本进程内可见；跨副本客户端收不到事件。

## 4. pipeline_jobs 表认领的多实例安全性（claimNextJob）

**认领逻辑（`lib/repos/pipeline-job-repo.ts:85-98`）：**

```sql
-- 第一步：读最老 queued
SELECT id FROM pipeline_jobs WHERE state = 'queued' ORDER BY created_at ASC LIMIT 1

-- 第二步：乐观更新（WHERE state = 'queued'）
UPDATE pipeline_jobs
  SET state = 'running', attempts = attempts + 1, heartbeat_at = ?, updated_at = ?
  WHERE id = ? AND state = 'queued'
```

`UPDATE` 返回 `changes = 0` 时 `claimNextJob` 返回 `null`（表示被并发拿走）。

**在 SQLite 驱动下：**
- better-sqlite3 在单进程内是序列化的，乐观锁有效。
- 但 SQLite 不支持真正的行级锁，多进程同时写同一文件会 `busy_timeout = 5000 ms`（`lib/db.ts:39`），超时后抛 `database is locked`。多副本下两个 worker 同时调 `claimNextJob` 可能出现竞争：SELECT 拿到同一个 id，UPDATE 时第二个副本因乐观锁返回 `changes=0` 安全跳过。**不会双跑**，但并发写压力大时有概率超时错误。

**在 PG 驱动下：**
- `pool.query` 并发安全，乐观锁 `WHERE state = 'queued'` 借助 PG 行级锁在并发 UPDATE 时只有一个成功（另一个 `rowCount=0`）。**多实例下认领是安全的**。
- 但 `recoverJobsAtBoot()`（`lib/repos/pipeline-job-repo.ts:179-193`）会把所有 `running` 任务重置为 `queued`，多副本同时启动时互相 recover 仍是问题（见第 2 节）。

**重试上限：** `MAX_ATTEMPTS = 3`。超限后进入 `failed`（死信），可通过 `POST /api/pipeline-jobs/:id/retry` 手动重投。

## 5. DB 驱动切换（SQLite vs PostgreSQL）

**切换方式（`lib/db-driver.ts:164-168`）：**

```bash
# SQLite（默认）
DB_DRIVER=sqlite    # 或不设置
# 数据库文件：<cwd>/data/qfmj.db

# PostgreSQL
DB_DRIVER=pg        # 或 DB_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

**驱动细节：**

| 特性 | SQLite | PostgreSQL |
|------|--------|------------|
| 依赖 | `better-sqlite3`（硬依赖） | `pg`（软依赖，懒加载，未装时给清晰错误） |
| 占位符 | `?` | `$1, $2, ...`（driver 自动转换，`lib/db-dialect.ts`） |
| int8/bigint | 直接 number | OID 20 统一解析为 `Number`（`lib/db-driver.ts:111`） |
| 事务 | `BEGIN/COMMIT` 同连接（同步） | pool checkout 单 client 全程跑 |
| WAL 模式 | `PRAGMA journal_mode = WAL` | 不适用 |
| busy_timeout | 5 000 ms | 不适用（pool 连接管理） |

**本地开发用 PG：**
```bash
docker compose -f docker-compose.pg.yml up -d
# 连接串: postgres://wind:wind@localhost:5434/wind
# 端口 5434 避开本机常用 5433
```
来源：`docker-compose.pg.yml`

**注意：** `lib/db.ts` 仍由 SQLite 驱动的部分模块直接 import（如 `app/api/projects/[id]/export/route.ts:2`），这些路径绕过了 `DbDriver` 抽象，切 PG 时需确认所有路径已迁移。

### 5.1 旧项目画幅自动改正(v13.3)

v12.468 之前创建页可以选 2.35:1:库里记的是 2.35:1,出片却是 16:9(漫剧 / 短剧题材还会被翻成 9:16)。
v13.3 起,应用**启动约 15 秒后在后台跑一次**改正,SQLite 与 PostgreSQL 都适用,不需要手动操作:

- 只处理 `projects.aspect` 不在 `16:9 / 9:16 / 1:1` 之内的项目(含空值),其余一概不动;
- 新画幅按**已出的素材**量(ffprobe 量单镜视频与分镜图的宽高,多数决;量不到再看成片);
  一件都量不到的,按 v12.468 起各生成入口实际在用的画幅(2.35:1 → 16:9);
- 量素材用的 ffprobe 与合成器同一套解析(ffprobe-static,其次系统 PATH;Docker 镜像自带)。机器上找不到能运行的
  ffprobe 时**一个都不改**,日志打 `[legacy-aspect] … 找不到能运行的 ffprobe`,装好后重启会再试;
- 每条改动写进 `data/legacy-aspect-repaired.json`,日志里逐条打印 `[legacy-aspect] <项目> 2.35:1 → 9:16(依据)`;
- 不改 `updated_at`,项目在列表里的顺序不变;
- 改成 16:9 的项目,之后出片和改正前一样(v12.468 起这类旧值本来就按 16:9 读);改成 9:16 / 1:1 的项目,
  之后的单镜重生、自愈补拍、片段重拍、重新合成、分镜 / 4K 重渲按新画幅出,和已有镜头一致 —— 改正前这些入口出的是横屏。

关闭:`LEGACY_ASPECT_REPAIR=off`。从源码部署时可以手动预览 / 执行 / 撤销:

```bash
npm run repair:aspect                # 只预览
npm run repair:aspect -- --apply     # 执行
npm run repair:aspect -- --restore   # 按账本撤销
```

Docker 运行镜像不带 `lib/` 源码,镜像里跑不了这个脚本 —— 靠启动时的自动改正;要撤销,在源码环境里连同一个库执行 `--restore`
(账本在挂载出来的 `data/` 里)。

## 6. Storage 适配（S3，v10.4.4）

**切换方式（`lib/storage.ts:146-163`）：**

```bash
# 本地磁盘（默认，零配置）
# 写入：<cwd>/data/storage/assets/<sha256_32char><ext>
# URL：/api/serve-file?key=<sha256>

# S3 兼容（BYO）
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.amazonaws.com    # 必须
S3_BUCKET=my-bucket                     # 必须
S3_ACCESS_KEY_ID=AKIA...                # 必须
S3_SECRET_ACCESS_KEY=...               # 必须
S3_REGION=us-east-1                    # 可选，默认 us-east-1
S3_PUBLIC_BASE_URL=https://cdn.example.com  # 可选；未设则返回 endpoint/bucket/key
```

**S3 驱动行为（`lib/storage.ts:184-199`）：**
- 先写本地副本（`data/storage/assets/`），再异步 S3 PUT
- S3 失败时降级返回本地 URL（不丢产物）
- 本地副本始终存在，保证 ffmpeg 类消费方（`editor-score` 抽帧、`last-frame-extractor`）能用 `absPath`
- SigV4 手写（零新依赖），支持 path-style（兼容 MinIO/R2/Cloudflare R2）
- PUT 超时 30 s（`AbortSignal.timeout(30_000)`）

**多实例下的含义：** 配 S3 后，所有副本写同一对象存储（通过内容 hash key，同内容只存一份）；读侧 `serve-file`/`resolveByKey` 不动，旧 URL 不迁移，新产物走 storage adapter。

## 7. ffmpeg 用途清单

**ffmpeg 进入方式(v13.8 起只有一个入口:`lib/ffmpeg-bin.ts`)：**
- 解析顺序:`FFMPEG_PATH` → `LIPSYNC_FFMPEG_PATH`(旧变量,兼容;原先只对本地 2D 口型生效,现在对所有 ffmpeg 调用生效)→ npm 随包的 `ffmpeg-static` → PATH 上的 `ffmpeg` → `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`。ffprobe 同理:`FFPROBE_PATH` → `ffprobe-static` → PATH → 同上几个目录。**两个变量各管各的**:只设 `FFMPEG_PATH` 不会改 ffprobe。
- 变量的值写可执行文件路径(相对路径按启动目录解析),或 PATH 上的命令名。设了却用不了(不存在 / 是目录 / 没有执行权限)会在日志里 warn 一条、按上面的顺序继续找 —— 不会静默生效失败。
- 实际用的是哪一个:第一次用到 ffmpeg 时日志打 `[FFmpeg] Using binary: <路径> (from <来源>)`,ffprobe 同理打 `[FFprobe] ...`。变量在进程里读,改了要重启服务。
- 合成、转码、抽帧、成片体检、本地口型、零 key 演示的假片……全部经这个入口;`lib/consumer-gate/contracts.ts` 的 `ffmpeg-binary-must-use-ffmpeg-bin` 门禁(CI 的 Security job 跑)拦住任何自己 import `ffmpeg-static` / `fluent-ffmpeg`、调 `setFfmpegPath`、按名字调 `ffprobe` 的新代码。**v13.8 之前这里写的「设 `FFMPEG_PATH`」并不成立**:合成器只认 ffmpeg-static 且会把 fluent-ffmpeg 自己对 `FFMPEG_PATH` 的读取盖掉,本地口型只认 `LIPSYNC_FFMPEG_PATH`,成片体检 / 画幅守门 / 角色锚抽帧按名字调 `ffprobe`(只装了 npm 依赖的机器上体检永远是「未知」)。
- `next.config.ts` 把 `ffmpeg-static`、`ffprobe-static`、`fluent-ffmpeg` 设为 `serverExternalPackages`(不打包,保持二进制路径正确)。随包的两份二进制被删掉也能跑 —— 入口会往下找。
- **Docker 镜像**:`apk add ffmpeg` 装系统 ffmpeg,并设 `FFMPEG_PATH=/usr/bin/ffmpeg`、`FFPROBE_PATH=/usr/bin/ffprobe`;npm 随包的 `ffmpeg-static` / `ffprobe-static` 二进制在构建阶段删掉,不进镜像(省掉约 380 MB,也不再分发它们)。构建期自证:`$FFMPEG_PATH` 必须有 `drawtext`、跑得通合成器的「变速 → xfade」滤镜链,随包二进制必须不在镜像里,任一条不满足就拒绝构建。要换成自己的 ffmpeg,在 compose 的 `environment` 里覆盖这两个变量即可。(v13.6 用的是把 `ffmpeg-static` 换成软链接的办法,那时代码不读变量。)不用随包版的原因:Linux 上随包的是 johnvansickle 静态版 7.0.2,它①不认「变速 `setpts` 之后接 `xfade`」(帧率被标成 1/0,退出码 234,任何一镜被调速整片合成就失败)、②没有 `drawtext`(封面标题 / 片尾卡 / AI 角标起不来)。macOS 上的 ffmpeg-static 是 6.0,两个问题本机都复现不了。
- **从源码装在 Linux 上**(`npm install`)时默认用的是 ffmpeg-static 7.0.2:合成不受影响(v13.6 起变速片段在 `setpts` 之后补 `fps=<成片帧率>`;v13.13 起成片帧率按格式条的 24 / 25 / 30),但没有 `drawtext`。装好系统 ffmpeg 后设 `FFMPEG_PATH=/usr/bin/ffmpeg` 和 `FFPROBE_PATH=/usr/bin/ffprobe`(写进 `.env.local` 或服务的环境变量),重启即可;不需要做软链接。

**ffmpeg 功能用途：**

| 功能 | 涉及文件 | 具体用途 |
|------|----------|----------|
| 视频合成成片 | `services/video-composer.ts` | 拼接镜头（concat demuxer）、xfade 转场、BGM 混音（`adelay`）、字幕烧录（`subtitles` filter）、SVG 合成（image2 demuxer + librsvg）、渐变/介绍片段合成 |
| 分辨率转码 | `lib/video-transcode.ts` + `services/video-export-service.ts` | export 路由 720p/1080p/2160p 转码，缓存到 `data/exports/` |
| 末帧抽取 | `lib/last-frame-extractor.ts` | ffprobe 拿 duration + seek 到末帧抽 JPEG（用于镜头质量评分） |
| 帧亮度分析 | `lib/last-frame-extractor.ts` | `signalstats` filter 读 YAVG/YDEV 做画质 QC |
| 静音检测/节奏 | `lib/beat-detect.ts` | `silencedetect` filter 从 BGM 提取节拍点 |
| 静音片段生成 | `lib/audio-silence.ts` | `anullsrc` 生成零信号 MP3（TTS 前后补白） |
| GIF 导出 | `lib/gif-pipeline.ts` + 调用方 | `palettegen` + `paletteuse` 两遍制作高质量 GIF |
| 本地 2D 口型渲染 | `lib/lipsync-providers/local-2d.ts` | overlay 口型贴图（8 张 PNG）按 viseme 轨时间窗切换 + 混配音音频 → 示意成片 |
| mock 视频生成 | `lib/mock-clip.ts`(`/api/mock-assets` 路由与单镜重生共用) | `lavfi` 纯色短片 + 正弦音轨（MOCK_ENGINES=1 时 demo 用） |
| 视频 probe | `services/video-composer.ts` | `ffprobe` 获取视频时长 |
| 成片体检 / 画幅守门 / 角色锚抽帧 | `lib/film-health.ts`、`lib/image-aspect-guard.ts`、`lib/video-anchor.ts` | `ffprobe` 全维探测、宽高比校验后 `ffmpeg` 裁切、均匀抽关键帧(v13.8 前按名字调,只认 PATH) |

## 8. data/ 目录布局

所有路径相对 `process.cwd()`（即项目根）。

```
data/
├── qfmj.db          # SQLite 主库（DB_DRIVER=sqlite 时）
├── qfmj.db-shm      # SQLite WAL shared memory
├── qfmj.db-wal      # SQLite WAL 日志
├── storage/
│   └── assets/      # storagePut() 写入的媒体产物（图像/音频/视频）
│                    # key = sha256(content)[0:32]，文件名 = key + ext
│                    # URL = /api/serve-file?key=<key>
│                    # S3 driver 时同时存本地副本（ffmpeg 消费需要）
├── composed/        # video-composer.ts 合成成片落盘（持久化）
│                    # 文件名 = final-<timestamp>.mp4（完整合成）
│                    #        / concat-<timestamp>.mp4（完整合成失败后的全硬切兜底）
│                    # v13.6 起合成失败不再留下 0 字节的 final-*.mp4
└── exports/         # 转码缓存（video-transcode.ts）
                     # 文件名 = <basename>-<resolution>.mp4
legacy-aspect-repaired.json  # v13.3 旧项目画幅改正的账本(见 5.1;只有改过才会出现)
```

**临时目录（不在 data/）：**

| 用途 | 路径 | 来源 |
|------|------|------|
| lipsync 本地渲染临时帧 | `os.tmpdir()/lipsync-XXXXXX/` | `lib/lipsync-providers/local-2d.ts:98` |
| mock clip 缓存 | `os.tmpdir()/qfmj-mock-assets/` | `app/api/mock-assets/[...path]/route.ts:89` |
| storage 原子写临时文件 | `<absPath>.part-<pid>` | `lib/storage.ts:57-59` |
| video-composer 中间帧/concat list | `os.tmpdir()` 子目录 | `services/video-composer.ts:398-400` |
| storage 工具用 | `os.tmpdir()/qfmj-storage-tmp/` | `lib/storage.ts:215` |

**Docker `VOLUME ['/app/data']`：** 整个 `data/` 被声明为 volume，挂载时覆盖镜像内初始 `data/`。容器以 `nextjs`（uid/gid 1001）运行，**绑定挂载的宿主目录必须对 1001 可写**，否则 SQLite 建不了库、登录不了（v13.11 起登录页提示「服务端数据库打不开」并给出修法，之前是 500；见「Docker 与 NAS 自托管」）。

## 9. 端口

| 场景 | 端口 | 来源 |
|------|------|------|
| 本地开发 `next dev` | 3000（Next.js 默认） | `lib/mock-providers.ts:25`：`process.env.PORT \|\| 3000` |
| Docker 生产容器 | 3100（`PORT=3100 HOSTNAME=0.0.0.0`） | `Dockerfile:36`、`EXPOSE 3100` |
| 本地 PostgreSQL（docker-compose） | 5434（宿主机）→ 5432（容器） | `docker-compose.pg.yml` |

## 10. 子进程脚本

**运行时调用的子进程脚本（生产路径）：**

| 脚本 | 调用方 | 触发方式 | 用途 |
|------|--------|----------|------|
| `scripts/llm-call.mjs` | `services/hybrid-orchestrator.ts:791-808` | `execFile('node', [scriptPath], ...)` stdin JSON → stdout JSON | 绕过 Turbopack 对长 fetch 的阻塞，独立 Node 进程调 LLM `/chat/completions`；支持主 LLM → MiniMax 兜底链 |
| ffmpeg 二进制（不在 scripts/） | `services/video-composer.ts`、`lib/audio-silence.ts`、`lib/beat-detect.ts`、`lib/last-frame-extractor.ts`、`lib/editor-score.ts`、`lib/lipsync-providers/local-2d.ts`、`app/api/mock-assets/` | fluent-ffmpeg / execFile | 见第 7 节 |

**非生产脚本（仅 CI/工具）：** `scripts/capture-*.mjs`、`scripts/gen-*.ts`、`scripts/pg-*.ts`、`scripts/video-probe.mjs`、`scripts/ws-server.mjs`（e2e 测试用 WebSocket 服务）、`scripts/release.sh`。

**`ws-server.mjs` 注意：** e2e 测试时通过 `QFMJ_DB_PATH` 环境变量与测试进程共享同一 SQLite 文件（`lib/db.ts:30`）；生产不需要启动此脚本。

## 11. 健康检查端点与启动顺序

**健康检查端点：**

| 端点 | 方法 | 用途 | 关键行为 |
|------|------|------|----------|
| `GET /api/runtime/readiness` | GET | 媒体引擎就绪度（演示模式判断） | 读各 provider 的 `available()`（仅检查 env key，不打网络）；返回 `{ engines, demoMode, level, stages, mockEngines }`；无缓存，每次实时计算 |
| `GET /api/health/providers` | GET | 各 LLM/TTS/网关真实连通性探测 | 打网络（10 s 超时），60 s 缓存；探测 primary-llm、creative-llm、minimax-llm-fallback、minimax-tts、qingyuntop 网关、vectorengine 网关；`?fresh=1` 强制刷新；不回传 key |
| `GET /api/health` | GET | **Docker HEALTHCHECK 探测目标（v13.6 起）** | 数据库 `SELECT 1` + SQLite 数据目录/库文件可写 + 用 `JWT_SECRET` 签一枚不外发的令牌；全过 200，否则 503 + 原因代码（`db_unavailable` / `db_unreachable` / `db_not_writable` / `jwt_secret_missing` / `jwt_secret_weak`，与登录 503 的 `reason` 同一套）；不打外网、不缓存。`HEALTHCHECK CMD wget -qO- http://localhost:3100/api/health`，60 s start-period，30 s 间隔，5 s 超时，3 次重试 |
| `GET /`（首页） | GET | v13.6 之前的 HEALTHCHECK 目标 | 静态壳，不碰数据库也不签令牌 —— 数据目录属主不对、没设 JWT_SECRET 时照样 200，所以换掉了 |

**启动顺序注意事项：**

1. **instrumentation 在第一个请求处理前完成**（Next.js 保证），但 `initSentry()`、`loadModelOverridesIntoEnv()` 是异步的，若 DB 尚未初始化（第一次建库），`loadModelOverridesIntoEnv` 静默忽略（`lib/model-overrides.ts:58`）。

2. **SQLite schema 自动迁移**：`lib/db.ts` 在 import 时同步执行所有 `CREATE TABLE IF NOT EXISTS` 和 `addColumnIfMissing`（`better-sqlite3` 同步 API）。首次启动时 schema 建立是在第一个 API 路由 import `db` 时发生，不是在 instrumentation 阶段。

3. **PG 驱动懒加载**：`PgDriver.pool()` 在第一次查询时才建连接池，失败给清晰错误（`lib/db-driver.ts:96-115`）。部署时需确保 `DATABASE_URL` 正确且 PG 可达，否则第一个 DB 操作才暴露错误。

4. **Pipeline worker 只在 `PIPELINE_QUEUE=1` 时开机即启**（instrumentation）；未设则延迟到首个 `create-stream` 请求时懒启动。kill -9 重启后，开机恢复（running→queued）**要求 worker 在首个 tick 前就运行**，所以生产建议设 `PIPELINE_QUEUE=1`。

5. **Redis 桥懒启动**：`ensureRedisBridge()` 在首次 `busEmit` 或 `subscribe` 时触发，不是开机时主动连接。若需确保多副本事件互通在第一个请求前就绪，目前代码没有预热机制。


## 12. 会话 Cookie 与 HTTPS

登录后服务端下发 httpOnly 会话 cookie `qfmj-session`。前端的创作(`/api/create-stream`)、项目列表、用量预算等多数请求**只靠这枚 cookie 鉴权**(不带 `Authorization` 头)。浏览器在**非 HTTPS 来源**会丢弃带 `Secure` 属性的 cookie(`localhost` 例外,所以本机测试永远正常),因此 `Secure` 必须与实际访问方式一致。v13.5 起由 `COOKIE_SECURE` 控制:

| 值 | 行为 | 适用 |
|---|---|---|
| `auto`(默认,不设即此) | 请求是 HTTPS 才加 `Secure`。判定:URL 协议、反代转发的 `X-Forwarded-Proto` / `Forwarded: proto=`、浏览器发来的 `Origin` / `Referer`,**任一**为 https 即算 | 绝大多数部署。同一实例既能 `http://局域网IP:3100` 直连,也能经 HTTPS 反代访问 |
| `true` | 恒加 `Secure` | 只走 HTTPS 的公网部署,想把它钉死、不依赖判定 |
| `false` | 恒不加 | 明确只在内网 HTTP 使用 |

- **局域网 HTTP 直连**(NAS 常见):保持默认 `auto`,不需要反代。纯 HTTP 下会话令牌在网络上明文传输,只应在可信内网这样用;从公网访问请走 HTTPS。
- **HTTPS 反代**:Caddy、Traefik 默认会转发 `X-Forwarded-Proto`;nginx 需要 `proxy_set_header X-Forwarded-Proto $scheme;`。漏配时,浏览器请求里的 `Origin` / `Referer` 仍会让 cookie 带上 `Secure`;要彻底不依赖判定就设 `COOKIE_SECURE=true`。
- **能登录、但点「开机」报「创作需要登录」**:典型是设了 `COOKIE_SECURE=true` 却用 HTTP 打开,cookie 被浏览器丢弃。服务端日志会打一次 `[auth] COOKIE_SECURE=true,但收到的是 HTTP 请求`。改回 `auto`,或改用 HTTPS 访问。
- **从 v13.5 之前的版本升级**:之前在 HTTP 下登录过的用户不必重新登录 —— 刷新页面时 `/api/auth/me` 会按当前规则补发会话 cookie(判不出协议时不补发,重新登录一次即可)。

---

# 环境变量矩阵

> 密钥永远只放 `.env.local` / 部署平台的 secret 管理 —— 不入库、不进镜像、不打日志。
> 模型 ID 类变量可被「模型雷达」(`model_overrides` 表)运行时覆盖,DB 覆盖值优先于 env。

## 模块一：LLM（Script / Director / Polish）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `OPENAI_API_KEY` | **必填** | — | 通用 LLM 主密钥（任意 OpenAI 兼容端点均可，如 vectorengine、openrouter） |
| `OPENAI_BASE_URL` | 可选 | `https://api.openai.com/v1` | 通用 LLM 的 base URL，指向代理网关时覆盖 |
| `OPENAI_MODEL` | 可选 | `claude-sonnet-4-6` | 通用 LLM 模型 ID（规划/校验/质检等高频轻量任务）；可被 `model_overrides` 表覆盖 |
| `OPENAI_CREATIVE_MODEL` | 可选 | `deepseek-v4-pro` | 编剧/导演创意主 LLM 模型 ID（质量优先环节）；可被 `model_overrides` 表覆盖 |
| `OPENAI_CREATIVE_FAST_MODEL` | 可选 | `deepseek-v4-flash` | 创意「快档」LLM，用于草稿对比/润色 basic 等秒级响应场景；可被 `model_overrides` 表覆盖 |
| `OPENAI_MAX_TOKENS` | 可选 | SDK 默认 | 覆盖单次最大输出 token 数（`services/hybrid-orchestrator.ts`） |
| `CREATIVE_BASE_URL` | 可选 | `DEEPSEEK_BASE_URL` → `OPENAI_BASE_URL` → `https://api.openai.com/v1` | 创意 LLM 的端点 URL，三级回退链 |
| `CREATIVE_API_KEY` | 可选 | `DEEPSEEK_API_KEY` → `OPENAI_API_KEY` | 创意 LLM 密钥，三级回退链 |
| `DEEPSEEK_BASE_URL` | 可选 | 见上回退链 | DeepSeek 专用端点（与 CREATIVE_BASE_URL 同链） |
| `DEEPSEEK_API_KEY` | 可选 | 见上回退链 | DeepSeek 专用密钥（与 CREATIVE_API_KEY 同链） |
| `LLM_FALLBACK_BASE_URL` | 可选 | `https://api.minimaxi.com/v1` | 全局 LLM 兜底端点（主 LLM 异常/欠费时路由到此） |
| `LLM_FALLBACK_API_KEY` | 可选 | `MINIMAX_API_KEY` | 全局 LLM 兜底密钥 |
| `LLM_FALLBACK_MODEL` | 可选 | `MiniMax-M2.7` | 全局 LLM 兜底模型 ID；可被 `model_overrides` 表覆盖 |

**回退链说明（lib/config.ts）**
```
creativeBaseURL = CREATIVE_BASE_URL || DEEPSEEK_BASE_URL || OPENAI_BASE_URL || 'https://api.openai.com/v1'
creativeApiKey  = CREATIVE_API_KEY  || DEEPSEEK_API_KEY  || OPENAI_API_KEY
fallbackApiKey  = LLM_FALLBACK_API_KEY || MINIMAX_API_KEY
```

**model_overrides 表优先级**：`lib/model-overrides.ts` 在启动时（`instrumentation.ts` 调 `loadModelOverridesIntoEnv()`）将数据库中的覆盖记录回写进 `process.env`。DB 覆盖值优先于 `.env` 默认；`config.ts` 中所有模型字段均为 getter，每次读取时实时从 `process.env` 取值，修改后无需重启即生效。可覆盖的键名包括：`OPENAI_MODEL`、`OPENAI_CREATIVE_MODEL`、`OPENAI_CREATIVE_FAST_MODEL`、`LLM_FALLBACK_MODEL`、`VEO_MODEL`、`OPENAI_CREATIVE_MODEL`、`LLM_FALLBACK_MODEL` 等。

## 模块二：图像生成

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `MJ_API_KEY` | 可选 | — | Midjourney 图像生成密钥（通过聚合网关 `/mj/submit/imagine` 接口） |
| `MJ_BASE_URL` | 可选 | `https://api.vectorengine.ai` | Midjourney 聚合网关地址（services/midjourney.service.ts） |
| `VECTORENGINE_API_KEY` | 可选 | — | vectorengine.ai 统一网关密钥（图像+TTS 双用） |
| `VECTORENGINE_BASE_URL` | 可选 | `https://api.vectorengine.ai` | vectorengine 网关端点 |
| `IMAGE_MODEL` | 可选 | `flux.1-kontext-pro` | qingyuntop/flux 图像生成默认模型（lib/image-providers/builtins.ts） |
| `FAL_KEY` | 可选 | — | fal.ai 密钥，用于 FLUX Kontext 参考图一致性生成 |
| `COMFYUI_URL` | 可选 | `http://localhost:8188` | 本地 ComfyUI 实例地址 |
| `COMFYUI_ENABLED` | 可选 | `false` | `true` 启用 ComfyUI 作为本地图像引擎 |
| `ENABLE_REPLICATE` | 可选 | — | `1` 启用 Replicate 图像提供商插件 |
| `REPLICATE_API_TOKEN` | 可选 | — | Replicate API 令牌（需同时设 `ENABLE_REPLICATE=1`） |
| `JIMENG_AK` | 可选 | — | 即梦（字节跳动）图像生成 Access Key |
| `JIMENG_SK` | 可选 | — | 即梦图像生成 Secret Key |
| `JIMENG_REGION` | 可选 | `cn-north-1` | 即梦服务区域 |
| `JIMENG_SERVICE` | 可选 | `cv` | 即梦服务名称 |
| `BANANA_API_KEY` | 可选 | — | MJ 聚合网关旧版别名（向后兼容，脚本中读取） |
| `IMAGE_PROVIDERS_DIR` | 可选 | — | 自定义图像提供商插件目录路径（热加载 .ts/.js 文件） |

## 模块三：视频生成

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `MINIMAX_API_KEY` | 可选* | — | MiniMax（海螺）视频/TTS 密钥；也被 LLM 兜底链引用 |
| `MINIMAX_BASE_URL` | 可选 | `https://api.minimaxi.com` | MiniMax API 端点 |
| `MINIMAX_GROUP_ID` | 可选 | — | MiniMax 账户 Group ID（TTS v2a_v2 接口必需） |
| `MINIMAX_VIDEO_MODEL` | 可选 | `MiniMax-Hailuo-2.3` | MiniMax 标准视频模型 ID |
| `MINIMAX_FAST_VIDEO_MODEL` | 可选 | `MiniMax-Hailuo-2.3-Fast` | MiniMax 快速/低成本视频兜底模型 ID |
| `VIDU_API_KEY` | 可选 | — | Vidu 视频生成密钥 |
| `VIDU_BASE_URL` | 可选 | `https://api.vidu.com` | Vidu API 端点 |
| `KELING_API_KEY` | 可选 | — | 可灵（快手）视频生成密钥；也被 vectorengine-tts 引用 |
| `KELING_BASE_URL` | 可选 | `https://api.klingai.com` | 可灵 API 端点 |
| `KELING_4K_MODEL` | 可选 | `kling-v1-6` | 可灵 4K 视频模型名称 |
| `VEO_API_KEY` | 可选 | — | Veo/Sora 视频生成密钥（通过 qingyuntop 网关）；也被图像路由引用 |
| `VEO_BASE_URL` | 可选 | `https://api.qingyuntop.top` | Veo/Sora 网关地址 |
| `VEO_MODEL` | 可选 | `veo3.1-pro` | 主视频模型 ID；可被 `model_overrides` 表覆盖 |
| `VEO_API_FORMAT` | 可选 | `unified` | API 调用格式：`unified`（/v1/video/create）或 `openai`（/v1/videos） |
| `VEO_FALLBACK_MODELS` | 可选 | `veo3.1` | 主模型失败时的降级模型列表（逗号分隔）。v12.333 更正文档：此前写作 `veo3.1,sora-2-pro`，而 Sora-2 API 已于 2026-09-24 停服、v12.173 起就从代码默认值里摘掉了 |
| `QINGYUNTOP_API_KEY` | 可选 | `VEO_API_KEY` | qingyuntop 聚合网关统一密钥（可被视频+图像服务共用） |
| `QINGYUNTOP_BASE_URL` | 可选 | `https://api.qingyuntop.top` | qingyuntop 网关端点 |
| `ENABLE_RUNWAY` | 可选 | — | `1` 启用 Runway 视频提供商插件 |
| `RUNWAY_API_KEY` | 可选 | — | Runway ML 视频生成密钥（需同时设 `ENABLE_RUNWAY=1`） |
| `RUNWAY_BASE_URL` | 可选 | `https://api.runwayml.com` | Runway API 端点 |
| `VIDEO_PROVIDERS_DIR` | 可选 | — | 自定义视频提供商插件目录路径 |
| `HAPPYHORSE_API_KEY` | 可选 | `VECTORENGINE_API_KEY` | HappyHorse（阿里 通义/百炼）密钥。**填了它就必须同时填 `HAPPYHORSE_BASE_URL`** —— 见下方「两条通道」 |
| `HAPPYHORSE_BASE_URL` | 可选 | `VECTORENGINE_BASE_URL` → `https://api.vectorengine.ai` | 百炼直连填 `https://dashscope.aliyuncs.com`；留空则走网关 |
| `HAPPYHORSE_MODEL` | 可选 | 按有无首帧自动选 `happyhorse-1.1-i2v` / `-t2v` | 模型名覆盖 |
| `HAPPYHORSE_RESOLUTION` | 可选 | 上游默认 | `480P` / `720P` / `1080P`；非法值忽略 |
| `HAPPYHORSE_WATERMARK` | 可选 | `false`（本项目主动关） | 上游默认 **true** 会打「Happy Horse」水印；设 `1`/`true` 才保留 |
| `HAPPYHORSE_SEED` | 可选 | — | 固定随机种子（0~2147483647），用于复现同一镜 |
| `HAPPYHORSE_DISABLE` | 可选 | — | `1` 彻底停用该引擎（即使 key 可用） |

*`MINIMAX_API_KEY` 在最小可跑集中作为 LLM 兜底也被引用。
`MINIMAX_BASE_URL` **不要带 `/v1`**：代码里每个调用点自己拼 `/v1/xxx`，带了会变成 `/v1/v1/...` 全线 404
（v12.333 起会自动剪掉，但仍以不带为准）。

### HappyHorse 的两条通道（v12.333）

这是全项目唯一「key 与 host 可能来自两家」的引擎，且**路径前缀随 host 变**，所以单独说明：

| 通道 | 怎么配 | 实际请求 |
|---|---|---|
| `direct`（阿里云百炼直连） | `HAPPYHORSE_API_KEY` + `HAPPYHORSE_BASE_URL=https://dashscope.aliyuncs.com` | `{base}/api/v1/...`（百炼原生，**无前缀**） |
| `gateway`（经 VectorEngine 等网关） | 不填任何 `HAPPYHORSE_*`，自动复用 `VECTORENGINE_API_KEY` / `VECTORENGINE_BASE_URL` | `{base}/alibailian/api/v1/...` |

- **最常见的误配**：只填 `HAPPYHORSE_API_KEY`、不填 `HAPPYHORSE_BASE_URL`。host 会静默继承网关，
  于是百炼的 key 去敲网关的门 —— 必然 401/404，而报错指不到「通道配错了」。服务启动时会
  `console.warn` 提醒，行为保持与 v12.332 一致（不偷偷改你的请求目标）。
- **通道由 host 推出，不由「key 放在哪个变量」推出**：否则同一个 host 换个变量名就会走到不存在的路径上。
- **网关通道的代价**：与网关上所有人共享上游配额，饱和时返回 429 `quota_not_enough`
  （文案写「负载已饱和」但代码是额度问题，干等无效 —— 需网关侧补额度或换直连）。
- **验证方式（不触发任何计费生成）**：`npm run audit:api`，看 HappyHorse 那行打印的「通道 …」。
  探针只 GET 一个不存在的 task id：404 = 鉴权与路径都对了。

## 模块四：TTS（文字转语音）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `MINIMAX_TTS_MODEL` | 可选 | `speech-02-hd` | MiniMax TTS 模型 ID（services/tts.service.ts） |
| `VE_TTS_MODEL` | 可选 | `gpt-4o-mini-tts` | vectorengine TTS 模型 ID（lib/tts-providers/vectorengine-tts.ts） |
| `ENABLE_ELEVENLABS` | 可选 | — | `1` 启用 ElevenLabs TTS 提供商插件 |
| `ELEVENLABS_API_KEY` | 可选 | — | ElevenLabs 配音密钥（需同时设 `ENABLE_ELEVENLABS=1`） |
| `ELEVENLABS_BASE_URL` | 可选 | `https://api.elevenlabs.io` | ElevenLabs API 端点 |
| `TTS_PROVIDERS_DIR` | 可选 | — | 自定义 TTS 提供商插件目录路径 |

## 模块五：口型同步（Lip Sync）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `LIPSYNC_API_URL` | 可选 | — | 自托管口型服务地址（wav2lip/SadTalker/MuseTalk，配了才启用） |
| `LIPSYNC_API_KEY` | 可选 | — | 口型服务 Bearer 鉴权 key（可选） |
| `LIPSYNC_FFMPEG_PATH` | 可选(旧名) | — | 兼容旧配置:v13.8 起等同 `FFMPEG_PATH`、对所有 ffmpeg 调用生效,两个都设时 `FFMPEG_PATH` 优先(见 [§7](#7-ffmpeg-用途清单)) |
| `LIPSYNC_LOCAL_DISABLE` | 可选 | — | 任意非空值禁用本地 2D 口型引擎 |
| `LIPSYNC_PROVIDER` | 可选 | `auto` | 强制指定口型提供商（`wav2lip-http`/`minimax-lipsync`/`syncso`/`auto`） |
| `LIPSYNC_DISABLED` | 可选 | — | `1` 全局禁用口型同步服务（services/lipsync.service.ts） |
| `SYNCSO_API_KEY` | 可选 | — | Sync.so 云端口型服务密钥 |
| `SYNCSO_BASE_URL` | 可选 | `https://api.sync.so` | Sync.so API 端点 |
| `MINIMAX_LIPSYNC_MODEL` | 可选 | `lipsync-01` | MiniMax 口型同步模型 ID |

## 模块六：存储（Storage）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `STORAGE_DRIVER` | 可选 | `local` | 存储后端：`local`（本地磁盘，零配置）或 `s3`（S3 兼容对象存储） |
| `S3_ENDPOINT` | 条件必填 | — | S3 兼容端点 URL（`STORAGE_DRIVER=s3` 时必填，支持 MinIO/R2） |
| `S3_BUCKET` | 条件必填 | — | S3 bucket 名称 |
| `S3_ACCESS_KEY_ID` | 条件必填 | — | S3 Access Key ID（SigV4 签名用） |
| `S3_SECRET_ACCESS_KEY` | 条件必填 | — | S3 Secret Access Key |
| `S3_REGION` | 可选 | `us-east-1` | S3 区域（MinIO 填 `us-east-1` 即可） |
| `S3_PUBLIC_BASE_URL` | 可选 | — | S3 对象的公网访问前缀（CDN 域名），未设则拼 endpoint+bucket |

## 模块七：数据库（DB）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `DB_DRIVER` | 可选 | `sqlite` | 数据库驱动：`sqlite`（本地 better-sqlite3）或 `pg`/`postgres`（PostgreSQL 连接池） |
| `DATABASE_URL` | 条件必填 | — | PostgreSQL 连接字符串（`DB_DRIVER=pg` 时必填，否则运行时硬报错） |
| `QFMJ_DB_PATH` | 测试内部 | — | 测试/子进程复用指定 SQLite 文件路径（生产不用设置） |
| `LEGACY_ASPECT_REPAIR` | 可选 | 开 | 设为 `off` 关闭启动时的旧项目画幅改正(见第 5.1 节) |

## 模块八：队列与事件总线

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `PIPELINE_QUEUE` | 可选 | — | `1` 启用后台流水线队列 worker（app/api/create-stream、voice-retake 路由在此开关下入队而非即时执行） |
| `REDIS_URL` | 可选 | — | Redis 连接 URL（`redis://` 或 `rediss://`）；配置后 event-bus 自动桥接 Redis pub/sub 实现多实例事件互通；不配则降级为进程内 EventEmitter |
| `PLUGIN_CHAIN_MODE` | 可选 | `off` | Plugin chain 路由模式：`off`（禁用）/ `shadow`（异步影子，不影响主路径）/ `primary`（先试 plugin chain，失败才落旧路径）；MOCK_ENGINES=1 时隐含 `primary` |
| `PLUGIN_CHAIN_SHADOW_RATE` | 可选 | `0.05` | shadow 模式采样比例（0.0~1.0），控制实际调用 API 的频率 |
| `YJS_WS_URL` | 可选 | `ws://localhost:1234` | Yjs 协同编辑 WebSocket 服务器地址（lib/yjs-broadcast.ts） |

## 模块九：支付（Stripe）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | 条件必填 | — | Stripe 后端密钥（`sk_test_` 或 `sk_live_`）；未设时调用支付接口抛 `StripeNotConfiguredError` |
| `STRIPE_WEBHOOK_SECRET` | 条件必填 | — | Stripe Webhook 签名密钥（`whsec_xxx`），用于验证 webhook 事件来源 |
| `STRIPE_PRICE_ID_CREATOR` | 条件必填 | — | 创作版订阅 Stripe Price ID（`price_xxx`） |
| `STRIPE_PRICE_ID_PRO` | 条件必填 | — | 专业版订阅 Stripe Price ID |
| `STRIPE_PRICE_ID_ENTERPRISE` | 条件必填 | — | 企业版订阅 Stripe Price ID |
| `NEXT_PUBLIC_STRIPE_PORTAL_LINK` | 条件必填 | — | Stripe Customer Portal 链接（前端 billing 页打开订阅管理用） |

## 模块十：遥测（Telemetry）

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `SENTRY_DSN` | 可选 | — | Sentry 错误追踪 DSN（未设则静默降级为 console，不抛错） |
| `SENTRY_TRACES_SAMPLE_RATE` | 可选 | `0.1` | Sentry 性能追踪采样率（0.0~1.0） |
| `NEXT_PUBLIC_APP_VERSION` | 可选 | — | 应用版本号，作为 Sentry release 标识注入 |

## 模块十一：安全与认证

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `JWT_SECRET` | **生产必填（fail-fast）** | `qingfeng-manju-secret`（仅 dev） | JWT 签名密钥；`NODE_ENV=production` 时未设置直接抛错，源码内置兜底值是公开的（app/api/auth/lib.ts） |
| `API_KEYS` | 可选 | — | 公开 REST API（/api/v1/*）访问密钥列表（逗号分隔）；空串等同于「禁用公开 API」，返回 503 |
| `BETA_INVITE_REQUIRED` | 可选 | `true` | `false`/`0`/`off` 关闭 Beta 邀请码门禁（开发环境方便注册） |
| `COOKIE_SECURE` | 可选 | `auto` | 会话 cookie 的 `Secure` 属性：`auto` 按请求是否 HTTPS 决定（局域网 `http://IP:端口` 直连可用），`true` 恒加，`false` 恒不加；见 [§12](#12-会话-cookie-与-https) |

## 模块十二：邮件

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `EMAIL_PROVIDER` | 可选 | `resend` | 邮件服务商：`resend` 或 `sendgrid` |
| `EMAIL_FROM` | 可选 | `Wind Comic <noreply@windcomic.app>` | 发件人地址 |
| `EMAIL_DISABLED` | 可选 | — | `1` 全局禁用邮件发送 |
| `RESEND_API_KEY` | 条件必填 | — | Resend 发送密钥（`EMAIL_PROVIDER=resend` 时需要） |
| `SENDGRID_API_KEY` | 条件必填 | — | SendGrid 发送密钥（`EMAIL_PROVIDER=sendgrid` 时需要） |

## 模块十三：运行时 / 杂项

| 变量名 | 必填/可选 | 默认值 | 一句话作用 |
|---|---|---|---|
| `NODE_ENV` | 框架注入 | `development` | Next.js 运行环境；`production` 时触发 JWT fail-fast、style 告警禁用等（会话 cookie 的 `Secure` 不再看它，见 `COOKIE_SECURE`） |
| `PORT` | 可选 | `3000` | 应用监听端口（mock provider 内部拼 URL 时引用） |
| `APP_URL` | 可选 | — | 应用外部访问 URL（mock provider 回调地址，优先于 PORT 拼接） |
| `NEXT_PUBLIC_APP_URL` | 可选 | `http://localhost:3000` | Stripe Checkout success/cancel 回调域名；前端可见 |
| `NEXT_PUBLIC_APP_HOST` | 可选 | `http://localhost:3000` | 邮件通知中的点击链接域名（lib/email-sender.ts） |
| `MOCK_ENGINES` | 可选 | — | `1` 全局使用 mock 引擎（不调真实 API，本地开发/CI 用）；自动隐含 `PLUGIN_CHAIN_MODE=primary` |
| `DEMO_ADMIN` | 可选 | — | `1` 将 demo seed 用户设为 admin 角色（本地调试用） |
| `CJK_FONT_FILE` | 可选 | 系统字体候选列表 | 字幕烧录用 CJK 字体文件绝对路径，优先于系统字体扫描 |
| `FFMPEG_PATH` | 可选 | 随包 ffmpeg-static → 系统 ffmpeg | 指定所有合成/转码/抽帧用的 ffmpeg(路径或 PATH 上的命令名);官方镜像设为 `/usr/bin/ffmpeg`(见 [§7](#7-ffmpeg-用途清单)) |
| `FFPROBE_PATH` | 可选 | 随包 ffprobe-static → 系统 ffprobe | 指定 ffprobe;与 `FFMPEG_PATH` 各管各的;官方镜像设为 `/usr/bin/ffprobe` |
| `VITEST` | 测试内部 | — | vitest 注入标志，禁用限流等生产行为 |
| `NEXT_PUBLIC_SENTRY_DSN` | 备注 | — | .env.example 中出现但代码中实际读取的是 `SENTRY_DSN`（注意前缀差异） |

## 最小可跑集（本地 dev 可启动）

以下变量配置后即可在本地启动完整 dev 服务（SQLite 数据库，mock 引擎，无支付/邮件）：

```bash
# .env.local 最小集
OPENAI_API_KEY=your_openai_or_proxy_key   # LLM 脚本生成
MINIMAX_API_KEY=your_minimax_key           # 视频 + TTS + LLM 兜底

# 可选：跳过邀请码门禁
BETA_INVITE_REQUIRED=false

# 可选：本地不调真实 API，全用 mock
MOCK_ENGINES=1
```

> JWT_SECRET 不设时，开发环境生成**进程级随机密钥**（重启即失效，需重新登录）；生产环境不设或用占位串，登录/注册返回 503 并提示「服务端没配置 JWT_SECRET」（v13.11 前是 500）。

## 生产必改集（部署前务必设置）

| 变量名 | 原因 |
|---|---|
| `JWT_SECRET` | `NODE_ENV=production` 下未设或用了公开占位串，签发/校验令牌时直接抛错 → 登录/注册 503「服务端没配置 JWT_SECRET」（v13.11 前是 500），`/api/health` 返回 503 |
| `DB_DRIVER=pg` + `DATABASE_URL` | 生产推荐 PostgreSQL，SQLite 不支持多实例并发写入 |
| `OPENAI_API_KEY` | LLM 必须能调通，否则脚本/导演/质检全挂 |
| `MINIMAX_API_KEY` | 视频生成 + TTS 主路径 + LLM 兜底，缺失则大量功能降级 |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_ID_*` | 启用订阅支付必填；不填则支付模块整体不可用（不影响免费功能） |
| `NEXT_PUBLIC_APP_URL` | Stripe Checkout 回调域名；错误会导致支付后无法跳回 |
| `REDIS_URL` | 多实例/水平扩展时事件总线跨实例互通必须配置；单实例可不配 |
| `SENTRY_DSN` | 生产错误追踪；不配则只打 console，错误无可观测性 |
| `RESEND_API_KEY` 或 `SENDGRID_API_KEY` | 用户邀请/通知邮件必须能发出 |
| `S3_*`（4 个）| `STORAGE_DRIVER=s3` 时必填，否则资产只存本地盘（多实例无法共享） |
| `JWT_SECRET`（重申）| 生产环境唯一 fail-fast 变量：服务照样能起、首页照样 200，但登录/注册 503、其余认证接口一律 401（校验不了任何令牌） |

## 矩阵盘点备注

1. JWT_SECRET 是全仓唯一 fail-fast 变量：app/api/auth/lib.ts 的 getJwtSecret() 在 NODE_ENV=production 且变量缺失或命中占位串黑名单时直接 throw（v13.11 起抛带原因的 JwtSecretError），登录/注册据此返回 503 + 原因，其余认证接口校验不了令牌一律 401（服务本身照样能起、首页照样 200）。历史上的源码内置兜底串已在 v12.219 删除，开发环境改为进程级随机密钥。

2. .env.example 写的是 NEXT_PUBLIC_SENTRY_DSN，但 lib/telemetry.ts 实际读取的是 SENTRY_DSN（无 NEXT_PUBLIC_ 前缀）。两者均出现在代码中但作用不同，部署时应设 SENTRY_DSN（服务端）。

3. DB_DRIVER 默认值在 lib/db-driver.ts 写死为 'sqlite'，但 v9.0.5 任务备注已将「推荐默认」切换为 pg；SQLite 驱动不支持跨进程并发写入，生产多实例部署必须用 pg。

4. model_overrides 表（DB）的覆盖优先级高于 .env 文件：loadModelOverridesIntoEnv() 在 instrumentation.ts 启动时回写 process.env，因此即使 .env 中设了 OPENAI_MODEL，DB 表中有对应记录时也会被覆盖，调试时需注意。

5. QINGYUNTOP_API_KEY 和 VEO_API_KEY 在图像路由（lib/image-providers/builtins.ts）中存在三路回退：QINGYUNTOP_API_KEY → VEO_API_KEY → OPENAI_API_KEY，意味着仅设 OPENAI_API_KEY 也会被尝试作为图像生成密钥。

6. VECTORENGINE_API_KEY 和 KELING_API_KEY 互为别名（lib/tts-providers/vectorengine-tts.ts 和 lib/model-scan.ts 均做了 VECTORENGINE_API_KEY || KELING_API_KEY 回退），设任意一个都能启用 vectorengine-tts。

7. ENABLE_REPLICATE / ENABLE_ELEVENLABS / ENABLE_RUNWAY 三个插件开关必须与对应密钥同时设置（代码用 && 判断），单独设开关不生效。

8. PIPELINE_QUEUE=1 时队列 worker **就在 Next.js 进程里**随开机启动（instrumentation.ts），不需要另起进程；未设时延迟到首个 create-stream 请求才懒启动（见第 11 节第 4 条）。单机部署建议设上，容器重启后未完成的任务会自动续跑。

9. REDIS_URL 缺失时 event-bus 静默降级为进程内 EventEmitter，多实例部署下不同实例间的评论通知、流水线进度事件完全不互通，但应用不会报错，容易被忽视。

10. APP_URL（无 NEXT_PUBLIC_ 前缀）和 NEXT_PUBLIC_APP_URL 是两个不同变量：前者用于 mock provider 内部拼 URL，后者用于 Stripe 回调，生产部署时两者通常应该设成相同的域名值。
