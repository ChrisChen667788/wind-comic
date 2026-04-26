import { NextRequest, NextResponse } from 'next/server';
import { activeOrchestrators } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { projectId, gateId, action, editedData } = await request.json();

  if (!projectId || !gateId) {
    return NextResponse.json({ error: 'projectId and gateId are required' }, { status: 400 });
  }

  const orchestrator = activeOrchestrators.get(projectId);
  if (!orchestrator) {
    return NextResponse.json({ error: 'No active session' }, { status: 404 });
  }

  orchestrator.resolveGate(gateId, { action, editedData });
  return NextResponse.json({ ok: true });
}
