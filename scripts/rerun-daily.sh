#!/bin/bash
# 每日重跑一轮:按价值优先级走,视频额度一耗尽就整轮停下(明天再跑会自动续上)。
#
# 用法:  bash scripts/rerun-daily.sh
# 断点续跑:已生成的自动跳过;上次的 Ken Burns 占位片会被识别并重做。
set -u
cd "$(dirname "$0")/.." || exit 2

PROJECTS=(
  "proj-1780686289776|1. 月挂不下来"
  "proj-1781825292114|2. AI觉醒·复仇启动"
  "proj-1781368728491|3. 宿命之柱"
  "proj-1781606662191|4. 赤马斩龙"
  "proj-1781164723524|5. 绿皮书之约"
)

for entry in "${PROJECTS[@]}"; do
  id="${entry%%|*}"; label="${entry#*|}"
  echo ""
  echo "████ $label ████"
  WC_PROVIDER=minimax node scripts/rerun-project.mjs "$id"
  code=$?
  if [ "$code" -eq 3 ]; then
    echo ""
    echo "⛔ 当日视频额度已耗尽,本轮到此为止。明天再跑一次本脚本即可续上。"
    exit 0
  fi
  [ "$code" -ne 0 ] && echo "  ⚠ $label 有失败项,继续下一个"
done
echo ""
echo "✅ 前 5 个项目全部重跑完成"
