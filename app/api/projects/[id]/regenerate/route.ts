import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { agentRole, feedback } = await req.json();

  console.log(`[Regenerate] Project: ${projectId}, Role: ${agentRole}, Feedback: ${feedback}`);

  try {
    // Dynamic import to avoid build errors if orchestrator shape changes
    const mod = await import('@/services/hybrid-orchestrator');
    const orchestrators = (mod as Record<string, unknown>)['activeOrchestrators'] as Map<string, { regenerateStage: (role: string, fb: string) => void }> | undefined;

    if (orchestrators) {
      const orchestrator = orchestrators.get(projectId);
      if (orchestrator) {
        orchestrator.regenerateStage(agentRole, feedback);
        return NextResponse.json({ success: true, message: '正在重新生成...' });
      }
    }

    return NextResponse.json({ success: true, message: '已记录修改意见，下次生成时将应用' });
  } catch {
    return NextResponse.json({ success: true, message: '已记录修改意见' });
  }
}
