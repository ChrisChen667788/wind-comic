'use client';

/**
 * /dashboard/jobs (v10.4.2) — 流水线任务队列(进度 / 死信可见,失败任务一键重投)。
 *
 * 队列模式(PIPELINE_QUEUE=1)下 create-stream 改投递执行;本页轮询任务表:
 *   queued/running 看进度阶段,failed 显示 last_error + 「重投」按钮 ——
 *   重投保留 attempts → worker 走断点续跑(已有产物阶段跳过,不重复生成/计费)。
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowsClockwise as RefreshCw, Queue as QueueIcon, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';

interface JobItem {
  id: string;
  type: string;
  projectId: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  step: string;
  attempts: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  ideaPreview: string;
}

const STATE_META: Record<JobItem['state'], { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  running: { label: '执行中', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  done: { label: '已完成', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  failed: { label: '失败(死信)', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

const STEP_LABEL: Record<string, string> = {
  director: '导演分析', styleBible: '画风锚点', writer: '剧本', design: '角色/场景',
  storyboardPlan: '分镜规划', storyboardRender: '分镜渲染', video: '镜头视频',
  editor: '剪辑合成', review: '制片审核', finalize: '收尾',
};

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [workerActive, setWorkerActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline-jobs', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
      setWorkerActive(!!data.workerActive);
    } catch { /* 网络抖动忽略,下个轮询周期再试 */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await fetch(`/api/pipeline-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: authHeaders() });
      await refresh();
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1.5">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <QueueIcon className="w-5 h-5 text-[#E8C547]" /> 任务队列
        </h1>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/70 border border-[var(--border)] hover:border-[var(--border-hover)] hover:text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        流水线进度与死信可见;失败任务可一键重投 —— 续跑只补缺失阶段,不重复生成已出产物。
      </p>

      {!workerActive && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-200 text-sm">
          当前未启用队列模式(<code className="text-amber-100">PIPELINE_QUEUE=1</code>)— 创作走请求内联执行;重投的任务会入队等待队列模式开启。
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 加载中…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-white/60 text-sm py-16 text-center border border-dashed border-[var(--border)] rounded-2xl">
          暂无任务记录。队列模式下在创作工坊 ROLL 即产生任务。
        </div>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((j) => {
            const meta = STATE_META[j.state];
            return (
              <div key={j.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[11px] text-white/60 font-mono">{j.id}</span>
                  {j.step && (
                    <span className="text-[11px] text-white/70">阶段:{STEP_LABEL[j.step] || j.step}</span>
                  )}
                  <span className="text-[11px] text-white/60">尝试 {j.attempts} 次</span>
                  <span className="text-[11px] text-white/60 ml-auto">{new Date(j.updatedAt || j.createdAt).toLocaleString()}</span>
                </div>
                {j.ideaPreview && (
                  <p className="mt-1.5 text-xs text-white/70 truncate">{j.ideaPreview}</p>
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/projects/${encodeURIComponent(j.projectId)}`}
                    className="text-[11px] text-[#E8C547] hover:underline"
                  >
                    查看项目 →
                  </Link>
                  {j.state === 'failed' && (
                    <>
                      <span className="text-[11px] text-rose-300/90 truncate max-w-[50%]" title={j.lastError}>
                        {j.lastError || '未知错误'}
                      </span>
                      <button
                        onClick={() => retry(j.id)}
                        disabled={retrying === j.id}
                        className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-[#E8C547] text-[#0C0C0C] hover:bg-[#D4A830] disabled:opacity-50 transition-colors"
                      >
                        {retrying === j.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        重投(断点续跑)
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
