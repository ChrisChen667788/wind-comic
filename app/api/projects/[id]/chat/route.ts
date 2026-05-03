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
  const { agentRole, message: rawMessage } = await request.json();

  if (!rawMessage?.trim()) {
    return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // v2.13.4: agent chat 也走安全闸门 + 上下文增强(让 LLM 知道这是项目内 chat,不是通用助手)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawMessage, { task: 'chat' });
  if (!verdict.ok) {
    console.warn(`[chat] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return new Response(
      JSON.stringify({ error: verdict.userMessage, category: verdict.category }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // 拉项目标题给 prompt 增强
  let projectTitle: string | undefined = undefined;
  try {
    const { db } = await import('@/lib/db');
    const row = db.prepare('SELECT title FROM projects WHERE id = ?').get(projectId) as { title?: string } | undefined;
    projectTitle = row?.title || undefined;
  } catch { /* ignore */ }
  const { enhanceChatMessage } = await import('@/lib/prompt-templates');
  const message = enhanceChatMessage(verdict.sanitized, projectTitle);

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
