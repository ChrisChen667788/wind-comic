import {
  Agent, AgentRole, DirectorPlan, Script, Storyboard, VideoClip, Character
} from '@/types/agents';

// Check if real API keys are configured
const hasOpenAI = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('your_');
const hasBanana = process.env.BANANA_MODEL_KEY && !process.env.BANANA_MODEL_KEY.startsWith('your_');

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function mockSvg(w: number, h: number, c1: string, c2: string, label: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="system-ui" font-size="${Math.min(w, h) * 0.07}">${label}</text></svg>`)}`;
}

export class DemoOrchestrator {
  private agents: Map<AgentRole, Agent>;

  constructor() {
    this.agents = new Map();
    this.initializeAgents();
  }

  private initializeAgents() {
    this.agents = new Map([
      [AgentRole.DIRECTOR, { id: 'director-001', role: AgentRole.DIRECTOR, name: '张导', avatar: '', status: 'idle', progress: 0 }],
      [AgentRole.WRITER, { id: 'writer-001', role: AgentRole.WRITER, name: '李编剧', avatar: '', status: 'idle', progress: 0 }],
      [AgentRole.CHARACTER_DESIGNER, { id: 'character-001', role: AgentRole.CHARACTER_DESIGNER, name: '王设计师', avatar: '', status: 'idle', progress: 0 }],
      [AgentRole.STORYBOARD, { id: 'storyboard-001', role: AgentRole.STORYBOARD, name: '赵分镜师', avatar: '', status: 'idle', progress: 0 }],
      [AgentRole.VIDEO_PRODUCER, { id: 'video-001', role: AgentRole.VIDEO_PRODUCER, name: '孙制作', avatar: '', status: 'idle', progress: 0 }],
    ]);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  private update(role: AgentRole, u: Partial<Agent>) {
    const a = this.agents.get(role);
    if (a) Object.assign(a, u);
  }

  async runDirector(idea: string): Promise<DirectorPlan> {
    this.update(AgentRole.DIRECTOR, { status: 'thinking', currentTask: '分析创意，制定拍摄计划', progress: 10 });
    await sleep(1500);
    this.update(AgentRole.DIRECTOR, { progress: 60 });
    await sleep(1000);

    const plan: DirectorPlan = {
      genre: idea.includes('赛博') ? '科幻' : idea.includes('宫廷') ? '古装' : '奇幻',
      style: '电影感动画',
      characters: [
        { name: '主角', description: '故事的核心人物，性格坚毅', appearance: '' },
        { name: '配角', description: '主角的伙伴，幽默风趣', appearance: '' },
      ],
      scenes: [
        { id: 's1', description: '开场：城市远景', location: '城市' },
        { id: 's2', description: '发展：角色相遇', location: '街道' },
        { id: 's3', description: '高潮：冲突爆发', location: '室内' },
      ],
      storyStructure: { acts: 3, totalShots: 6 },
    };

    this.update(AgentRole.DIRECTOR, { status: 'completed', progress: 100, output: plan });
    return plan;
  }

  async runWriter(plan: DirectorPlan): Promise<Script> {
    this.update(AgentRole.WRITER, { status: 'working', currentTask: '创作剧本和对话', progress: 10 });
    await sleep(2000);
    this.update(AgentRole.WRITER, { progress: 50 });
    await sleep(1500);

    const script: Script = {
      title: `${plan.genre}短片`,
      synopsis: `一部${plan.genre}风格的AI漫剧短片`,
      shots: Array.from({ length: plan.storyStructure.totalShots }, (_, i) => ({
        shotNumber: i + 1,
        sceneDescription: `第${i + 1}镜：${['城市远景，霓虹闪烁', '角色登场，目光坚定', '街道漫步，雨夜氛围', '对话场景，情感交流', '冲突爆发，紧张对峙', '结局画面，余韵悠长'][i] || '过渡镜头'}`,
        characters: [plan.characters[0]?.name || '主角'],
        dialogue: ['', '我们走吧', '', '你相信命运吗？', '这不可能！', ''][i] || '',
        action: ['缓慢推进', '转身', '行走', '对视', '后退', '远去'][i] || '静止',
        emotion: ['宁静', '期待', '忧郁', '温暖', '紧张', '释然'][i] || '平静',
      })),
    };

    this.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
    return script;
  }

  async runCharacterDesigner(characters: Character[]): Promise<any[]> {
    this.update(AgentRole.CHARACTER_DESIGNER, { status: 'working', currentTask: `设计 ${characters.length} 个角色`, progress: 0 });

    const results = [];
    for (let i = 0; i < characters.length; i++) {
      this.update(AgentRole.CHARACTER_DESIGNER, {
        currentTask: `设计角色：${characters[i].name}`,
        progress: Math.round(((i + 1) / characters.length) * 100),
      });
      await sleep(1200);
      results.push({
        character: characters[i].name,
        prompt: `${characters[i].name}, ${characters[i].description}, anime style, detailed`,
        imageUrl: mockSvg(512, 512, ['#6b21a8', '#0e7490', '#b91c1c'][i % 3], ['#ec4899', '#4de0c2', '#fbbf24'][i % 3], characters[i].name),
      });
    }

    this.update(AgentRole.CHARACTER_DESIGNER, { status: 'completed', progress: 100, output: results });
    return results;
  }

  async runStoryboardArtist(script: Script, characters: any[]): Promise<Storyboard[]> {
    this.update(AgentRole.STORYBOARD, { status: 'working', currentTask: `绘制 ${script.shots.length} 个分镜`, progress: 0 });

    const storyboards: Storyboard[] = [];
    const colors: [string, string][] = [
      ['#1e1b4b', '#7c3aed'], ['#0c4a6e', '#06b6d4'], ['#3b0764', '#d946ef'],
      ['#1a2e05', '#84cc16'], ['#4c0519', '#f43f5e'], ['#422006', '#f59e0b'],
    ];

    for (let i = 0; i < script.shots.length; i++) {
      const shot = script.shots[i];
      this.update(AgentRole.STORYBOARD, {
        currentTask: `绘制第 ${shot.shotNumber} 镜`,
        progress: Math.round(((i + 1) / script.shots.length) * 100),
      });
      await sleep(800);

      const [c1, c2] = colors[i % colors.length];
      storyboards.push({
        shotNumber: shot.shotNumber,
        imageUrl: mockSvg(1024, 576, c1, c2, `Shot ${shot.shotNumber}`),
        prompt: `${shot.sceneDescription}, ${shot.action}, ${shot.emotion}, cinematic`,
      });
    }

    this.update(AgentRole.STORYBOARD, { status: 'completed', progress: 100, output: storyboards });
    return storyboards;
  }

  async runVideoProducer(storyboards: Storyboard[], _videoProvider: string): Promise<VideoClip[]> {
    this.update(AgentRole.VIDEO_PRODUCER, { status: 'working', currentTask: `制作 ${storyboards.length} 个视频片段`, progress: 0 });

    const videos: VideoClip[] = [];
    for (let i = 0; i < storyboards.length; i++) {
      this.update(AgentRole.VIDEO_PRODUCER, {
        currentTask: `制作第 ${storyboards[i].shotNumber} 镜视频`,
        progress: Math.round(((i + 1) / storyboards.length) * 100),
      });
      await sleep(1000);

      videos.push({
        shotNumber: storyboards[i].shotNumber,
        videoUrl: storyboards[i].imageUrl, // In demo mode, use storyboard image as placeholder
      });
    }

    this.update(AgentRole.VIDEO_PRODUCER, { status: 'completed', progress: 100, output: videos });
    return videos;
  }

  // 单个分镜视频重生成
  async regenerateShot(
    shotNumber: number,
    options?: { duration?: number; description?: string }
  ): Promise<VideoClip> {
    this.update(AgentRole.VIDEO_PRODUCER, {
      status: 'working',
      currentTask: `重新生成第 ${shotNumber} 镜视频`,
      progress: 0,
    });

    await sleep(1500);
    this.update(AgentRole.VIDEO_PRODUCER, { progress: 50 });
    await sleep(1500);

    const duration = options?.duration || 10;
    const videoUrl = mockSvg(640, 360, '#6b21a8', '#ec4899', `Shot ${shotNumber} v2 (${duration}s)`);

    this.update(AgentRole.VIDEO_PRODUCER, { status: 'completed', progress: 100 });

    return {
      shotNumber,
      videoUrl,
      duration,
      status: 'completed',
    };
  }

  // 导演审核
  async runDirectorReview(): Promise<any> {
    this.update(AgentRole.DIRECTOR, {
      status: 'thinking',
      currentTask: '审核整体创作质量',
      progress: 10,
    });

    await sleep(2000);
    this.update(AgentRole.DIRECTOR, { progress: 60 });
    await sleep(1500);

    const review = {
      id: `review-${Date.now()}`,
      overallScore: 7.5,
      summary: '整体创作质量良好，剧情连贯，角色形象鲜明。但部分分镜的节奏需要调整，建议优化以下几个方面。',
      items: [
        {
          shotNumber: 3,
          targetRole: 'storyboard',
          issue: '镜头3的节奏偏快，情感铺垫不够',
          suggestion: '延长至12秒，增加角色特写',
          severity: 'major' as const,
        },
        {
          shotNumber: 5,
          targetRole: 'character_designer',
          issue: '角色在镜头5中的服装与前几镜不一致',
          suggestion: '重新生成角色在该场景的设计图',
          severity: 'minor' as const,
        },
        {
          targetRole: 'writer',
          issue: '结尾对白略显生硬',
          suggestion: '优化最后两镜的对白，增加情感深度',
          severity: 'minor' as const,
        },
      ],
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };

    this.update(AgentRole.DIRECTOR, { status: 'completed', progress: 100, output: review });
    return review;
  }

  async startProduction(idea: string, videoProvider: string) {
    const plan = await this.runDirector(idea);
    const script = await this.runWriter(plan);
    const characters = await this.runCharacterDesigner(plan.characters);
    const storyboards = await this.runStoryboardArtist(script, characters);
    const videos = await this.runVideoProducer(storyboards, videoProvider);
    return { plan, script, characters, storyboards, videos };
  }
}

export function isDemoMode(): boolean {
  return !hasOpenAI;
}
