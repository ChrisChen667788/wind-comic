#!/usr/bin/env bash
# scripts/docker-demo-smoke.sh — 零 key 演示在**生产镜像**里能不能真出一部成片(v13.6)。
#
# 为什么要有它:v13.1 的官方镜像跑 docker-compose.demo.yml,每次都合成失败 —— 镜像构建绿、
# 冒烟(只打首页)绿、容器 healthy,可成片是全硬切的 concat 兜底,data/composed/ 里还躺着 0 字节的 final-*.mp4;
# 完成事件里的质检报告甚至写着「全片零质量干预,一次成型」。首页能打开 ≠ 产品能用。
#
# 它做的事和一个新用户第一分钟做的一样:登录 demo 账号 → 提交一个创意 → 等流水线跑完 → 拿成片,
# 然后用镜像里的 ffprobe 量:有视频流、有音轨、时长对得上、不是 concat 兜底、日志里没有合成报错。
#
# 用法:
#   DEMO_PASSWORD=... scripts/docker-demo-smoke.sh <容器名> [base_url]
#   base_url 默认 http://localhost:3100;容器必须以 MOCK_ENGINES=1 启动。
set -euo pipefail

CONTAINER="${1:?用法: DEMO_PASSWORD=... $0 <容器名> [base_url]}"
BASE="${2:-http://localhost:3100}"
: "${DEMO_PASSWORD:?需要 DEMO_PASSWORD(与容器启动时设的一致)}"
EMAIL="${DEMO_EMAIL:-demo@qfmanju.ai}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "❌ $*"; echo "── 容器日志(末 40 行)──"; docker logs "$CONTAINER" 2>&1 | tail -40; exit 1; }

echo "① 等 /api/health 变绿"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$BASE/api/health"; then echo "   ✅ 第 ${i} 次探测通过"; break; fi
  [ "$i" = 60 ] && fail "/api/health 120 秒内没有变绿:$(curl -s "$BASE/api/health" || true)"
  sleep 2
done

echo "② 登录 $EMAIL"
LOGIN_BODY="$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$EMAIL" "$DEMO_PASSWORD")"
curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_BODY" > "$WORK/login.json"
TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("token",""))' "$WORK/login.json" 2>/dev/null || true)"
[ -n "$TOKEN" ] || fail "登录失败:$(head -c 300 "$WORK/login.json")"
echo "   ✅ 拿到令牌"

echo "③ 提交创意并等流水线跑完(SSE,上限 300 秒)"
IDEA='都市悬疑:雨夜的上海弄堂里,落魄侦探林默接到一通匿名电话,失踪三年的妹妹留下的怀表突然开始倒走,他必须在天亮前找到真相'
CREATE_BODY="$(python3 -c 'import json,sys; print(json.dumps({"idea":sys.argv[1],"aspect":"16:9","duration":30}))' "$IDEA")"
curl -sN --max-time 300 -X POST "$BASE/api/create-stream" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$CREATE_BODY" > "$WORK/sse.log" || true
grep -q '"type":"complete"' "$WORK/sse.log" || fail "流水线没有跑到 complete:$(head -c 400 "$WORK/sse.log")"

python3 - "$WORK/sse.log" > "$WORK/final.env" <<'PY'
import json, sys
done = None
for line in open(sys.argv[1], encoding='utf-8'):
    if line.startswith('data: ') and '"type":"complete"' in line:
        done = json.loads(line[6:])['data']
er = (done or {}).get('editResult') or {}
url = er.get('finalVideoUrl') or ''
warns = ' / '.join(er.get('audioWarnings') or [])
print(f"FINAL_URL='{url}'")
print(f"TOTAL_DURATION='{er.get('totalDuration') or 0}'")
print(f"WARNINGS='{warns.replace(chr(39), '')}'")
PY
# shellcheck disable=SC1091
source "$WORK/final.env"
[ -n "$FINAL_URL" ] || fail "完成事件里没有 finalVideoUrl"
echo "   成片:$FINAL_URL"
case "$FINAL_URL" in
  *concat-*) fail "成片是 concat 兜底(转场/字幕/响度归一全丢)—— 完整合成失败了。提示:$WARNINGS" ;;
esac
case "$WARNINGS" in
  *concat*) fail "合成降级到了 concat:$WARNINGS" ;;
esac

echo "④ 下载成片并用镜像里的 ffprobe 量"
case "$FINAL_URL" in http*) URL="$FINAL_URL" ;; *) URL="$BASE$FINAL_URL" ;; esac
curl -sf -H "Authorization: Bearer $TOKEN" -o "$WORK/final.mp4" "$URL" || fail "下载成片失败:$URL"
SIZE="$(wc -c < "$WORK/final.mp4" | tr -d ' ')"
[ "$SIZE" -gt 10000 ] || fail "成片只有 ${SIZE} 字节"
docker exec -i "$CONTAINER" ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,width,height \
  -of json -i pipe:0 < "$WORK/final.mp4" > "$WORK/probe.json" || fail "ffprobe 读不了成片"
python3 - "$WORK/probe.json" "$SIZE" "$TOTAL_DURATION" <<'PY' || fail "成片探测不达标"
import json, sys
p = json.load(open(sys.argv[1]))
size, declared = int(sys.argv[2]), float(sys.argv[3])
dur = float(p.get('format', {}).get('duration') or 0)
kinds = [s.get('codec_type') for s in p.get('streams', [])]
v = next((s for s in p.get('streams', []) if s.get('codec_type') == 'video'), {})
print(f"   时长 {dur:.2f}s(流水线回报 {declared:.2f}s)· {size} 字节 · {v.get('width')}x{v.get('height')} · 流 {kinds}")
assert 'video' in kinds, '没有视频流'
assert 'audio' in kinds, '没有音轨'
assert dur > 5, f'时长只有 {dur}s'
PY

echo "⑤ 日志里不能有合成报错"
# 先落盘再 grep —— 不能写成 `docker logs | grep -q`:脚本开着 pipefail,grep -q 一命中就退出,
# docker logs 还在写、吃 SIGPIPE,整条管道返回 141,if 判假 → 日志里真有合成报错反而放行。
# 只有报错行恰好在日志末尾时才拦得住,所以平时看不出来(v13.8 会话实测 3/3 放行后报出)。
docker logs "$CONTAINER" > "$WORK/container.log" 2>&1 || true
if grep -q '\[Composer\] FFmpeg error' "$WORK/container.log"; then
  fail "日志里有合成报错:$(grep -A1 '\[Composer\] FFmpeg' "$WORK/container.log" | head -4)"
fi
echo "✅ 零 key 演示在这个镜像里出了一部完整成片"
