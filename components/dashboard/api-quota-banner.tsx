'use client';

/**
 * components/dashboard/api-quota-banner (v2.17 P0.3)
 *
 * 顶部黄/红 banner — 当任意外部 API 配额耗尽 / 上游饱和 / 鉴权失败时, 让用户在
 * 点 "开始创作" 前就看到 "Minimax 视频已暂时不可用, 会自动降级到 Veo" 的提示。
 *
 * 数据源: GET /api/api-status (公开, 1 小时窗口活跃告警)
 * 轮询间隔: 60s — 不打扰但够新
 *
 * 行为:
 *   - 无活跃告警 → 不渲染
 *   - 有告警 → 渲染 banner, 列出每个 provider 的简短状态
 *   - 用户点 X → 本会话内不再显示 (sessionStorage)
 */

import { useEffect, useState, useCallback } from 'react';
import { Warning as AlertTriangle, X, Lightning as Zap, WifiHigh as Wifi, Clock, Lock } from '@phosphor-icons/react';

interface AlertItem {
  provider: string;
  alertType: 'exhausted' | 'saturated' | 'rate_limited' | 'auth_failed' | 'model_unavailable';
  lastSeenAt: string;
  count: number;
}

const PROVIDER_LABEL: Record<string, string> = {
  minimax: 'Minimax (视频/图片/TTS/音乐)',
  midjourney: 'Midjourney (人物/场景/分镜)',
  openai: 'Claude/OpenAI (剧本)',
  veo: 'Veo (视频备选)',
  kling: '可灵 (视频)',
  vidu: 'Vidu (长视频)',
  fal: 'Fal/Flux (图片备选)',
  comfyui: 'ComfyUI (图片备选)',
  xverse: 'XVerse (编剧备选)',
  qingyuntop: '青云顶 (聚合网关)',
};

const ALERT_LABEL: Record<AlertItem['alertType'], { text: string; icon: any; tone: 'red' | 'amber' }> = {
  exhausted: { text: '余额耗尽', icon: Zap, tone: 'red' },
  saturated: { text: '上游饱和', icon: Wifi, tone: 'amber' },
  rate_limited: { text: '触发限流', icon: Clock, tone: 'amber' },
  auth_failed: { text: '鉴权失败', icon: Lock, tone: 'red' },
  // v2.22: 套餐不支持某模型 — 不是鉴权问题, 提示用户改模型 / 升级套餐
  model_unavailable: { text: '套餐不支持此模型', icon: Lock, tone: 'amber' },
};

const DISMISS_KEY = 'apiQuotaBanner.dismissed';

export function ApiQuotaBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dismissed, setDismissed] = useState(false);

  // 会话级别 dismiss
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/api-status', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body?.alerts)) {
        setAlerts(body.alerts);
      }
    } catch {
      /* 静默 — banner 失败不能影响主页 */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 60_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
  };

  if (dismissed || alerts.length === 0) return null;

  // 找最严重的色调
  const hasRed = alerts.some((a) => ALERT_LABEL[a.alertType]?.tone === 'red');
  const bg = hasRed
    ? 'bg-rose-500/15 border-rose-500/40 text-rose-100'
    : 'bg-amber-500/15 border-amber-500/40 text-amber-100';

  return (
    <div className={`mx-4 my-2 rounded-lg border ${bg} px-4 py-2.5 flex items-start gap-3`}>
      <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${hasRed ? 'text-rose-300' : 'text-amber-300'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold tracking-wide opacity-80 uppercase">
          API 状态告警 · {alerts.length} 项
        </div>
        <ul className="mt-1 space-y-0.5">
          {alerts.map((a) => {
            const label = ALERT_LABEL[a.alertType];
            const Icon = label?.icon || AlertTriangle;
            return (
              <li key={a.provider} className="text-[12px] flex items-center gap-1.5">
                <Icon className="w-3 h-3 opacity-70" />
                <span className="font-medium">{PROVIDER_LABEL[a.provider] || a.provider}</span>
                <span className="opacity-60">·</span>
                <span>{label?.text || a.alertType}</span>
                {a.count > 1 && (
                  <span className="opacity-60 text-[10px]">×{a.count}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-[10.5px] opacity-60 mt-1.5">
          创作流程会自动降级到备选引擎; 如需充值, 请联系管理员或查看
          <a href="/dashboard/billing" className="underline mx-1 opacity-90 hover:opacity-100">计费页</a>
        </p>
      </div>
      <button
        onClick={handleDismiss}
        className="shrink-0 p-1 rounded hover:bg-white/10 opacity-60 hover:opacity-100"
        title="本次会话不再提示"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
