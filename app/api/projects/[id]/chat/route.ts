import { NextRequest } from 'next/server';
import { isDemoMode } from '@/services/demo-orchestrator';
import { AgentRole } from '@/types/agents';
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 从数据库加载最近 N 条该 agent 的对话历史,供 LLM 维持上下文 */
function loadChatHistory(projectId: string, agentRole: string, limit = 10): Array<{ role: string; content: string }> {
  try {
    const rows = db.prepare(
      `SELECT role, content FROM chat_messages
       WHERE project_id = ? AND agent_role = ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(projectId, agentRole, limit) as Array<{ role: string; content: string }>;
    return rows.reverse();
  } catch (e) {
    console.warn('[chat] loadChatHistory failed:', e);
    return [];
  }
}

/** 持久化用户消息 / 助手消息 */
function saveChatMessage(projectId: string, agentRole: string, role: 'user' | 'assistant', content: string) {
  try {
    db.prepare(
      `INSERT INTO chat_messages (id, project_id, agent_role, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), projectId, agentRole, role, content, now());
  } catch (e) {
    console.warn('[chat] saveChatMessage failed:', e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { agentRole, message } = await request.json();

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      };

      try {
        let chatService: any;

        if (isDemoMode()) {
          const { DemoChatService } = await import('@/services/agent-chat.service');
          chatService = new DemoChatService();
        } else {
          const { AgentChatService } = await import('@/services/agent-chat.service');
          chatService = new AgentChatService();
        }

        // 从数据库加载最近 10 条该 agent 的对话历史,维持上下文
        const chatHistory = loadChatHistory(projectId, agentRole, 10);
        const context = {
          projectId,
          chatHistory,
        };

        // 记录用户消息（非 demo 模式）
        if (!isDemoMode()) {
          saveChatMessage(projectId, agentRole, 'user', message);
        }

        const generator = chatService.chat(agentRole as AgentRole, message, context);

        let assistantReply = '';
        for await (const chunk of generator) {
          if (chunk.type === 'content') assistantReply += chunk.content || '';
          send(chunk.type, chunk.type === 'action' ? { action: chunk.action } : { content: chunk.content || '' });
        }

        // 记录助手回复
        if (!isDemoMode() && assistantReply.trim()) {
          saveChatMessage(projectId, agentRole, 'assistant', assistantReply);
        }
      } catch (error) {
        send('content', { content: `出错了: ${error instanceof Error ? error.message : '未知错误'}` });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
