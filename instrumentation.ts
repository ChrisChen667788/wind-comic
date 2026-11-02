/**
 * Next.js 官方 instrumentation hook。
 * 仅在 Node.js runtime 跑一次 — 用来初始化遥测。
 *
 * 启用: next.config 里打开 `experimental.instrumentationHook: true` (若未默认开启)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // v12.357:**最先做** —— 后面所有初始化(遥测/模型雷达/队列 worker)都可能发请求。
    // Node 的 fetch 默认不认 HTTPS_PROXY,本机经 ClashX 才能到达的网关会全部超时。
    try {
      const { installServerProxy } = await import('@/lib/server-proxy');
      const p = await installServerProxy();
      if (p) console.log(`[proxy] 服务端已挂系统代理 ${p}(否则只走代理的网关会全部超时)`);
    } catch { /* 装不上就直连,不该让服务起不来 */ }

    const { initSentry } = await import('@/lib/telemetry');
    await initSentry();

    // v13.11:**先看数据库开没开成**。打不开(NAS 数据目录属主不对最常见)时只打一行说明,跳过下面依赖数据库的初始化。
    // 此前队列 worker 在这里一碰数据库就抛错,Next 判 instrumentation 失败,整站(含首页、登录页)500,
    // 用户连「登录失败」都看不到。现在页面照常打开,登录/注册回 503 并说明原因,/api/health 503。
    // 只看 SQLite:DB_DRIVER=pg 时任务表和模型覆盖都在 PG 上,本地 SQLite 打不开不该连累它们。
    let dbReady = true;
    try {
      const { getDbDriver } = await import('@/lib/db-driver');
      if (getDbDriver().dialect === 'sqlite') {
        const { dbUnavailable } = await import('@/lib/db');
        dbReady = !dbUnavailable();
      }
    } catch (e) {
      dbReady = false;
      console.error('[instrumentation] 数据库模块加载失败:', e instanceof Error ? e.message : e);
    }
    if (!dbReady) {
      console.error(
        '[instrumentation] 数据库打不开 —— 本次不启动模型覆盖重放、旧库画幅修复和任务队列 worker;页面照常可开,登录/注册会提示原因。' +
          '修好数据目录权限(见上面的 [db] 日志)后重启容器。',
      );
    }

    // v10.6.3: 模型雷达覆盖重放 —— 扫描采用过的模型 ID 写回 process.env,
    // config.ts 的模型 getter 即读到(DB 覆盖优先于 .env 默认,它是用户显式动作)。
    if (dbReady) {
      try {
        const { loadModelOverridesIntoEnv } = await import('@/lib/model-overrides');
        const n = await loadModelOverridesIntoEnv();
        if (n) console.log(`[ModelRadar] ${n} model override(s) restored`);
      } catch { /* 首次建库时序 — 静默 */ }
    }

    // v13.3:旧库里画幅记成引擎出不了的值(v12.468 前创建页的 2.35:1 等)的项目 → 启动后在后台按已出素材改正一次。
    // 放在这里而不是只给脚本:Docker 运行镜像不带 lib/ 源码,手动脚本跑不起来。LEGACY_ASPECT_REPAIR=off 关闭。
    // v13.11:同样要库开得成 —— 打不开时排上去也只会 15 秒后再记一行「自动修复失败」。
    if (dbReady) {
      try {
        const { scheduleLegacyAspectRepair } = await import('@/lib/legacy-aspect-repair');
        scheduleLegacyAspectRepair();
      } catch { /* 修不了也不该让服务起不来 */ }
    }

    // v10.4.1: PIPELINE_QUEUE=1 时开机即启 worker —— kill -9 重启后无需等请求进来,
    // 立刻恢复孤儿任务(running → queued)续跑。
    // v13.11:库打不开时不启(每 1.5s 一次的 tick 只会刷屏报同一个错);启动本身出错也只记日志,不拖垮整站。
    if (dbReady && process.env.PIPELINE_QUEUE === '1') {
      try {
        const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
        ensurePipelineWorker();
      } catch (e) {
        console.error('[instrumentation] 任务队列 worker 开机启动失败:', e instanceof Error ? e.message : e);
      }
    }
  }
}
