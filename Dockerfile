# syntax=docker/dockerfile:1.6
# ═══════════════════════════════════════════════════════════════
#  AI Comic Studio — 生产容器镜像 (Next.js 16 + Turbopack)
#
#  阶段:
#    1. deps    — 安装依赖(利用 package-lock.json 缓存)
#    2. builder — Turbopack 构建 (npm run build)
#    3. runner  — 最小运行时(含 ffmpeg + sqlite3,非 root 用户)
#
#  构建:  docker build -t ai-comic-studio .
#  运行:  docker run -p 3100:3100 --env-file .env -v ./data:/app/data ai-comic-studio
#         (自托管 / NAS 见 deploy/docker-compose.yml 与 docs/DEPLOYMENT.md)
# ═══════════════════════════════════════════════════════════════

ARG NODE_VERSION=20-alpine

# ── 1. deps ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --prefer-offline

# ── 2. builder ────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# v12.442:构建期用一次性临时库。next build 起多个 worker 并行收集页面数据,每个都会导入
# lib/db 并对同一个 data/qfmj.db 建表+迁移,arm64(QEMU)下常撞 "database is locked" 使整个
# 构建失败。这里显式置位,不依赖 Next 内部的 NEXT_PHASE(仅 builder 阶段,runner 不带)。
ENV QFMJ_EPHEMERAL_DB=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# v13.8:npm 随包的 ffmpeg / ffprobe 二进制不进运行时镜像。运行时用系统 ffmpeg(见 runner 阶段的
# FFMPEG_PATH / FFPROBE_PATH),这两份既用不上,又是 GPL-3 构建(ffprobe-static 的 package.json 写 MIT,
# 但它带的二进制是 --enable-gpl --enable-version3),还占约 380 MB —— ffprobe-static 把 darwin / win32 / linux
# 各架构的二进制全打在包里。在这里删,下面的 COPY --from=builder 就拷不到;在 runner 里删的话,
# 文件仍躺在 COPY 那一层里照样随镜像分发。代码对包缺二进制有兜底(lib/ffmpeg-bin.ts 会往下找)。
RUN rm -f node_modules/ffmpeg-static/ffmpeg && rm -rf node_modules/ffprobe-static/bin

# ── 3. runner ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# ffmpeg(本地合成)+ 字幕字体
#
# v12.421:此前只装 `ttf-dejavu` —— **它没有任何中日韩字形**。
# 而 lib/subtitle-burn.ts 在 Linux 下给的字体名是 `Noto Sans CJK SC` / `Noto Sans JP` /
# `Noto Sans KR`,解析不到时 libass 会回退到 DejaVu,于是**每一个汉字都烧成方框**。
# 这是一个中文短剧产品的官方镜像,中文字幕烧不出来,成片就是废的 ——
# 而它不会报错:镜像构建成功、容器起得来、片子也出得来,只是字看不了。
# 又一个「失败长得像成功」。
#
# 构建期自证:本机没有 docker,我无法实测这个包到底提供哪些 family 名。
# 与其猜,不如让**构建本身**来证明 —— `fc-match` 找不到时会静默回退,
# 所以这里检查它解析到的确实是 Noto;解析不到就让镜像构建**失败**,
# 而不是静默发一个把中文烧成方框的镜像。
RUN apk add --no-cache ffmpeg ttf-dejavu font-noto-cjk fontconfig \
 && addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs nextjs

# `font-noto-cjk` 给的是**泛 CJK 家族**(Noto Sans CJK SC/TC/JP/KR),
# 没有独立的 `Noto Sans JP` / `Noto Sans KR` —— 而 subtitle-burn 请求的正是后者。
# 这不是猜的:上面那道自证在 Docker workflow 第一次跑时就把它拦了下来
#(「字体「Noto Sans JP」解析不到 Noto(回退到了 DejaVu Sans)」)。
# 在镜像内做名字映射,而不是改代码 —— `Noto Sans JP` 是真实存在的独立字体,
# 本机装了它的用户请求它是对的;问题只出在这个镜像里,就在这个镜像里解决。
COPY docker/font-aliases.conf /etc/fonts/conf.d/99-wind-comic-cjk.conf
RUN fc-cache -f \
 && for f in "Noto Sans CJK SC" "Noto Sans JP" "Noto Sans KR"; do \
      resolved="$(fc-match --format='%{family}' "$f")"; \
      case "$resolved" in \
        *Noto*) : ;; \
        *) echo "❌ 字体「$f」解析到了 $resolved 而不是 Noto —— 字幕会烧成方框,拒绝构建"; exit 1 ;; \
      esac; \
    done \
 && echo "✅ 中日韩字幕字体自证通过"

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
# v12.421:此处原有 `COPY --from=builder /app/drizzle ./drizzle` —— 而**这个项目根本没用 drizzle**:
# 无 drizzle 依赖、无 drizzle.config.ts、仓库里也没有 drizzle/ 目录;建表在 lib/db.ts 里做。
# 也就是说这一行让镜像**从来就构建不出来**(buildkit 报 "/app/drizzle": not found)。
# 连带后果:README 上的 Docker 说明、v12.414 的零 key 试用(docker compose up --build),
# 一直都是不成立的 —— 一个从没被执行过的构建,和没有构建是一回事。
# 是 v12.421 第一次真把它跑起来才发现的。
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# v12.437:导演技能库在**运行时**从 skills/<id>/SKILL.md 读取。迁移前题材镜头包是 TS 常量、
# 编译进 .next,哪都能跑;迁移后它依赖这个目录 —— 而运行时镜像原本只拷上面几项。
# 漏掉这一行,加载器按设计「目录不存在不报错」返回空:**生产镜像会悄悄丢掉全部题材包**,
# 本地测试照样全绿(本地 cwd 下目录一直在)。与上面 drizzle 那行是同一类「拷贝清单」问题。
COPY --from=builder --chown=nextjs:nodejs /app/skills ./skills

# v13.6 / v13.8:合成一律用上面 apk 装的系统 ffmpeg,不用 npm 随包的 ffmpeg-static。
#
# 随包的 Linux 版是 johnvansickle 静态版 7.0.2,它:
#   ① 不认「变速 setpts 之后接 xfade」(帧率被标成 1/0,退出码 234):任何一镜被调速,整片合成失败,
#      只剩全硬切 concat 兜底。零 key 演示(docker-compose.demo.yml)每次都撞,v13.1 实测;
#   ② 没有 drawtext 滤镜:封面标题、片尾卡、AI 角标在这个镜像里全都起不来;
#   ③ 自带一套 fontconfig,上面那道中日韩字体自证验的是系统 fc-match,管不到它。
# v13.6 时代码十几处各自按「ffmpeg-static 优先」解析,只能把随包二进制换成软链接;v13.8 起解析收口到
# lib/ffmpeg-bin.ts,FFMPEG_PATH / FFPROBE_PATH(上面 ENV 设的)真的生效,随包二进制在 builder 阶段就删了。
# 要换成自己的 ffmpeg:compose 里覆盖这两个变量。两边滤镜清单比过:系统版只少 rubberband/frei0r/dnn_* 等,代码一个都没用。
# 下面让构建自己证明:随包二进制不在、$FFMPEG_PATH 缺 drawtext、或变速后接 xfade 起不来,都让镜像构建失败。
RUN set -e; \
    for f in /app/node_modules/ffmpeg-static/ffmpeg /app/node_modules/ffprobe-static/bin; do \
      if [ -e "$f" ]; then echo "❌ 随包二进制 $f 进了镜像 —— 不该分发它,也会让人误以为合成用的是它,拒绝构建"; exit 1; fi; \
    done; \
    ff="$FFMPEG_PATH"; \
    "$FFPROBE_PATH" -version >/dev/null; \
    if ! "$ff" -hide_banner -filters 2>/dev/null | grep -qw drawtext; then \
      echo "❌ 合成用的 ffmpeg 没有 drawtext —— 封面标题/片尾卡会起不来,拒绝构建"; exit 1; \
    fi; \
    if ! "$ff" -v error -f lavfi -i color=c=red:s=64x64:d=2:r=24 -f lavfi -i color=c=blue:s=64x64:d=2:r=24 \
         -filter_complex "[0:v]fps=24[a];[1:v]fps=24,setpts=0.870*PTS,fps=24[b];[a][b]xfade=transition=fade:duration=0.5:offset=1.5[v]" \
         -map "[v]" -f null -; then \
      echo "❌ 合成用的 ffmpeg 跑不通合成器的「变速 → xfade」滤镜链 —— 有调速镜头的成片会合成失败,拒绝构建"; exit 1; \
    fi; \
    echo "✅ 合成用的 ffmpeg 自证通过:$ff · $("$ff" -version | head -1 | cut -d' ' -f1-3)"

# SQLite 数据目录(volume mount)
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3100

# 健康检查 —— v13.6 起探 /api/health(数据库可读写 + JWT 密钥可用),不再探首页。
# 首页是静态壳:数据目录属主不对、没设 JWT_SECRET、用了占位密钥这三种「登录不了」(v13.11 前是 500,
# 之后登录页提示原因),首页全都照样 200、容器照样 healthy(v13.1 NAS 实测)。首次启动要建表 + 迁移,start-period 放宽到 60s。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/health >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "start"]
