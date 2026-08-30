#!/bin/bash
# 每日定时重跑的外壳(给 launchd 用)。scripts/rerun-daily.sh 只管跑,
# 这一层负责:确保 dev server 在、跑完收尾、日志留痕。
#
# 手动执行也可以:bash scripts/rerun-cron.sh
set -u
cd "$(dirname "$0")/.." || exit 2

LOG="${WC_CRON_LOG:-$HOME/Library/Logs/wind-comic-rerun.log}"
mkdir -p "$(dirname "$LOG")"
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

say "──────── 开始 ────────"

# PATH:launchd 的环境极简,node/npm 往往不在里面
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null || { say "❌ 找不到 node,退出"; exit 1; }

# dev server:没起就临时起一个,跑完关掉(不动用户自己开着的那个)
STARTED_BY_US=0
if ! curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
  say "dev server 未运行,临时启动…"
  nohup npm run dev >> "$LOG" 2>&1 < /dev/null &
  STARTED_BY_US=1
  for i in $(seq 1 60); do
    curl -sf -o /dev/null --max-time 3 http://localhost:3000/ && break
    sleep 2
  done
  if ! curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
    say "❌ dev server 起不来(等了 120s),放弃本次"
    exit 1
  fi
  say "dev server 就绪"
else
  say "复用已在运行的 dev server"
fi

# v12.392:跑之前先问一句「这个 server 有多老」。
#
# 8/30 的教训:owner 的 dev server 从 8/29 10:38 起没重启过,而 v12.377 的编排器
# 改动是 15:17 提交的。我改完那一刻手工实测是好的,当晚 20:00 的定时任务却拿不到
# 新加的字段,于是走进保守兜底、白白停掉当轮视频重跑。
# 不是代码错了,是**进程比代码老**——而这种脱节能静默地持续好几天。
#
# 只报警不中止:图像步骤仍然有价值,停掉等于当天什么都不做。
# 但报警要足够醒目,并且在结尾再说一次(长日志里开头那行会被淹掉)。
STALE_WARN=""
BUILD_INFO=$(curl -sf --max-time 10 http://localhost:3000/api/build-info 2>/dev/null)
if [ -n "$BUILD_INFO" ]; then
  PROC_START=$(printf '%s' "$BUILD_INFO" | sed -n 's/.*"processStartedAt":"\([^"]*\)".*/\1/p')
  # 代码库最后一次改动(取工作区最新提交时间,ISO8601)
  CODE_AT=$(git -C "$(pwd)" log -1 --format=%cI 2>/dev/null)
  if [ -n "$PROC_START" ] && [ -n "$CODE_AT" ]; then
    P=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${PROC_START%.*}" +%s 2>/dev/null || echo 0)
    C=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$(printf '%s' "$CODE_AT" | cut -c1-19)" +%s 2>/dev/null || echo 0)
    if [ "$P" -gt 0 ] && [ "$C" -gt 0 ] && [ "$P" -lt "$C" ]; then
      HOURS=$(( (C - P) / 3600 ))
      STALE_WARN="⚠️  dev server 比代码旧 ${HOURS} 小时(进程起于 ${PROC_START},代码最后改动 ${CODE_AT})——
    本轮很可能跑的不是最新代码。修复:重启 dev server 后再跑一次。"
      say "$STALE_WARN"
    fi
  fi
fi

bash scripts/rerun-daily.sh >> "$LOG" 2>&1
code=$?
say "rerun-daily 退出码 $code"
[ -n "$STALE_WARN" ] && say "$STALE_WARN"

if [ "$STARTED_BY_US" -eq 1 ]; then
  # 只关我们自己起的那个
  pkill -f "next dev" 2>/dev/null
  say "已关闭本次临时启动的 dev server"
fi

say "──────── 结束 ────────"
exit 0
