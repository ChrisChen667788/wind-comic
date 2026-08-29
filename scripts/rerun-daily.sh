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

# v12.367:视频额度与图像额度是**两套**。视频尽了不该整轮停 ——
# 后续项目改成只跑图像步骤(角色/场景/分镜),把当天的出图配额用掉。
# 分镜图是明天视频的 i2v 首帧,先备好,明天的视频额度才花得到刀刃上。
# v12.367:**先探活再开跑。** 这个脚本是给人手动跑的(cron 走 rerun-cron.sh,
# 那边有探活),而它自己没有 —— 服务没起时会对每个项目喷一大段 ECONNREFUSED 栈,
# 人得读到最后才知道原因。实测踩到过一次。
if ! curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
  echo "⛔ dev server 没在跑(localhost:3000 连不上)。"
  echo "   先启动:  cd $(pwd) && npm run dev"
  echo "   或直接用带自动启动的版本: bash scripts/rerun-cron.sh"
  exit 2
fi

VIDEO_BUDGET_LEFT=1

for entry in "${PROJECTS[@]}"; do
  id="${entry%%|*}"; label="${entry#*|}"
  echo ""
  if [ "$VIDEO_BUDGET_LEFT" -eq 1 ]; then
    echo "████ $label ████"
    WC_PROVIDER=minimax node scripts/rerun-project.mjs "$id"
  else
    echo "████ $label(仅图像 —— 视频额度已耗尽)████"
    WC_PROVIDER=minimax node scripts/rerun-project.mjs "$id" --only=chars,scenes,boards
  fi
  code=$?
  if [ "$code" -eq 3 ]; then
    VIDEO_BUDGET_LEFT=0
    echo "  ↓ 视频额度已耗尽,后续项目只跑图像步骤"
  fi
  [ "$code" -ne 0 ] && [ "$code" -ne 3 ] && echo "  ⚠ $label 有失败项,继续下一个"
done

if [ "$VIDEO_BUDGET_LEFT" -eq 0 ]; then
  echo ""
  echo "⛔ 当日视频额度已耗尽(图像步骤已尽量跑完)。明天再跑一次本脚本即可续上视频。"
fi
echo ""
echo "✅ 前 5 个项目全部重跑完成"
