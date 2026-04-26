#!/usr/bin/env bash
# ============================================================================
# XVERSE-Ent 一键启动脚本
# 用法:
#   ./scripts/xverse-launch.sh           # 默认 vLLM + A5.7B
#   ENGINE=sglang ./scripts/xverse-launch.sh
#   MODEL=A4.2B ./scripts/xverse-launch.sh
#   PORT=8001 ./scripts/xverse-launch.sh
# ============================================================================

set -euo pipefail

ENGINE="${ENGINE:-vllm}"            # vllm | sglang
MODEL_SIZE="${MODEL:-A5.7B}"        # A5.7B | A4.2B
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
GPU_MEM="${GPU_MEM:-0.85}"          # vLLM gpu_memory_utilization
DTYPE="${DTYPE:-auto}"              # auto | float16 | bfloat16
HF_MIRROR="${HF_MIRROR:-}"          # 设为 https://hf-mirror.com 可走国内镜像

case "$MODEL_SIZE" in
  A5.7B|a5.7b) HF_REPO="xverse/XVERSE-Ent-A5.7B"; MS_REPO="xverse/XVERSE-Ent-A5.7B" ;;
  A4.2B|a4.2b) HF_REPO="xverse/XVERSE-Ent-A4.2B"; MS_REPO="xverse/XVERSE-Ent-A4.2B" ;;
  *) echo "❌ 未知 MODEL=$MODEL_SIZE，仅支持 A5.7B / A4.2B"; exit 1 ;;
esac

if [[ -n "$HF_MIRROR" ]]; then
  export HF_ENDPOINT="$HF_MIRROR"
  echo "🌏 HuggingFace 镜像: $HF_ENDPOINT"
fi

echo "════════════════════════════════════════════════════════════"
echo " XVERSE-Ent launcher"
echo "   engine : $ENGINE"
echo "   model  : $HF_REPO"
echo "   port   : $PORT"
echo "   host   : $HOST"
echo "   GPU mem: $GPU_MEM"
echo "   dtype  : $DTYPE"
echo "════════════════════════════════════════════════════════════"

case "$ENGINE" in
  vllm)
    if ! command -v python >/dev/null 2>&1; then
      echo "❌ python 未安装"; exit 1
    fi
    if ! python -c "import vllm" 2>/dev/null; then
      echo "📦 vllm 未安装，请先 pip install vllm"
      exit 1
    fi
    exec python -m vllm.entrypoints.openai.api_server \
      --model "$HF_REPO" \
      --trust-remote-code \
      --host "$HOST" \
      --port "$PORT" \
      --gpu-memory-utilization "$GPU_MEM" \
      --dtype "$DTYPE" \
      --max-model-len 32768
    ;;

  sglang)
    if ! python -c "import sglang" 2>/dev/null; then
      echo "📦 sglang 未安装，请先 pip install \"sglang[all]\""
      exit 1
    fi
    exec python -m sglang.launch_server \
      --model-path "$HF_REPO" \
      --host "$HOST" \
      --port "$PORT" \
      --trust-remote-code \
      --context-length 32768
    ;;

  modelscope)
    if ! python -c "import modelscope" 2>/dev/null; then
      echo "📦 modelscope 未安装，请先 pip install modelscope"
      exit 1
    fi
    echo "ℹ️  ModelScope 模式仅做模型预下载，启动 vLLM 仍走本地路径"
    python - <<PY
from modelscope import snapshot_download
path = snapshot_download("$MS_REPO")
print("✅ ModelScope downloaded to:", path)
PY
    ;;

  *)
    echo "❌ 未知 ENGINE=$ENGINE，支持 vllm | sglang | modelscope"
    exit 1
    ;;
esac
