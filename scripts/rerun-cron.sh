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

bash scripts/rerun-daily.sh >> "$LOG" 2>&1
code=$?
say "rerun-daily 退出码 $code"

if [ "$STARTED_BY_US" -eq 1 ]; then
  # 只关我们自己起的那个
  pkill -f "next dev" 2>/dev/null
  say "已关闭本次临时启动的 dev server"
fi

say "──────── 结束 ────────"
exit 0
