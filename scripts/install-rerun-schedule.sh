#!/bin/bash
# 每日重跑的定时任务安装器(macOS launchd)。
#
# v12.380:在此之前,这个定时任务**只存在于我这台机器的 ~/Library/LaunchAgents 里** ——
# 仓库里没有任何生成它的脚本、也没有文档。换台机器、重装系统,或者只是想知道
# 「它到底几点跑、日志写哪」,都无从查起。现在把它纳入版本控制。
#
# 顺带修两件在排查中真正误导过人的事:
#
#  ① **日志路径不一致**。plist 的 StandardOutPath 写的是 `wind-comic-rerun.out.log`,
#     而 rerun-cron.sh 自己 append 的是 `wind-comic-rerun.log` —— 两个文件。
#     查「任务今天跑了没」时打开 .out.log 看到 0 字节,会直接得出「从没执行过」的
#     错误结论(我就这么误判过一次,实际它 9:00 准时跑了)。现在三者统一到同一个文件。
#
#  ② **一天只跑一次,而额度窗口未必对齐那一刻**。日志实测:8/28 两轮分别生成了
#     5 个和 1 个视频,而 8/29 09:00 那轮第一镜就撞 2056(当日额度已满)——
#     说明配额的刷新并不严格对齐「9 点」这个时刻。脚本本身是幂等的
#     (已在盘的素材一律跳过),多跑几次只会多几次撞上窗口的机会。
#
# 用法:
#   bash scripts/install-rerun-schedule.sh            # 安装/更新并加载
#   bash scripts/install-rerun-schedule.sh --print    # 只打印 plist,不碰系统(测试用)
#   bash scripts/install-rerun-schedule.sh --uninstall # 卸载
set -u

LABEL="ai.qfmanju.rerun"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# 三处日志路径必须是同一个 —— 这正是 ① 修的东西
LOG="$HOME/Library/Logs/wind-comic-rerun.log"
# 三个时段:错开撞额度窗口。脚本幂等,重复跑只跳过不重做。
HOURS=(9 14 20)

render_plist() {
  local intervals=""
  for h in "${HOURS[@]}"; do
    intervals+="
    <dict>
      <key>Hour</key><integer>$h</integer>
      <key>Minute</key><integer>0</integer>
    </dict>"
  done
  cat <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/rerun-cron.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StartCalendarInterval</key>
  <array>$intervals
  </array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLISTEOF
}

if [ "${1:-}" = "--print" ]; then
  render_plist
  exit 0
fi

if [ "${1:-}" = "--uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "✅ 已卸载 $LABEL"
  exit 0
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
render_plist > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null   # 幂等:先卸再装,避免重复注册
launchctl load "$PLIST" || { echo "❌ launchctl load 失败"; exit 1; }

echo "✅ 已安装 $LABEL"
echo "   时段:$(printf '%s:00 ' "${HOURS[@]}")"
echo "   日志:$LOG(launchd 与脚本写同一个文件)"
echo "   立即试跑:launchctl start $LABEL"
