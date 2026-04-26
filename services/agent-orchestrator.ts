import OpenAI from 'openai';
import { API_CONFIG } from '@/lib/config';
import {
  Agent,
  AgentRole,
  DirectorPlan,
  Script,
  Character,
  Storyboard,
  VideoClip
} from '@/types/agents';
import { OpenAIImageService } from './openai-image.service';
import { MinimaxService } from './minimax.service';
import { ViduService } from './vidu.service';
import { KelingService } from './keling.service';
import { VeoService, hasVeo } from './veo.service';

export class AgentOrchestrator {
  private agents: Map<AgentRole, Agent>;
  private openai: OpenAI;
  private imageService: OpenAIImageService;
  private minimaxService: MinimaxService;
  private viduService: ViduService;
  private kelingService: KelingService;
  private veoService: VeoService | null;

  constructor() {
    this.openai = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: API_CONFIG.openai.baseURL,
    });
    this.imageService = new OpenAIImageService();
    this.minimaxService = new MinimaxService();
    this.viduService = new ViduService();
    this.kelingService = new KelingService();
    this.veoService = hasVeo() ? new VeoService() : null;
    this.agents = new Map();
    this.initializeAgents();
  }

  // 初始化所有 Agent
  private initializeAgents() {
    this.agents = new Map([
      [AgentRole.DIRECTOR, {
        id: 'director-001',
        role: AgentRole.DIRECTOR,
        name: '张导',
        avatar: '/avatars/director.png',
        status: 'idle',
        progress: 0
      }],
      [AgentRole.WRITER, {
        id: 'writer-001',
        role: AgentRole.WRITER,
        name: '李编剧',
        avatar: '/avatars/writer.png',
        status: 'idle',
        progress: 0
      }],
      [AgentRole.CHARACTER_DESIGNER, {
        id: 'character-001',
        role: AgentRole.CHARACTER_DESIGNER,
        name: '王设计师',
        avatar: '/avatars/character.png',
        status: 'idle',
        progress: 0
      }],
      [AgentRole.STORYBOARD, {
        id: 'storyboard-001',
        role: AgentRole.STORYBOARD,
        name: '赵分镜师',
        avatar: '/avatars/storyboard.png',
        status: 'idle',
        progress: 0
      }],
    ]);
  }

  // 获取 Agent
  getAgent(role: AgentRole): Agent | undefined {
    return this.agents.get(role);
  }

  // 获取所有 Agent
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // 更新 Agent 状态
  updateAgent(role: AgentRole, updates: Partial<Agent>) {
    const agent = this.agents.get(role);
    if (agent) {
      Object.assign(agent, updates);
    }
  }

  // 开始创作流程
  async startProduction(userIdea: string, videoProvider: string) {
    try {
      // 1. AI 导演分析需求
      const plan = await this.runDirector(userIdea);

      // 2. AI 编剧创作剧本
      const script = await this.runWriter(plan);

      // 3. AI 角色设计师设计角色
      const characters = await this.runCharacterDesigner(plan.characters);

      // 4. AI 分镜师绘制分镜
      const storyboards = await this.runStoryboardArtist(script, characters);

      // 5. AI 视频制作生成视频
      const videos = await this.runVideoProducer(storyboards, videoProvider);

      return {
        plan,
        script,
        characters,
        storyboards,
        videos
      };
    } catch (error) {
      console.error('Production error:', error);
      throw error;
    }
  }

  // AI 导演：统筹规划
  async runDirector(userIdea: string): Promise<DirectorPlan> {
    const agent = this.agents.get(AgentRole.DIRECTOR);
    if (!agent) throw new Error('Director agent not found');

    try {
      agent.status = 'thinking';
      agent.currentTask = '分析创意，制定拍摄计划';
      agent.progress = 10;

      const response = await this.openai.chat.completions.create({
        model: API_CONFIG.openai.model,
        messages: [{
          role: 'system',
          content: `你是一位经验丰富的 AI 导演。根据用户的创意，制定详细的制作计划。

输出 JSON 格式：
{
  "genre": "类型（爱情/悬疑/科幻等）",
  "style": "风格（写实/动漫/水墨等）",
  "characters": [{"name": "角色名", "description": "详细外观和性格描述"}],
  "scenes": [{"name": "场景名", "description": "详细场景描述"}],
  "storyStructure": {
    "acts": 3,
    "totalShots": 8
  }
}`
        }, {
          role: 'user',
          content: userIdea
        }],
        response_format: { type: 'json_object' }
      });

      const plan = JSON.parse(response.choices[0].message.content || '{}');

      agent.status = 'completed';
      agent.progress = 100;
      agent.output = plan;

      return plan as DirectorPlan;
    } catch (error) {
      agent.status = 'error';
      agent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  // AI 编剧：创作剧本
  async runWriter(plan: DirectorPlan): Promise<Script> {
    const agent = this.agents.get(AgentRole.WRITER);
    if (!agent) throw new Error('Writer agent not found');

    try {
      agent.status = 'working';
      agent.currentTask = '创作剧本和对话';
      agent.progress = 10;

      const response = await this.openai.chat.completions.create({
        model: API_CONFIG.openai.model,
        messages: [{
          role: 'system',
          content: `你是一位专业的 AI 编剧。根据导演的计划，创作详细的剧本。

输出 JSON 格式：
{
  "title": "标题",
  "synopsis": "简介",
  "shots": [
    {
      "shotNumber": 1,
      "sceneDescription": "场景描述",
      "characters": ["角色A", "角色B"],
      "dialogue": "对话内容",
      "action": "动作描述",
      "emotion": "情绪氛围"
    }
  ]
}`
        }, {
          role: 'user',
          content: JSON.stringify(plan)
        }],
        response_format: { type: 'json_object' }
      });

      const script = JSON.parse(response.choices[0].message.content || '{}');

      agent.status = 'completed';
      agent.progress = 100;
      agent.output = script;

      return script as Script;
    } catch (error) {
      agent.status = 'error';
      agent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  // AI 角色设计师：设计角色
  async runCharacterDesigner(characters: Character[]): Promise<any> {
    const agent = this.agents.get(AgentRole.CHARACTER_DESIGNER);
    if (!agent) throw new Error('Character designer agent not found');

    try {
      agent.status = 'working';
      agent.currentTask = `设计 ${characters.length} 个角色`;
      agent.progress = 0;

      const characterImages = [];

      for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        agent.currentTask = `设计角色：${char.name}`;
        agent.progress = Math.round(((i + 1) / characters.length) * 100);

        // 生成详细的视觉描述
        const visualDesc = await this.openai.chat.completions.create({
          model: API_CONFIG.openai.model,
          messages: [{
            role: 'system',
            content: '你是角色设计师。将角色描述转换为详细的视觉提示词（英文）。'
          }, {
            role: 'user',
            content: `角色：${char.name}\n描述：${char.description}`
          }]
        });

        const prompt = visualDesc.choices[0].message.content || '';

        // 使用 OpenAI 生成角色图片
        const imageUrl = await this.imageService.generateImage(prompt, {
          size: '1024x1024',
          quality: 'medium',
        });

        characterImages.push({
          character: char.name,
          prompt: prompt,
          imageUrl: imageUrl
        });
      }

      agent.status = 'completed';
      agent.progress = 100;
      agent.output = characterImages;

      return characterImages;
    } catch (error) {
      agent.status = 'error';
      agent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  // AI 分镜师：绘制分镜图
  async runStoryboardArtist(script: Script, characters: any[]): Promise<Storyboard[]> {
    const agent = this.agents.get(AgentRole.STORYBOARD);
    if (!agent) throw new Error('Storyboard agent not found');

    try {
      agent.status = 'working';
      agent.currentTask = `绘制 ${script.shots.length} 个分镜`;
      agent.progress = 0;

      const storyboards: Storyboard[] = [];

      for (let i = 0; i < script.shots.length; i++) {
        const shot = script.shots[i];
        agent.currentTask = `绘制第 ${shot.shotNumber} 镜`;
        agent.progress = Math.round(((i + 1) / script.shots.length) * 100);

        // 构建分镜提示词
        const characterPrompts = shot.characters
          .map(name => {
            const char = characters.find(c => c.character === name);
            return char ? char.prompt : name;
          })
          .join(', ');

        const storyboardPrompt = `${characterPrompts}, ${shot.sceneDescription}, ${shot.action}, ${shot.emotion}, cinematic composition, storyboard style`;

        // 使用 OpenAI 生成分镜图
        const imageUrl = await this.imageService.generateImage(storyboardPrompt, {
          size: '1536x1024',
          quality: 'medium',
        });

        storyboards.push({
          shotNumber: shot.shotNumber,
          imageUrl: imageUrl,
          prompt: storyboardPrompt
        });
      }

      agent.status = 'completed';
      agent.progress = 100;
      agent.output = storyboards;

      return storyboards;
    } catch (error) {
      agent.status = 'error';
      agent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  // AI 视频制作：生成视频片段
  async runVideoProducer(storyboards: Storyboard[], videoProvider: string): Promise<VideoClip[]> {
    const agent = this.agents.get(AgentRole.VIDEO_PRODUCER);
    if (!agent) {
      // 如果没有视频制作 Agent，创建一个
      this.agents.set(AgentRole.VIDEO_PRODUCER, {
        id: 'video-001',
        role: AgentRole.VIDEO_PRODUCER,
        name: '孙制作',
        avatar: '/avatars/video.png',
        status: 'idle',
        progress: 0
      });
    }

    const videoAgent = this.agents.get(AgentRole.VIDEO_PRODUCER)!;

    try {
      videoAgent.status = 'working';
      videoAgent.currentTask = `制作 ${storyboards.length} 个视频片段`;
      videoAgent.progress = 0;

      const videos: VideoClip[] = [];

      for (let i = 0; i < storyboards.length; i++) {
        const board = storyboards[i];
        videoAgent.currentTask = `制作第 ${board.shotNumber} 镜视频`;
        videoAgent.progress = Math.round(((i + 1) / storyboards.length) * 100);

        let videoUrl: string;

        // 根据用户选择的视频生成引擎
        switch (videoProvider) {
          case 'veo':
          case 'veo3.1':
            if (!this.veoService) throw new Error('VEO_API_KEY is not configured');
            videoUrl = await this.veoService.generateVideo(board.imageUrl, board.prompt, { duration: 8 });
            break;
          case 'minimax':
            videoUrl = await this.minimaxService.generateVideo(board.imageUrl, board.prompt);
            break;
          case 'vidu':
            videoUrl = await this.viduService.generateVideo(board.imageUrl, board.prompt);
            break;
          case 'keling':
            videoUrl = await this.kelingService.generateVideo(board.imageUrl, board.prompt);
            break;
          default:
            // Default to veo if available, else minimax
            if (this.veoService) {
              videoUrl = await this.veoService.generateVideo(board.imageUrl, board.prompt, { duration: 8 });
            } else {
              videoUrl = await this.minimaxService.generateVideo(board.imageUrl, board.prompt);
            }
        }

        videos.push({
          shotNumber: board.shotNumber,
          videoUrl: videoUrl
        });
      }

      videoAgent.status = 'completed';
      videoAgent.progress = 100;
      videoAgent.output = videos;

      return videos;
    } catch (error) {
      videoAgent.status = 'error';
      videoAgent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  // 单个分镜视频重生成
  async regenerateShot(
    storyboard: Storyboard,
    videoProvider: string,
    options?: { duration?: number; description?: string }
  ): Promise<VideoClip> {
    const videoAgent = this.agents.get(AgentRole.VIDEO_PRODUCER);
    if (videoAgent) {
      videoAgent.status = 'working';
      videoAgent.currentTask = `重新生成第 ${storyboard.shotNumber} 镜视频`;
      videoAgent.progress = 0;
    }

    try {
      const prompt = options?.description || storyboard.prompt;
      let videoUrl: string;

      switch (videoProvider) {
        case 'minimax':
          videoUrl = await this.minimaxService.generateVideo(storyboard.imageUrl, prompt);
          break;
        case 'vidu':
          videoUrl = await this.viduService.generateVideo(storyboard.imageUrl, prompt);
          break;
        case 'keling':
          videoUrl = await this.kelingService.generateVideo(storyboard.imageUrl, prompt);
          break;
        default:
          throw new Error(`Unknown video provider: ${videoProvider}`);
      }

      if (videoAgent) {
        videoAgent.status = 'completed';
        videoAgent.progress = 100;
      }

      return {
        shotNumber: storyboard.shotNumber,
        videoUrl,
        duration: options?.duration || 10,
        status: 'completed',
      };
    } catch (error) {
      if (videoAgent) {
        videoAgent.status = 'error';
        videoAgent.error = error instanceof Error ? error.message : 'Unknown error';
      }
      throw error;
    }
  }

  // 导演审核
  async runDirectorReview(
    userIdea: string,
    script: Script,
    characters: any[],
    storyboards: Storyboard[],
    videos: VideoClip[]
  ): Promise<any> {
    const agent = this.agents.get(AgentRole.DIRECTOR);
    if (!agent) throw new Error('Director agent not found');

    try {
      agent.status = 'thinking';
      agent.currentTask = '审核整体创作质量';
      agent.progress = 10;

      const response = await this.openai.chat.completions.create({
        model: API_CONFIG.openai.model,
        messages: [{
          role: 'system',
          content: `你是一位经验丰富的AI导演。请审核当前项目的整体创作质量。

对比初始需求和当前产出，从以下维度评估：
1. 剧情连贯性
2. 角色一致性
3. 视觉风格统一性
4. 节奏把控
5. 情感表达

输出 JSON 格式：
{
  "overallScore": 7.5,
  "summary": "整体评价",
  "items": [
    {
      "shotNumber": 3,
      "targetRole": "storyboard",
      "issue": "问题描述",
      "suggestion": "改进建议",
      "severity": "major"
    }
  ]
}`
        }, {
          role: 'user',
          content: `初始需求：${userIdea}\n\n剧本：${JSON.stringify(script).slice(0, 2000)}\n\n角色数量：${characters.length}\n\n分镜数量：${storyboards.length}\n\n视频数量：${videos.length}`
        }],
        response_format: { type: 'json_object' }
      });

      const review = JSON.parse(response.choices[0].message.content || '{}');

      agent.status = 'completed';
      agent.progress = 100;
      agent.output = review;

      return {
        id: `review-${Date.now()}`,
        ...review,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      agent.status = 'error';
      agent.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }
}
