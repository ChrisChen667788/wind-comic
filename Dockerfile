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
#  运行:  docker run -p 3100:3100 --env-file .env.local ai-comic-studio
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
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── 3. runner ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

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

# SQLite 数据目录(volume mount)
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3100

# 健康检查 — 命中首页或 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3100/ >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "start"]
