# Plugin-chain 灰度切换 Runbook (v3.2 P4)

> orchestrator 的 image / video / tts 三条主路径已经全部接到 plugin chain
> wrapper, 但默认 `off` — 行为和老版本完全一致, 零风险. 这份 runbook 说明怎么
> 用 `shadow` 收数据、确认稳定后切 `primary`、出问题怎么滚回.

## 三种 mode

| mode | 行为 | 业务影响 | 何时用 |
|---|---|---|---|
| `off` (默认) | 完全走老主路径, plugin 不被调用 | 无 | 现网常态 / 出问题滚回 |
| `shadow` | 老主路径出结果给用户; plugin 按采样率异步跑一遍, 只记 telemetry | 无 (plugin 失败不影响用户), **但会产生真实 API 调用花钱** | 切 primary 前收 1 周对照数据 |
| `primary` | 先试 plugin chain, 失败才落老主路径 | plugin 成为主路径 | shadow 数据达标后 |

## 环境变量

```bash
# 切换 mode
PLUGIN_CHAIN_MODE=off           # off | shadow | primary

# shadow 采样率 (0.0-1.0). 默认 0.05 = 5%. shadow 烧钱, 别全量.
PLUGIN_CHAIN_SHADOW_RATE=0.05

# 自定义 provider 目录 (可选) — 自动扫描注册第三方 plugin
IMAGE_PROVIDERS_DIR=/path/to/custom/providers
```

## 标准切换流程

### 1. 开 shadow 收数据 (建议 ≥ 1 周)

```bash
PLUGIN_CHAIN_MODE=shadow PLUGIN_CHAIN_SHADOW_RATE=0.1 npm start
```

跑一段时间后看 admin 面板:

```bash
curl -H "Authorization: Bearer <admin-jwt>" \
  'http://localhost:3000/api/admin/plugin-stats?hours=168'   # 最近 7 天
```

关注 `persisted.rows[]`:
- `shadowAgreeRate` — plugin 与老链路一致率, 目标 **≥ 0.98**
- `avgLatencyMs` — plugin 延迟, 与老链路对比不应明显劣化
- `shadowDisagree` 的样本 → 去 `plugin_chain_events` 表看 `error` 列归类失败原因

当 `persisted.cutoverReady === true` (每个有 shadow 样本的 kind 一致率 ≥ 0.98
且样本 ≥ 50), 说明可以切了.

### 2. 切 primary

```bash
PLUGIN_CHAIN_MODE=primary npm start
```

切完继续盯 `?hours=24`:
- `primaryHitRate` — plugin 命中率. 持续 < 0.9 说明 plugin chain 经常落回老逻辑,
  排查 provider `available()` / 配额.
- `primaryFallback` 的 `error` 列 — 命中失败原因.

### 3. 出问题滚回

```bash
PLUGIN_CHAIN_MODE=off npm start    # 立即回到老主路径, 无需回滚代码
```

`off` 模式下 plugin wrapper 是直通的 (`if (mode === 'off') return fallback()`),
等价于这套机制从未存在. 这是为什么默认 off 是安全的.

## 接入范围 (P4 实际状态)

| 路径 | 调用点 | 状态 |
|---|---|---|
| image | `generateImage` (主路径) | ✅ 全程包 `withImagePlugin` |
| video | per-shot 引擎路由 (主路径, 95%+ 流量) | ✅ 包 `withVideoPlugin` |
| video | retry / regen 兜底路径 (3 处) | ⛔ 仍走老逻辑 — 它们本就是 fallback-of-fallback, 触发率低, 留 P5 |
| tts | Editor 配音主循环 | ✅ 包 `withTTSPlugin` |

## 注意事项

- **shadow 烧钱**: shadow 真的会调上游 API. 采样率别开太高, 监控账单.
- **telemetry 是 best-effort**: `recordPluginEvent` 写 SQLite 失败会静默吞掉,
  绝不拖垮业务. 数据偶有缺口正常.
- **多进程计数分裂**: `inProcess` 计数是单进程内存值, 重启清零. 真实历史看
  `persisted` (SQLite 聚合).
