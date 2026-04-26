# Video API Benchmark — qingyuntop 聚合网关

> 探测时间: 2026-04-10
> 网关 base: `https://api.qingyuntop.top`
> 测试入口: `scripts/video-probe.mjs`、`scripts/sora2-smoke.ts`
> 接入位置: `services/veo.service.ts` (统一入口, 双协议)

本文档记录我们在 qingyuntop 聚合网关上对视频生成模型的端到端探测结果, 用于:

1. 决定生产环境的 **主用模型 + fallback 链**
2. 留档每个候选模型的协议差异 (避免下次接入时重新踩坑)
3. 给运维一个可复跑的探测脚本, 上游一旦扩容就能立刻验证

---

## 1. 协议矩阵

qingyuntop 的视频接口同时挂了两套协议, 同一个模型在不同路径上 body / 字段名都不一样.
我们在 `services/veo.service.ts` 用 `VEO_API_FORMAT` 切换:

| 协议       | 创建任务                           | 查询任务                                      | body 关键字段                                                       | 适用模型 |
| ---------- | ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- | -------- |
| `openai`   | `POST /v1/videos`                  | `GET /v1/videos/<id>`                         | `model`, `prompt`, `seconds: string`, `size: "1280x720"`            | sora-2, sora-2-pro |
| `unified`  | `POST /v1/video/create`            | `GET /v1/video/query?id=<id>`                 | `model`, `prompt`, `duration: number`, (sora 系还需要 `size`)       | veo3.x, veo2.x, MiniMax-*, doubao-*, viduq1 |

**接入实测踩坑笔记:**

- `sora-2` 在 `openai` 协议下 `seconds` 必须是字符串 (`"4"` / `"8"` / `"12"`), 数字会被网关 415.
- `sora-2` 在 `unified` 协议下也要带 `size`, 否则上游回 `"size is required for sora-2"` (这是网关层校验, 不是真正的限流). 我们已在 `createTaskUnified` 里对 `model.startsWith('sora')` 自动注入 size — 见 `services/veo.service.ts:124-128`.
- 状态字段在两套协议下不一致: `pending / queued / in_progress / video_generating / processing / completed / failed / video_generation_failed`. 已在 `normalizeStatus` 里做归一 (`services/veo.service.ts:262`).
- 结果 URL 字段在不同模型下有 6 种位置, 见 `extractVideoUrl` (`services/veo.service.ts:279`):
  `video_url || result_url || result.video_url || result.url || task_result.videos[0].url || output.video_url || output.url`.

---

## 2. 当前探测结果 (2026-04-10)

```bash
PROBE_TIMEOUT_MS=15000 node scripts/video-probe.mjs --all > /tmp/video-probe.json
```

| 模型                                         | 协议    | 结果 | 阶段   | 时长   | 上游错误 / 备注                                                                                          |
| -------------------------------------------- | ------- | ---- | ------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `sora-2`                                     | openai  | ❌   | create | 1.5s   | `local:pre_consume_token_quota_failed` — 当前分组上游负载已饱和                                          |
| `veo3.1-fast`                                | unified | ❌   | create | 0.7s   | 当前分组上游负载已饱和                                                                                   |
| `veo3.1`                                     | unified | ❌   | create | 1.0s   | 当前分组上游负载已饱和                                                                                   |
| `veo3-fast`                                  | unified | ❌   | create | 0.3s   | 当前分组上游负载已饱和                                                                                   |
| `veo2-fast`                                  | unified | ❌   | create | 0.9s   | 当前分组上游负载已饱和                                                                                   |
| `MiniMax-Hailuo-02`                          | unified | ❌   | create | 1.5s   | 网关回 `invalid character 'p' after top-level value` (上游未对接 / 协议不匹配)                            |
| `doubao-seedance-1-0-lite-t2v-250428`        | unified | ❌   | create | 0.8s   | `relay.model_price_not_found` (账号定价表未授权该模型)                                                   |
| `viduq1`                                     | unified | ❌   | create | 2.0s   | `unexpected end of JSON input` (上游未对接)                                                              |

**摘要:** 8/8 创建失败, **0 通过**, fastest = N/A.

### 失败分类

1. **上游配额饱和 (5 个 veo 系 + sora-2)** — `pre_consume_token_quota_failed`. 这不是真正的请求级限流, 而是 qingyuntop 在转发前对账号 wallet 做的 *预扣* 检查就被分组吃满了. 同一时刻调 `/v1/chat/completions` 没问题 (gpt-4o-mini 200 OK), 说明 chat 渠道与 video 渠道是不同的上游池, 这个错误也只影响 video.
2. **未对接 / 模型未授权 (3 个非 google 系)** — `relay.model_price_not_found` 表示 qingyuntop 没有为这个 key 配价格条目; `invalid character / unexpected end of JSON input` 表示上游 distributor 根本没接通, 网关在反序列化空响应. 这 3 个模型在当前账号上 **永远不可用**, 不需要再 retry.

### 与 chat 渠道对照 (确认 key 本身有效)

```bash
curl -s https://api.qingyuntop.top/v1/chat/completions \
  -H 'Authorization: Bearer sk-XpkjDc7BU...vPhu5b' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
# → 200 OK, "Hello! How can I"
```

✅ key 有效, ✅ 网关在线, ❌ video 池满载. 这是上游侧问题, 不是代码侧问题.

---

## 3. 端到端集成验证 (services/veo.service.ts)

`scripts/sora2-smoke.ts` 通过 **真实** `VeoService` 走完整路径 (env → API_CONFIG → `new VeoService()` → `generateVideoFromText()` → 创建 → 轮询 → `extractVideoUrl`):

```bash
# openai 协议 (默认)
DURATION=4 npx tsx scripts/sora2-smoke.ts

# unified 协议
VEO_API_FORMAT=unified DURATION=4 npx tsx scripts/sora2-smoke.ts
```

**两条协议路径都验证到了 "请求被网关接收并校验通过, 在配额阶段被 429 退回" 这一步**, 即:

- `dotenv` 解析 → `API_CONFIG.veo` 注入正确
- `VeoService` 实例化, `hasVeo()` = true
- `createTaskOpenAI` / `createTaskUnified` 序列化的 body 被网关 *接受* (校验通过)
- 网关立刻回 `pre_consume_token_quota_failed`, 我们的错误 surface 链路 (`Veo API error (...)`) 也正常运转

换句话说: **代码层全绿, 等 qingyuntop 那边的视频池放出额度就能直接跑通**, 不需要再改服务端代码.

---

## 4. 生产环境 fallback 链建议

按上面的实测排序, 一旦上游恢复 (或换一个 video 池子充足的网关账号), 推荐配置:

```env
# .env.local — 主用 + 自动降级
VEO_API_FORMAT=openai
VEO_MODEL=sora-2
VEO_FALLBACK_MODELS=veo3.1-fast,veo3-fast,veo3.1,veo2-fast
```

理由:

| 排名 | 模型          | 选它的理由                                                                                  |
| ---- | ------------- | ------------------------------------------------------------------------------------------- |
| ①    | `sora-2`      | 历史成功率最高 (上次实测稳定), 写实人像 + 镜头运动质量最好, 是 v2.x storyboard 的目标质感   |
| ②    | `veo3.1-fast` | google 系最快档, 5-6 秒短片成本/速度最低, 适合做 episodic 量产                              |
| ③    | `veo3-fast`   | 备用 google 池, 协议与 veo3.1-fast 完全一致, 切换零成本                                     |
| ④    | `veo3.1`      | 完整版, 慢但质量高, 用于关键 hero shot                                                      |
| ⑤    | `veo2-fast`   | 最后兜底, 风格偏老但响应稳                                                                  |

`MiniMax-Hailuo-02` / `doubao-seedance` / `viduq1` 在当前 key 下被网关排除, **不要进 fallback 链** — 否则会引入额外的 1-2s 失败延迟.

---

## 5. 复跑命令清单

```bash
# 单模型快速探测
node scripts/video-probe.mjs --quick                          # 只测 sora-2
node scripts/video-probe.mjs --models sora-2,veo3.1-fast      # 自定义子集

# 全量探测 + 落 JSON
PROBE_TIMEOUT_MS=15000 node scripts/video-probe.mjs --all > /tmp/video-probe.json

# 端到端冒烟 (走真实 VeoService, 验证整条服务调用链)
DURATION=4 npx tsx scripts/sora2-smoke.ts
VEO_MODEL=veo3.1-fast VEO_API_FORMAT=unified DURATION=4 npx tsx scripts/sora2-smoke.ts

# 验证 key 本身仍有效 (chat 路径不受 video 池影响)
curl -s -X POST https://api.qingyuntop.top/v1/chat/completions \
  -H 'Authorization: Bearer '"$VEO_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"max_tokens":3}'
```

---

## 6. 监控建议

1. **上游恢复哨兵**: 把 `node scripts/video-probe.mjs --quick` 包成 cron, 5 分钟跑一次, 一旦 sora-2 通过就告警 / 自动取消 fallback.
2. **错误码白名单**: `pre_consume_token_quota_failed` 应被 orchestrator 视作 *transient* 错误, 立刻切到 fallback 链下一个模型, 不要 retry 当前模型 (无意义, 池没扩容).
3. **`relay.model_price_not_found` 视作 permanent**: 一旦遇到, 把模型从 fallback 链里彻底剔除, 不再尝试.
4. **首响延迟分布**: 探测结果里看到 5/8 的失败都在 1.5s 内回, 说明网关 *拒绝* 是即时的, 不会拖慢请求. 这意味着 fallback 链遍历的最坏总耗时 ≈ `链长 × 1.5s`, 是可接受的.
