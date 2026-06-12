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

**6. Docker HEALTHCHECK 探测首页而非专用 /api/health**
`Dockerfile:60` 的 `wget` 命中 `/`（首页），而非 `/api/runtime/readiness` 或 `/api/health/providers`。首页正常不等于 DB/LLM 就绪，建议生产改为探测 `/api/runtime/readiness`。start-period 仅 20 s，冷启动 + DB 首次建表可能超时。

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

**ffmpeg 进入方式：**
- 优先用 `ffmpeg-static`（npm 包，随项目安装，不需系统 PATH）
- 回退顺序：`LIPSYNC_FFMPEG_PATH` env → ffmpeg-static → `/opt/homebrew/bin/ffmpeg` → `/usr/local/bin/ffmpeg` → `/usr/bin/ffmpeg`（`lib/lipsync-providers/local-2d.ts:29-43`）
- `next.config.ts` 已把 `ffmpeg-static` 和 `fluent-ffmpeg` 设为 `serverExternalPackages`（不打包，保持二进制路径正确）
- Docker 镜像额外 `apk add ffmpeg`（系统二进制兜底）

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
| mock 视频生成 | `app/api/mock-assets/[...path]/route.ts` | `lavfi` 纯色短片 + 正弦音轨（MOCK_ENGINES=1 时 demo 用） |
| 视频 probe | `services/video-composer.ts` | `ffprobe` 获取视频时长 |

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
│                    # 文件名 = final-<timestamp>.mp4
└── exports/         # 转码缓存（video-transcode.ts）
                     # 文件名 = <basename>-<resolution>.mp4
```

**临时目录（不在 data/）：**

| 用途 | 路径 | 来源 |
|------|------|------|
| lipsync 本地渲染临时帧 | `os.tmpdir()/lipsync-XXXXXX/` | `lib/lipsync-providers/local-2d.ts:98` |
| mock clip 缓存 | `os.tmpdir()/qfmj-mock-assets/` | `app/api/mock-assets/[...path]/route.ts:89` |
| storage 原子写临时文件 | `<absPath>.part-<pid>` | `lib/storage.ts:57-59` |
| video-composer 中间帧/concat list | `os.tmpdir()` 子目录 | `services/video-composer.ts:398-400` |
| storage 工具用 | `os.tmpdir()/qfmj-storage-tmp/` | `lib/storage.ts:215` |

**Docker `VOLUME ['/app/data']`：** 整个 `data/` 被声明为 volume（`Dockerfile:52-53`），挂载时覆盖镜像内初始 `data/`。

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
| `scripts/xverse-call.mjs` | `services/xverse.service.ts:114-138` | `execFile('node', [scriptPath], ...)` stdin JSON → stdout | XVerse API 调用隔离（同款子进程策略） |
| ffmpeg 二进制（不在 scripts/） | `services/video-composer.ts`、`lib/audio-silence.ts`、`lib/beat-detect.ts`、`lib/last-frame-extractor.ts`、`lib/editor-score.ts`、`lib/lipsync-providers/local-2d.ts`、`app/api/mock-assets/` | fluent-ffmpeg / execFile | 见第 7 节 |

**非生产脚本（仅 CI/工具）：** `scripts/capture-*.mjs`、`scripts/gen-*.ts`、`scripts/pg-*.ts`、`scripts/video-probe.mjs`、`scripts/ws-server.mjs`（e2e 测试用 WebSocket 服务）、`scripts/release.sh`。

**`ws-server.mjs` 注意：** e2e 测试时通过 `QFMJ_DB_PATH` 环境变量与测试进程共享同一 SQLite 文件（`lib/db.ts:30`）；生产不需要启动此脚本。

## 11. 健康检查端点与启动顺序

**健康检查端点：**

| 端点 | 方法 | 用途 | 关键行为 |
|------|------|------|----------|
| `GET /api/runtime/readiness` | GET | 媒体引擎就绪度（演示模式判断） | 读各 provider 的 `available()`（仅检查 env key，不打网络）；返回 `{ engines, demoMode, level, stages, mockEngines }`；无缓存，每次实时计算 |
| `GET /api/health/providers` | GET | 各 LLM/TTS/网关真实连通性探测 | 打网络（10 s 超时），60 s 缓存；探测 primary-llm、creative-llm、minimax-llm-fallback、minimax-tts、qingyuntop 网关、vectorengine 网关；`?fresh=1` 强制刷新；不回传 key |
| `GET /`（首页） | GET | Docker HEALTHCHECK 实际探测目标 | `HEALTHCHECK CMD wget -qO- http://localhost:3100/`（`Dockerfile:60`），20 s start-period，30 s 间隔，5 s 超时，3 次重试 |

**启动顺序注意事项：**

1. **instrumentation 在第一个请求处理前完成**（Next.js 保证），但 `initSentry()`、`loadModelOverridesIntoEnv()` 是异步的，若 DB 尚未初始化（第一次建库），`loadModelOverridesIntoEnv` 静默忽略（`lib/model-overrides.ts:58`）。

2. **SQLite schema 自动迁移**：`lib/db.ts` 在 import 时同步执行所有 `CREATE TABLE IF NOT EXISTS` 和 `addColumnIfMissing`（`better-sqlite3` 同步 API）。首次启动时 schema 建立是在第一个 API 路由 import `db` 时发生，不是在 instrumentation 阶段。

3. **PG 驱动懒加载**：`PgDriver.pool()` 在第一次查询时才建连接池，失败给清晰错误（`lib/db-driver.ts:96-115`）。部署时需确保 `DATABASE_URL` 正确且 PG 可达，否则第一个 DB 操作才暴露错误。

4. **Pipeline worker 只在 `PIPELINE_QUEUE=1` 时开机即启**（instrumentation）；未设则延迟到首个 `create-stream` 请求时懒启动。kill -9 重启后，开机恢复（running→queued）**要求 worker 在首个 tick 前就运行**，所以生产建议设 `PIPELINE_QUEUE=1`。

5. **Redis 桥懒启动**：`ensureRedisBridge()` 在首次 `busEmit` 或 `subscribe` 时触发，不是开机时主动连接。若需确保多副本事件互通在第一个请求前就绪，目前代码没有预热机制。

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
| `XVERSE_API_KEY` | 可选 | — | XVERSE-Ent 开源 MoE 编剧模型密钥（自托管/私有部署） |
| `XVERSE_BASE_URL` | 可选 | `http://localhost:8000/v1` | XVERSE-Ent 服务地址（vLLM/sglang 部署端点） |
| `XVERSE_MODEL` | 可选 | `xverse/XVERSE-Ent-A5.7B` | XVERSE 主模型 ID（编剧/导演强创意环节） |
| `XVERSE_FAST_MODEL` | 可选 | `xverse/XVERSE-Ent-A4.2B` | XVERSE 快速模型 ID（规划/校验等高频小任务） |
| `XVERSE_ENABLED` | 可选 | `false` | `true` 强制启用 XVERSE 作为编剧/导演主用 LLM |
| `XVERSE_FALLBACK` | 可选 | `true` | `false` 禁止在主链路失败时降级到 XVERSE |
| `XVERSE_TEMPERATURE` | 可选 | `0.85` | XVERSE 采样温度 |
| `XVERSE_TOP_P` | 可选 | `0.9` | XVERSE Top-P 采样 |
| `XVERSE_MAX_TOKENS` | 可选 | `6144` | XVERSE 单次最大输出 token 数 |
| `XVERSE_TIMEOUT` | 可选 | `180000` | XVERSE 子进程超时（ms） |

**回退链说明（lib/config.ts）**
```
creativeBaseURL = CREATIVE_BASE_URL || DEEPSEEK_BASE_URL || OPENAI_BASE_URL || 'https://api.openai.com/v1'
creativeApiKey  = CREATIVE_API_KEY  || DEEPSEEK_API_KEY  || OPENAI_API_KEY
fallbackApiKey  = LLM_FALLBACK_API_KEY || MINIMAX_API_KEY
```

**model_overrides 表优先级**：`lib/model-overrides.ts` 在启动时（`instrumentation.ts` 调 `loadModelOverridesIntoEnv()`）将数据库中的覆盖记录回写进 `process.env`。DB 覆盖值优先于 `.env` 默认；`config.ts` 中所有模型字段均为 getter，每次读取时实时从 `process.env` 取值，修改后无需重启即生效。可覆盖的键名包括：`OPENAI_MODEL`、`OPENAI_CREATIVE_MODEL`、`OPENAI_CREATIVE_FAST_MODEL`、`LLM_FALLBACK_MODEL`、`VEO_MODEL`、`XVERSE_MODEL`、`XVERSE_FAST_MODEL` 等。

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
| `VIDU_BASE_URL` | 可选 | `https://api.vidu.ai` | Vidu API 端点 |
| `KELING_API_KEY` | 可选 | — | 可灵（快手）视频生成密钥；也被 vectorengine-tts 引用 |
| `KELING_BASE_URL` | 可选 | `https://api.klingai.com` | 可灵 API 端点 |
| `KELING_4K_MODEL` | 可选 | `kling-v1-6` | 可灵 4K 视频模型名称 |
| `VEO_API_KEY` | 可选 | — | Veo/Sora 视频生成密钥（通过 qingyuntop 网关）；也被图像路由引用 |
| `VEO_BASE_URL` | 可选 | `https://api.qingyuntop.top` | Veo/Sora 网关地址 |
| `VEO_MODEL` | 可选 | `veo3.1-pro` | 主视频模型 ID；可被 `model_overrides` 表覆盖 |
| `VEO_API_FORMAT` | 可选 | `unified` | API 调用格式：`unified`（/v1/video/create）或 `openai`（/v1/videos） |
| `VEO_FALLBACK_MODELS` | 可选 | `veo3.1,sora-2-pro` | 主模型失败时的降级模型列表（逗号分隔） |
| `QINGYUNTOP_API_KEY` | 可选 | `VEO_API_KEY` | qingyuntop 聚合网关统一密钥（可被视频+图像服务共用） |
| `QINGYUNTOP_BASE_URL` | 可选 | `https://api.qingyuntop.top` | qingyuntop 网关端点 |
| `ENABLE_RUNWAY` | 可选 | — | `1` 启用 Runway 视频提供商插件 |
| `RUNWAY_API_KEY` | 可选 | — | Runway ML 视频生成密钥（需同时设 `ENABLE_RUNWAY=1`） |
| `RUNWAY_BASE_URL` | 可选 | `https://api.runwayml.com` | Runway API 端点 |
| `VIDEO_PROVIDERS_DIR` | 可选 | — | 自定义视频提供商插件目录路径 |

*`MINIMAX_API_KEY` 在最小可跑集中作为 LLM 兜底也被引用。

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
| `LIPSYNC_FFMPEG_PATH` | 可选 | 系统 PATH | 指定本地 2D 口型引擎使用的 ffmpeg 可执行文件路径 |
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
| `NODE_ENV` | 框架注入 | `development` | Next.js 运行环境；`production` 时触发 JWT fail-fast、Secure Cookie、style 告警禁用等 |
| `PORT` | 可选 | `3000` | 应用监听端口（mock provider 内部拼 URL 时引用） |
| `APP_URL` | 可选 | — | 应用外部访问 URL（mock provider 回调地址，优先于 PORT 拼接） |
| `NEXT_PUBLIC_APP_URL` | 可选 | `http://localhost:3000` | Stripe Checkout success/cancel 回调域名；前端可见 |
| `NEXT_PUBLIC_APP_HOST` | 可选 | `http://localhost:3000` | 邮件通知中的点击链接域名（lib/email-sender.ts） |
| `MOCK_ENGINES` | 可选 | — | `1` 全局使用 mock 引擎（不调真实 API，本地开发/CI 用）；自动隐含 `PLUGIN_CHAIN_MODE=primary` |
| `DEMO_ADMIN` | 可选 | — | `1` 将 demo seed 用户设为 admin 角色（本地调试用） |
| `CJK_FONT_FILE` | 可选 | 系统字体候选列表 | 字幕烧录用 CJK 字体文件绝对路径，优先于系统字体扫描 |
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

> JWT_SECRET 不设时开发环境使用内置兜底值（公开已知），本地 dev 可接受；生产必须修改。

## 生产必改集（部署前务必设置）

| 变量名 | 原因 |
|---|---|
| `JWT_SECRET` | 源码内置兜底值是公开的，`NODE_ENV=production` 未设直接 fail-fast 抛错 |
| `DB_DRIVER=pg` + `DATABASE_URL` | 生产推荐 PostgreSQL，SQLite 不支持多实例并发写入 |
| `OPENAI_API_KEY` | LLM 必须能调通，否则脚本/导演/质检全挂 |
| `MINIMAX_API_KEY` | 视频生成 + TTS 主路径 + LLM 兜底，缺失则大量功能降级 |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_ID_*` | 启用订阅支付必填；不填则支付模块整体不可用（不影响免费功能） |
| `NEXT_PUBLIC_APP_URL` | Stripe Checkout 回调域名；错误会导致支付后无法跳回 |
| `REDIS_URL` | 多实例/水平扩展时事件总线跨实例互通必须配置；单实例可不配 |
| `SENTRY_DSN` | 生产错误追踪；不配则只打 console，错误无可观测性 |
| `RESEND_API_KEY` 或 `SENDGRID_API_KEY` | 用户邀请/通知邮件必须能发出 |
| `S3_*`（4 个）| `STORAGE_DRIVER=s3` 时必填，否则资产只存本地盘（多实例无法共享） |
| `JWT_SECRET`（重申）| 生产环境唯一 fail-fast 变量，遗漏会导致服务启动后所有认证接口崩溃 |

## 矩阵盘点备注

1. JWT_SECRET 是全仓唯一 fail-fast 变量：app/api/auth/lib.ts 的 getJwtSecret() 在 NODE_ENV=production 且变量缺失时直接 throw，任何认证请求都会 500。源码内置兜底值 'qingfeng-manju-secret' 已公开在仓库中，任何人可用它伪造任意用户（包括 admin）的 JWT。\n\n2. .env.example 写的是 NEXT_PUBLIC_SENTRY_DSN，但 lib/telemetry.ts 实际读取的是 SENTRY_DSN（无 NEXT_PUBLIC_ 前缀）。两者均出现在代码中但作用不同，部署时应设 SENTRY_DSN（服务端）。\n\n3. DB_DRIVER 默认值在 lib/db-driver.ts 写死为 'sqlite'，但 v9.0.5 任务备注已将「推荐默认」切换为 pg；SQLite 驱动不支持跨进程并发写入，生产多实例部署必须用 pg。\n\n4. model_overrides 表（DB）的覆盖优先级高于 .env 文件：loadModelOverridesIntoEnv() 在 instrumentation.ts 启动时回写 process.env，因此即使 .env 中设了 OPENAI_MODEL，DB 表中有对应记录时也会被覆盖，调试时需注意。\n\n5. QINGYUNTOP_API_KEY 和 VEO_API_KEY 在图像路由（lib/image-providers/builtins.ts）中存在三路回退：QINGYUNTOP_API_KEY → VEO_API_KEY → OPENAI_API_KEY，意味着仅设 OPENAI_API_KEY 也会被尝试作为图像生成密钥。\n\n6. VECTORENGINE_API_KEY 和 KELING_API_KEY 互为别名（lib/tts-providers/vectorengine-tts.ts 和 lib/model-scan.ts 均做了 VECTORENGINE_API_KEY || KELING_API_KEY 回退），设任意一个都能启用 vectorengine-tts。\n\n7. ENABLE_REPLICATE / ENABLE_ELEVENLABS / ENABLE_RUNWAY 三个插件开关必须与对应密钥同时设置（代码用 && 判断），单独设开关不生效。\n\n8. PIPELINE_QUEUE=1 启用的是后台队列入队逻辑，但 queue worker 进程需要单独启动（非 Next.js 内置），生产环境需确保 worker 进程运行，否则任务入队后不会被消费。\n\n9. REDIS_URL 缺失时 event-bus 静默降级为进程内 EventEmitter，多实例部署下不同实例间的评论通知、流水线进度事件完全不互通，但应用不会报错，容易被忽视。\n\n10. APP_URL（无 NEXT_PUBLIC_ 前缀）和 NEXT_PUBLIC_APP_URL 是两个不同变量：前者用于 mock provider 内部拼 URL，后者用于 Stripe 回调，生产部署时两者通常应该设成相同的域名值。"
