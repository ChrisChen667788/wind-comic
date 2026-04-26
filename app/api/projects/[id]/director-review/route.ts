import { NextRequest, NextResponse } from 'next/server';
import { isDemoMode } from '@/services/demo-orchestrator';
import { AgentRole } from '@/types/agents';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 从数据库加载项目资产,构造导演审核所需的上下文快照。
 * 只抽取关键字段,避免把 base64 / media_urls 灌进 prompt。
 */
function loadProjectContext(projectId: string): {
  title: string;
  script: any;
  characters: any[];
  scenes: any[];
  storyboards: any[];
  videoCount: number;
} | null {
  try {
    const project = db.prepare('SELECT id, title FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return null;

    const rows = db.prepare(
      `SELECT type, name, data, shot_number FROM project_assets WHERE project_id = ? ORDER BY type, shot_number`
    ).all(projectId) as Array<{ type: string; name: string; data: string; shot_number: number | null }>;

    const script = rows.find(r => r.type === 'script');
    const characters = rows.filter(r => r.type === 'character');
    const scenes = rows.filter(r => r.type === 'scene');
    const storyboards = rows.filter(r => r.type === 'storyboard');
    const videos = rows.filter(r => r.type === 'video');

    const parse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };

    return {
      title: project.title || '未命名项目',
      script: script ? parse(script.data) : null,
      characters: characters.map(c => ({ name: c.name, ...parse(c.data) })),
      scenes: scenes.map(s => ({ name: s.name, ...parse(s.data) })),
      storyboards: storyboards
        .map(sb => ({ shotNumber: sb.shot_number, ...parse(sb.data) }))
        .sort((a, b) => (a.shotNumber || 0) - (b.shotNumber || 0)),
      videoCount: videos.length,
    };
  } catch (e) {
    console.error('[director-review] failed to load project:', e);
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };

      try {
        send('status', { message: '导演正在审核整体质量...' });

        if (isDemoMode()) {
          await new Promise(r => setTimeout(r, 2000));

          const review = {
            id: `review-${Date.now()}`,
            projectId,
            overallScore: 7.5,
            summary: '整体创作质量良好，剧情连贯，角色形象鲜明。但部分分镜的节奏需要调整，建议优化以下几个方面。',
            items: [
              {
                shotNumber: 3,
                targetRole: AgentRole.STORYBOARD,
                issue: '镜头3的节奏偏快，情感铺垫不够',
                suggestion: '延长至12秒，增加角色特写',
                severity: 'major' as const,
              },
              {
                shotNumber: 5,
                targetRole: AgentRole.CHARACTER_DESIGNER,
                issue: '角色在镜头5中的服装与前几镜不一致',
                suggestion: '重新生成角色在该场景的设计图',
                severity: 'minor' as const,
              },
              {
                targetRole: AgentRole.WRITER,
                issue: '结尾对白略显生硬',
                suggestion: '优化最后两镜的对白，增加情感深度',
                severity: 'minor' as const,
              },
            ],
            status: 'pending' as const,
            createdAt: new Date().toISOString(),
          };

          send('review', review);
        } else {
          // 真实模式：从数据库加载项目完整数据，调用导演 Agent 审核
          const projectContext = loadProjectContext(projectId);
          if (!projectContext) {
            send('error', { message: '项目不存在或数据不完整' });
            controller.close();
            return;
          }

          send('status', {
            message: `导演正在审核「${projectContext.title}」(${projectContext.characters.length}角色/${projectContext.scenes.length}场景/${projectContext.storyboards.length}分镜/${projectContext.videoCount}视频)...`
          });

          const { AgentChatService } = await import('@/services/agent-chat.service');
          const chatService = new AgentChatService();

          // 构造审核 prompt —— 压缩版项目快照
          const scriptBrief = projectContext.script
            ? `标题:${projectContext.script.title || projectContext.title}\n简介:${(projectContext.script.synopsis || '').slice(0, 500)}\n镜头数:${(projectContext.script.shots || []).length}`
            : '（未生成剧本）';
          const charsBrief = projectContext.characters
            .map((c, i) => `${i + 1}. ${c.name}: ${(c.description || c.appearance || '').slice(0, 120)}`).join('\n') || '（无角色）';
          const storyboardsBrief = projectContext.storyboards.slice(0, 20)
            .map(sb => `镜头${sb.shotNumber}: ${(sb.description || '').slice(0, 150)}`).join('\n') || '（无分镜）';

          const auditPrompt = [
            '请以导演视角审核以下项目,用 JSON 返回 { overallScore:0-100, summary, items:[{shotNumber?, targetRole, issue, suggestion, severity}] }。',
            '',
            '═══ 剧本 ═══',
            scriptBrief,
            '',
            '═══ 角色 ═══',
            charsBrief,
            '',
            '═══ 分镜 ═══',
            storyboardsBrief,
            '',
            `已生成 ${projectContext.videoCount} 个视频片段。`,
          ].join('\n');

          const context = { projectId, chatHistory: [] };
          const generator = chatService.chat(AgentRole.DIRECTOR, auditPrompt, context);

          let fullContent = '';
          for await (const chunk of generator) {
            if (chunk.type === 'content') {
              fullContent += chunk.content || '';
              send('content', { content: chunk.content });
            }
          }

          // 尝试解析 JSON 审核结果
          let parsed: any = null;
          const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { parsed = JSON.parse(jsonMatch[0]); } catch {}
          }

          send('review', {
            id: `review-${Date.now()}`,
            projectId,
            overallScore: parsed?.overallScore ?? 75,
            summary: parsed?.summary || fullContent.slice(0, 500),
            items: Array.isArray(parsed?.items) ? parsed.items : [],
            status: 'pending',
            passed: (parsed?.overallScore ?? 75) >= 75,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : '审核失败' });
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
