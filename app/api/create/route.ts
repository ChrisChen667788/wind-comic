import { NextRequest, NextResponse } from 'next/server';
import { DemoOrchestrator, isDemoMode } from '@/services/demo-orchestrator';

export async function POST(request: NextRequest) {
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
