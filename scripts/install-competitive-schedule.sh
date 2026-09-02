#!/bin/bash
# 竞品分析到期检查的定时任务(macOS launchd)。
#
# owner 的要求:**最晚每 2 周一次**。而实际执行一直靠人记 —— 上一轮核验 2026-08-07,
# 等下一次动手已是 8-31,三周多没更新;这期间视频模型至少出了两轮新版本,
# 而对外 README 上挂着的还是旧数字。**过期的数字比没有数字更糟:它看起来是核实过的。**
#
# 这个任务不产出分析(那需要联网检索 + 判断,脚本做不到,硬做只会得到一份像分析的空壳)。
# 它做的是:到期检查 + 把上一轮的结论摊成本轮的待验假设 + 生成一份可直接执行的任务书。
#
# 跑得比 14 天更勤(每 7 天),这样「超期」在第 15 天就会被看见,而不是等到第 28 天。
#
# ── 第一版错在哪(值得记住)──────────────────────────────────────────
# 第一版把输出重定向进日志文件就完事了。**那个日志没有人会去打开** ——
# 超期时 exit 1 落进一个没人读的文件,这个「自动化」就只是看起来存在。
# 而且它是**无条件**生成任务书的:每周一都掉一个 TASK 文件进工作区,不超期也掉;
# 每周都出现的东西第三周就成了噪音,到真超期那次反而没人看。
#
# 现在跑 `--if-due --notify`:超期才动作,动作就一定通向人 ——
# ① macOS 通知横幅(当场看见);② 任务书落进工作区,git status 里必然撞见。
set -u
LABEL="ai.qfmanju.competitive"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/wind-comic-competitive.log"

render() {
  cat <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO" &amp;&amp; printf '[%s] ' "\$(date '+%F %T')" &gt;&gt; "$LOG" &amp;&amp; /usr/bin/env node scripts/competitive-scan.mjs --if-due --notify &gt;&gt; "$LOG" 2&gt;&amp;1; echo "--- exit \$? ---" &gt;&gt; "$LOG"</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLISTEOF
}

if [ "${1:-}" = "--print" ]; then render; exit 0; fi
if [ "${1:-}" = "--uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null; rm -f "$PLIST"
  echo "✅ 已卸载 $LABEL"; exit 0
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
render > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null   # 幂等:先卸再装
launchctl load "$PLIST" || { echo "❌ launchctl load 失败"; exit 1; }
echo "✅ 已安装 $LABEL"
echo "   频率:每周一 10:00 检查(约定间隔 14 天 —— 查得比约定勤,超期才能早一周被发现)"
echo "   超期时:弹 macOS 通知 + 把任务书落进工作区(git status 可见);未超期则静默,不产生噪音"
echo "   日志:$LOG"
echo "   手动跑:node scripts/competitive-scan.mjs"
