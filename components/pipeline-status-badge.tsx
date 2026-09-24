'use client';

/**
 * 创作工坊顶栏的状态行。v12.454。
 *
 * 此前这里**写死**是「创作中」:开机失败(401/403/402/429/断网)或 SSE 报 error 之后,
 * 只弹一个几秒就消失的浮层,顶栏仍旧写着「创作中」、节点仍是「等待编剧完成…」——
 * 与「跑得慢」完全无法区分,用户会一直干等。失败必须**留在界面上**。
 *
 * 状态存在 store 的 `pipelineError`(由 lib/pipeline-failure 写入)。
 * 单独拆成组件是为了能真渲染着测 —— 顶栏整体要 auth / ReactFlow 一堆环境,
 * 而「状态到底显示成什么」正是这一版要保证的事,不能只靠扫源码。
 */
import { useProjectWorkspaceStore } from '@/lib/store';

export function PipelineStatusBadge() {
  const pipelineError = useProjectWorkspaceStore(s => s.pipelineError);
  const isProducing = useProjectWorkspaceStore(s => s.isProducing);

  if (pipelineError) {
    return (
      <div
        data-pipeline-status="error"
        title={pipelineError.message}
        className="text-[10px] text-amber-300/90 font-medium tracking-wider uppercase truncate max-w-[42ch]"
      >
        已中断 · {pipelineError.message}
      </div>
    );
  }
  return (
    <div
      data-pipeline-status={isProducing ? 'running' : 'idle'}
      className="text-[10px] text-white/25 font-medium tracking-wider uppercase"
    >
      创作中
    </div>
  );
}
