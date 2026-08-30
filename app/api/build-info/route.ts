import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/build-info —— 这个**进程**有多老。
 *
 * v12.392:昨晚 20:00 的定时重跑跑的是**旧代码**。
 *
 * 病根:owner 的 dev server 从 8/29 10:38 起就没重启过,而 v12.377 的编排器改动
 * 是 15:17 提交的 —— 中间差了近五个小时。我在改完那一刻实测,拿到了新加的
 * `engineFailures`(kling/minimax/veo 三条真实报文);而当晚定时任务跑同一条路径,
 * 拿到的是 `undefined`,于是走进「拿不到失败报文,保守处理」的兜底,
 * 白白停掉了当轮的视频重跑。
 *
 * 这类问题最难查的地方在于:**它不是代码错了,而是「你以为在跑的代码」
 * 和「实际在跑的代码」不是一个东西**。日志、行为、测试全都指向别处。
 *
 * ── 第一版设计是错的,记下来 ────────────────────────────────────────
 * 我最先写的是「模块加载时定格一个 version,和磁盘上的 package.json 比对」。
 * 它测不出任何东西:这个 route 是新建的,Next 刚编译它,那个「定格」的值
 * 永远等于当前磁盘值。**在 HMR 模型下,新模块永远是新的** ——
 * 一个刚出生的哨兵,报不出别人有多老。
 *
 * 能反映「进程有多老」的只有进程级事实:**启动时刻**。
 * 所以这里只报事实(启动时间、uptime),把判断交给调用方 ——
 * 定时脚本能跑 git,由它去比「进程启动」和「代码最后改动」谁更晚。
 *
 * 无鉴权是刻意的:只回进程元信息,不含任何项目数据或配置,
 * 而定时脚本在拿到登录态之前就需要它。
 */
// paid-gate: ok — 只读进程元信息,不调任何外部服务,不花钱

export async function GET() {
  const uptimeSec = Math.round(process.uptime());
  return NextResponse.json({
    // 进程真实启动时刻(由 uptime 反推)—— 不是模块加载时刻
    processStartedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
    uptimeSec,
    node: process.version,
    pid: process.pid,
  });
}
