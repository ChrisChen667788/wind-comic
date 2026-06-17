import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { runCreatePipeline, activeOrchestrators, type CreatePipelineInput } from '@/lib/create-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// v10.4.1: 流水线本体移至 lib/create-pipeline(可被请求内联或队列 worker 调用)。
// gate / rerun / regenerate 路由仍从本模块 import 注册表 → re-export 保持路径不变。
export { activeOrchestrators };

export async function POST(request: NextRequest) {
  const { idea: rawIdea, videoProvider, style, duration, aspect, projectId: clientProjectId, isPreset, enableGates, templateId, primaryCharacterRef, lockedCharacters, cameraDefault, previewSeedImage, references, editStyle } = await request.json();

  if (!rawIdea || !rawIdea.trim()) {
    return new Response(JSON.stringify({ error: '请提供故事创意' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // v12.4.1: 预算硬上限护栏 —— 主创作链路接入(此前只 preview-shot 接,主管线零拦截)。
  // 放在任何 LLM 调用(下面 normalizeIdea 扩写)之前 → 超限前不发生任何费用(成本红线)。
  // 仅对已登录用户生效;无预算上限的用户 assertBudget 永远放行,实际是 no-op。
  {
    const { getUserFromRequest } = await import('@/app/api/auth/lib');
    const uid = getUserFromRequest(request)?.sub;
    if (uid) {
      const { assertBudget } = await import('@/lib/budget-enforce');
      const b = await assertBudget({ userId: uid, pendingCostCny: 6 }); // 整片粗估 ~¥6
      if (!b.allow) {
        return new Response(JSON.stringify({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }), { status: 402, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }

  // v2.18: idea 预处理 — 规则清洗 + (信息不足时) LLM 扩写
  // 这一步在安全闸门之前, 让闸门看到的是已清洗 + 已扩写的版本 (规则更准, 扩写不引入有害词)
  // v10.4.0: MOCK_ENGINES=1 全封闭(hermetic)— 跳过 LLM 扩写,只走规则清洗(零外部调用、确定性)
  const { normalizeIdea } = await import('@/lib/idea-normalizer');
  const normalized = await normalizeIdea(rawIdea, { ruleOnly: process.env.MOCK_ENGINES === '1' });
  if (normalized.didLlmExpand) {
    console.log(`[create-stream] idea LLM-expanded: "${rawIdea.slice(0, 60)}..." → "${normalized.normalized.slice(0, 60)}..."`);
  }

  // v2.18.1: thin-idea guard — 拒绝几乎肯定会产出占位内容的输入
  //   - < 10 字 → 一票否决 (任何 LLM 也救不动 2-9 字的 idea)
  //   - 10-30 字且没识别出题材 → 拒绝, 让用户补线索
  // (有 genre 信号的 30+ 字 / 30+ 字无 genre 都允许 — 给 LLM 充分发挥)
  const finalIdea = (normalized.normalized || rawIdea).trim();
  const hardTooShort = finalIdea.length < 10;
  const softThin = finalIdea.length < 30 && normalized.detectedGenres.length === 0;
  if (hardTooShort || softThin) {
    const reason = hardTooShort
      ? `创意只有 ${finalIdea.length} 字 — 即使是题材关键词也至少需要 10 字才能构成完整意图`
      : `创意 ${finalIdea.length} 字且没识别出题材线索, 直接生成会得到占位内容`;
    return new Response(
      JSON.stringify({
        error:
          reason + '. 建议补充至少 30 字的具体设定: 主角是谁, 在什么时空, 面对什么冲突. ' +
          '或者点 "🎬 试拍 1 镜" 先看 vibe, 选个故事模板补足设定再开机.',
        category: 'thin-idea',
        normalizedLength: finalIdea.length,
        detectedGenres: normalized.detectedGenres,
        normalizeHint: normalized.hint,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // v2.13.4: 安全闸门 — 拒绝注入 / 越界 / 有害,脱敏 PII,长度 cap
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(normalized.normalized || rawIdea, { task: 'creation' });
  if (!verdict.ok) {
    console.warn(`[create-stream] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return new Response(
      JSON.stringify({
        error: verdict.userMessage,
        category: verdict.category,
        reason: verdict.reason,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // v2.13.4: 增强模糊创意 → 加专业制作要求
  const { enhanceIdeaForCreation } = await import('@/lib/prompt-templates');
  const { enhancedIdea, hint } = enhanceIdeaForCreation(verdict.sanitized);
  if (verdict.warnings.length > 0) console.log(`[create-stream] sanitize warnings: ${verdict.warnings.join(' | ')}`);
  console.log(`[create-stream] prompt-engineering applied: ${hint} | normalize-hint: ${normalized.hint}`);
  const idea = enhancedIdea;

  const projectId = clientProjectId || nanoid();
  const input: CreatePipelineInput = {
    idea, projectId, videoProvider, style, aspect, enableGates, templateId,
    primaryCharacterRef, lockedCharacters, cameraDefault, previewSeedImage, references,
    editStyle, // v12.0.4 一句指令调剪辑风格
  };
  const encoder = new TextEncoder();
  const sseHeaders = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' };

  // ── v10.4.1 队列路径(PIPELINE_QUEUE=1 灰度):投递任务,SSE 只做「订阅 + 回放」──
  // 客户端断开不再杀流水线;kill -9 重启后 worker 续跑(任务表恢复)。
  if (process.env.PIPELINE_QUEUE === '1') {
    const { enqueuePipelineJob, getJobProgressLog } = await import('@/lib/repos/pipeline-job-repo');
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    const { subscribe, pipelineChannel } = await import('@/lib/event-bus');
    const job = await enqueuePipelineJob({ type: 'create', projectId, payload: input });
    ensurePipelineWorker();
    const stream = new ReadableStream({
      start(controller) {
        const send = (type: string, data: unknown) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch {}
        };
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          unsub();
          try { controller.close(); } catch {}
        };
        const unsub = subscribe(pipelineChannel(job.id), (ev) => {
          if (ev.type === '__jobDone') { close(); return; }
          send(ev.type, (ev as { data?: unknown }).data);
        });
        send('jobQueued', { jobId: job.id, projectId });
        // 回放已落库进度(同请求内 enqueue→subscribe 间隔 < worker tick,通常为空;
        // 为未来「断线重连到既有 job」保留 —— 偶发与 live 事件重复对客户端是幂等 set)
        void getJobProgressLog(job.id)
          .then((log) => { for (const ev of log) send(ev.type, ev.data); })
          .catch(() => {});
        request.signal.addEventListener('abort', close);
      },
    });
    return new Response(stream, { headers: sseHeaders });
  }

  // ── 旧路径(默认):请求内联执行,行为与提取前一致 ──
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch {}
      };
      await runCreatePipeline(input, send);
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders });
}
