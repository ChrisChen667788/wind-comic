import { NextRequest, NextResponse } from 'next/server';
import { DemoOrchestrator, isDemoMode } from '@/services/demo-orchestrator';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';

export async function POST(request: NextRequest) {
  // v12.388:这条路由**完全没有鉴权** —— 裸 curl 一个 { idea } 就能在生产模式下
  // 跑通整条 AI 制片管线:脚本 LLM → 分镜出图 → 视频生成,单次至少 ¥5–30,
  // 全部记在 owner 账上,且无预算上限、无频控,循环调用可以把余额烧干。
  //
  // 它还是条**遗留死路**:全仓搜下来前端零调用者(实际入口是 /api/create-stream),
  // 也就是说它只对外部攻击者可见。没有直接删,是因为删除不可逆、也可能有我不知道的
  // 外部调用方;加上守卫后它至少不再是敞开的口子。若确认无人使用,可以安全移除。
  const _paid = await guardPaidEndpoint(request, { pendingCostCny: 8 });
  if (!_paid.ok) return _paid.response;

  try {
    const { idea, videoProvider } = await request.json();

    if (!idea || !idea.trim()) {
      return NextResponse.json({ error: '请提供故事创意' }, { status: 400 });
    }

    let orchestrator: any;
    if (isDemoMode()) {
      orchestrator = new DemoOrchestrator();
    } else {
      const { AgentOrchestrator } = await import('@/services/agent-orchestrator');
      orchestrator = new AgentOrchestrator();
    }

    const result = await orchestrator.startProduction(idea, videoProvider);

    return NextResponse.json({
      success: true,
      demo: isDemoMode(),
      data: result,
      agents: orchestrator.getAllAgents(),
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创作失败' },
      { status: 500 }
    );
  }
}
