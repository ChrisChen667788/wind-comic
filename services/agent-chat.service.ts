import OpenAI from 'openai';
import { API_CONFIG } from '@/lib/config';
import { AgentRole } from '@/types/agents';

// 每个 Agent 的 system prompt
const AGENT_PROMPTS: Record<string, string> = {
  [AgentRole.WRITER]: `你是一位专业的AI编剧。你负责创作剧本、对白、世界观和剧情钩子。
用户可能会要求你：修改剧本、调整剧情、优化对白、添加/删除角色、调整分镜描述。
回复时请简洁专业，如果涉及具体修改，请明确说明修改内容。
当用户要求修改分镜描述时，输出修改后的完整分镜描述。`,

  [AgentRole.CHARACTER_DESIGNER]: `你是一位AI角色设计师。你负责根据角色小传生成角色视觉资产。
用户可能会要求你：重新生成角色图、调整角色外观、添加新角色设计。
回复时描述你将如何调整角色设计，并生成详细的视觉提示词。`,

  [AgentRole.SCENE_DESIGNER]: `你是一位AI场景设计师。你负责生成场景概念图。
用户可能会要求你：生成新场景、修改场景风格、调整场景细节。
回复时描述场景设计方案。`,

  [AgentRole.STORYBOARD]: `你是一位AI分镜师。你负责构思分镜描述和生成分镜视频。每个镜头约8-10秒。
用户可能会要求你：
- 重新生成某个分镜的视频（如"帮我重新生成分镜18的视频，时长15秒"）
- 修改分镜描述
- 调整镜头时长
当用户要求重新生成视频时，请确认镜头编号和时长，然后执行重生成。
回复格式示例：
"好的，我将为您重新生成分镜18的视频，并将其时长设置为15秒。"`,

  [AgentRole.VIDEO_PRODUCER]: `你是一位AI视频制作人。你负责逐段分镜视频的生成和质量控制。
用户可能会要求你：调整视频参数、切换视频引擎、批量重新生成。`,

  [AgentRole.DIRECTOR]: `你是一位AI导演。你负责审核整体创作质量，对比初始需求和当前产出，提出改进意见。
审核时请从以下维度评估：
1. 剧情连贯性
2. 角色一致性
3. 视觉风格统一性
4. 节奏把控
5. 情感表达
给出1-10的评分和具体改进建议，指明需要返工的环节。`,

  [AgentRole.EDITOR]: `你是一位AI剪辑师。你负责调整剪辑顺序、合成完整视频demo。
用户可能会要求你：调整镜头顺序、添加转场、调整节奏。`,
};

// 解析 Agent 回复中的操作意图
interface AgentAction {
  type: 'regenerate_shot' | 'update_script' | 'update_character' | 'director_review' | 'none';
  params: Record<string, any>;
}

function parseAgentAction(agentRole: AgentRole, content: string): AgentAction {
  // 分镜师：检测重生成视频的意图
  if (agentRole === AgentRole.STORYBOARD || agentRole === AgentRole.VIDEO_PRODUCER) {
    const regenMatch = content.match(/重新生成.*?分镜\s*(\d+).*?时长.*?(\d+)\s*秒/);
    if (regenMatch) {
      return {
        type: 'regenerate_shot',
        params: { shotNumber: parseInt(regenMatch[1]), duration: parseInt(regenMatch[2]) },
      };
    }
    const regenMatch2 = content.match(/分镜\s*(\d+).*?重新生成/);
    if (regenMatch2) {
      return {
        type: 'regenerate_shot',
        params: { shotNumber: parseInt(regenMatch2[1]) },
      };
    }
  }

  return { type: 'none', params: {} };
}

export class AgentChatService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: API_CONFIG.openai.baseURL,
    });
  }

  async *chat(
    agentRole: AgentRole,
    userMessage: string,
    context: {
      projectId: string;
      scriptData?: any;
      characters?: any[];
      storyboards?: any[];
      chatHistory?: { role: string; content: string }[];
    }
  ): AsyncGenerator<{ type: string; content?: string; action?: AgentAction }> {
    const systemPrompt = AGENT_PROMPTS[agentRole] || '你是一位AI助手。';

    // 构建上下文
    let contextStr = '';
    if (context.scriptData) {
      contextStr += `\n\n当前剧本：${JSON.stringify(context.scriptData).slice(0, 2000)}`;
    }
    if (context.characters?.length) {
      contextStr += `\n\n当前角色：${context.characters.map(c => `${c.name}: ${c.description || c.data?.description || ''}`).join('; ')}`;
    }
    if (context.storyboards?.length) {
      contextStr += `\n\n当前分镜数量：${context.storyboards.length}个`;
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt + contextStr },
    ];

    // 添加历史对话（最近10条）
    if (context.chatHistory?.length) {
      const recent = context.chatHistory.slice(-10);
      for (const msg of recent) {
        messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
      }
    }

    messages.push({ role: 'user', content: userMessage });

    try {
      const stream = await this.openai.chat.completions.create({
        model: API_CONFIG.openai.model,
        messages,
        stream: true,
      });

      let fullContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          yield { type: 'content', content: delta };
        }
      }

      // 解析操作意图
      const action = parseAgentAction(agentRole, fullContent);
      if (action.type !== 'none') {
        yield { type: 'action', action };
      }
    } catch (error) {
      yield { type: 'content', content: `抱歉，出现了错误: ${error instanceof Error ? error.message : '未知错误'}` };
    }
  }
}

// Demo 模式的 chat service
export class DemoChatService {
  private responses: Record<string, string[]> = {
    [AgentRole.WRITER]: [
      '好的，我来调整剧本。',
      '已更新对白内容，新的对白更加贴合角色性格。',
      '剧情钩子已加强，在第3镜增加了悬念转折。',
    ],
    [AgentRole.CHARACTER_DESIGNER]: [
      '收到，我将重新设计这个角色的外观。',
      '角色设计已更新，增加了更多细节。',
    ],
    [AgentRole.STORYBOARD]: [
      '好的，我将为您重新生成这个分镜对应的视频。',
      '分镜视频已成功重新生成，时长已调整。请检查生成效果。',
    ],
    [AgentRole.DIRECTOR]: [
      '整体质量不错，但有几个地方需要优化：\n1. 镜头3的节奏偏快\n2. 角色表情需要更丰富\n3. 结尾转场可以更流畅',
    ],
    [AgentRole.SCENE_DESIGNER]: ['场景概念图已更新。'],
    [AgentRole.VIDEO_PRODUCER]: ['视频参数已调整。'],
    [AgentRole.EDITOR]: ['剪辑顺序已调整。'],
  };

  async *chat(
    agentRole: AgentRole,
    userMessage: string,
    _context: any
  ): AsyncGenerator<{ type: string; content?: string; action?: AgentAction }> {
    const pool = this.responses[agentRole] || ['收到，正在处理...'];
    const response = pool[Math.floor(Math.random() * pool.length)];

    // 模拟思考
    yield { type: 'thinking', content: `分析用户请求: "${userMessage.slice(0, 50)}"...\n确定操作类型...\n准备响应...` };

    // 逐字输出
    for (let i = 0; i < response.length; i++) {
      await new Promise(r => setTimeout(r, 30));
      yield { type: 'content', content: response[i] };
    }

    // 检测重生成意图
    const shotMatch = userMessage.match(/分镜\s*(\d+)/);
    const durationMatch = userMessage.match(/时长\s*(\d+)/);
    if (shotMatch && (userMessage.includes('重新生成') || userMessage.includes('重生成'))) {
      yield {
        type: 'action',
        action: {
          type: 'regenerate_shot',
          params: {
            shotNumber: parseInt(shotMatch[1]),
            duration: durationMatch ? parseInt(durationMatch[1]) : undefined,
          },
        },
      };
    }
  }
}
