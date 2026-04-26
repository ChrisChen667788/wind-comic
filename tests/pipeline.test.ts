import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 依赖 ──
vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: { apiKey: '', baseURL: '', model: 'test' },
    // 给 minimax 一个非空 key, 让 hybrid-orchestrator 实例化 MinimaxService,
    // 这样下面 vi.mock 的 generateVideo 桩才会真正生效
    minimax: { apiKey: 'test-key', groupId: 'test-group', baseURL: 'https://test.local' },
    banana: { apiKey: 'test-key', modelKey: '' },
    veo: { apiKey: '', baseURL: '', model: '', format: 'openai' },
    keling: { apiKey: '', baseURL: '' },
    vidu: { apiKey: '', baseURL: '' },
    fal: { apiKey: '' },
    comfyui: { baseURL: '' },
    xverse: { enabled: false, fallback: false, baseURL: '', apiKey: '', model: '', fastModel: '', temperature: 0.7, topP: 0.9, maxTokens: 4096, timeout: 60000 },
  },
}));

vi.mock('@/services/minimax.service', () => {
  // 用真正的 class 形式, 让 `new MinimaxService()` 可正常构造
  class MinimaxService {
    generateVideo = vi.fn().mockResolvedValue('https://example.com/video.mp4');
    generateImage = vi.fn().mockResolvedValue('https://example.com/img.png');
    generateSpeech = vi.fn().mockResolvedValue('https://example.com/audio.mp3');
    generateMusic = vi.fn().mockResolvedValue('https://example.com/music.mp3');
    isVideoAvailable = () => true;
    isImageAvailable = () => true;
  }
  return { MinimaxService, hasMinimax: () => true };
});

vi.mock('@/services/midjourney.service', () => ({
  MidjourneyService: vi.fn(),
  hasMidjourney: () => false,
}));

describe('HybridOrchestrator', () => {
  let HybridOrchestrator: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/services/hybrid-orchestrator');
    HybridOrchestrator = mod.HybridOrchestrator;
  });

  it('should initialize all agents', () => {
    const orch = new HybridOrchestrator();
    const agents = orch.getAllAgents();
    expect(agents.length).toBeGreaterThanOrEqual(6);
    expect(agents.every((a: any) => a.status === 'idle')).toBe(true);
  });

  it('runDirector should return a valid plan', async () => {
    const orch = new HybridOrchestrator();
    const plan = await orch.runDirector('秦朝采药队的冒险故事');
    expect(plan).toBeDefined();
    expect(plan.genre).toBeTruthy();
    expect(plan.style).toBeTruthy();
    expect(plan.characters.length).toBeGreaterThan(0);
    expect(plan.scenes.length).toBeGreaterThan(0);
    expect(plan.storyStructure.totalShots).toBeGreaterThan(0);
    // Agent 状态应为 completed
    const director = orch.getAllAgents().find((a: any) => a.role === 'director');
    expect(director?.status).toBe('completed');
    expect(director?.progress).toBe(100);
  });

  it('runWriter should return a valid script', async () => {
    const orch = new HybridOrchestrator();
    const plan = await orch.runDirector('赛博朋克侦探故事');
    const script = await orch.runWriter(plan);
    expect(script).toBeDefined();
    expect(script.title).toBeTruthy();
    expect(script.synopsis).toBeTruthy();
    expect(script.shots.length).toBeGreaterThan(0);
    expect(script.shots[0].shotNumber).toBe(1);
    expect(script.shots[0].sceneDescription).toBeTruthy();
  });

  it('runCharacterDesigner should return character images', async () => {
    const orch = new HybridOrchestrator();
    const chars = [
      { name: '主角', description: '勇敢的战士', appearance: 'brave warrior' },
      { name: '伙伴', description: '聪明的法师', appearance: 'wise mage' },
    ];
    const results = await orch.runCharacterDesigner(chars);
    expect(results.length).toBe(2);
    expect(results[0].character).toBe('主角');
    expect(results[0].imageUrl).toBeTruthy();
    expect(results[1].character).toBe('伙伴');
  });

  it('runSceneDesigner should return scene images', async () => {
    const orch = new HybridOrchestrator();
    const scenes = [
      { id: 's1', description: '古城远景', location: '古城' },
      { id: 's2', description: '战场', location: '战场' },
    ];
    const results = await orch.runSceneDesigner(scenes);
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('古城');
    expect(results[0].imageUrl).toBeTruthy();
  });

  it('runStoryboardArtist should return storyboards matching shots', async () => {
    const orch = new HybridOrchestrator();
    const script = {
      title: '测试', synopsis: '测试剧本',
      shots: [
        { shotNumber: 1, sceneDescription: '开场', characters: ['主角'], dialogue: '', action: '走', emotion: '平静' },
        { shotNumber: 2, sceneDescription: '高潮', characters: ['主角'], dialogue: '冲！', action: '跑', emotion: '紧张' },
      ],
    };
    const chars = [{ character: '主角', imageUrl: 'https://example.com/char.png', prompt: 'hero' }];
    const storyboards = await orch.runStoryboardArtist(script, chars);
    expect(storyboards.length).toBe(2);
    expect(storyboards[0].shotNumber).toBe(1);
    expect(storyboards[1].shotNumber).toBe(2);
    // v2.x 架构: storyboard 阶段只产出文本规划(prompt + planData), imageUrl 由后续渲染阶段填充
    expect(storyboards[0].prompt).toBeTruthy();
    expect((storyboards[0] as any).planData?.cameraAngle).toBeTruthy();
  });

  it('runVideoProducer should return videos for each storyboard', async () => {
    const orch = new HybridOrchestrator();
    const storyboards = [
      { shotNumber: 1, imageUrl: 'https://example.com/sb1.png', prompt: 'scene 1' },
      { shotNumber: 2, imageUrl: 'https://example.com/sb2.png', prompt: 'scene 2' },
    ];
    const videos = await orch.runVideoProducer(storyboards, 'minimax');
    expect(videos.length).toBe(2);
    expect(videos[0].shotNumber).toBe(1);
    expect(videos[0].videoUrl).toBeTruthy();
    expect(videos[0].status).toBe('completed');
  });

  it('runEditor should produce a timeline with correct rhythm', async () => {
    const orch = new HybridOrchestrator();
    // 注意: 使用非 http URL 走纯结构路径, 避免触发 ffmpeg compose 子进程
    const videos = [
      { shotNumber: 1, videoUrl: 'v1.mp4', duration: 8, status: 'completed' as const },
      { shotNumber: 2, videoUrl: 'v2.mp4', duration: 8, status: 'completed' as const },
      { shotNumber: 3, videoUrl: 'v3.mp4', duration: 8, status: 'completed' as const },
    ];
    const script = {
      title: '测试', synopsis: '测试',
      shots: [
        { shotNumber: 1, sceneDescription: '开场', characters: [], dialogue: '', action: '', emotion: '庄严' },
        { shotNumber: 2, sceneDescription: '发展', characters: [], dialogue: '', action: '', emotion: '紧张' },
        { shotNumber: 3, sceneDescription: '结尾', characters: [], dialogue: '', action: '', emotion: '希望' },
      ],
    };
    const result = await orch.runEditor(videos, script);
    expect(result.timeline.length).toBe(3);
    expect(result.totalDuration).toBeGreaterThan(0);
    expect(result.videoCount).toBe(3);
    // 开场应该是 fade-in + slow-zoom-in 起式
    expect(result.timeline[0].transition).toBe('fade-in');
    expect(result.timeline[0].effect).toBe('slow-zoom-in');
    // 结尾应该是 fade-out + slow-zoom-out 收式
    expect(result.timeline[2].transition).toBe('fade-out');
    expect(result.timeline[2].effect).toBe('slow-zoom-out');
    // 每个 timeline item 必须携带 emotion / act / duration
    expect(result.timeline[0].duration).toBeGreaterThan(0);
    expect(result.timeline[1].emotion).toBe('紧张');
  });

  it('runDirectorReview should return a scored review', async () => {
    const orch = new HybridOrchestrator();
    const script = { title: '测试', synopsis: '测试', shots: [{ shotNumber: 1, sceneDescription: '', characters: [], dialogue: '', action: '', emotion: '' }] };
    const videos = [{ shotNumber: 1, videoUrl: 'https://example.com/v.mp4', duration: 5, status: 'completed' as const }];
    const review = await orch.runDirectorReview(script, videos);
    expect(review).toBeDefined();
    expect(review.overallScore).toBeGreaterThan(0);
    expect(review.overallScore).toBeLessThanOrEqual(100);
    expect(review.summary).toBeTruthy();
    expect(review.id).toBeTruthy();
    expect(typeof review.passed).toBe('boolean');
  });

  it('full pipeline should complete without errors', async () => {
    const orch = new HybridOrchestrator();
    const plan = await orch.runDirector('魔法学院的冒险');
    expect(plan).toBeDefined();

    const script = await orch.runWriter(plan);
    expect(script.shots.length).toBeGreaterThan(0);

    const characters = await orch.runCharacterDesigner(plan.characters);
    expect(characters.length).toBe(plan.characters.length);

    const scenes = await orch.runSceneDesigner(plan.scenes);
    expect(scenes.length).toBe(plan.scenes.length);

    const storyboards = await orch.runStoryboardArtist(script, characters, scenes);
    expect(storyboards.length).toBe(script.shots.length);

    const videos = await orch.runVideoProducer(storyboards, 'minimax');
    expect(videos.length).toBe(storyboards.length);

    const editResult = await orch.runEditor(videos, script);
    expect(editResult.timeline.length).toBe(videos.length);

    const review = await orch.runDirectorReview(script, videos, editResult);
    expect(review.overallScore).toBeGreaterThan(0);

    // 所有 agent 应该都是 completed
    const agents = orch.getAllAgents();
    const completedCount = agents.filter((a: any) => a.status === 'completed').length;
    expect(completedCount).toBeGreaterThanOrEqual(6);
  }, 30000); // 30秒超时

  it('onProgress callback should be called', async () => {
    const orch = new HybridOrchestrator();
    const events: any[] = [];
    orch.onProgress = (type, data) => events.push({ type, data });

    await orch.runDirector('测试创意');
    expect(events.some(e => e.type === 'agentTalk')).toBe(true);
  });
});

describe('McKee Skill', () => {
  it('should export all required prompt functions', async () => {
    const skill = await import('@/lib/mckee-skill');
    expect(typeof skill.getDirectorSystemPrompt).toBe('function');
    expect(typeof skill.getMcKeeWriterPrompt).toBe('function');
    expect(typeof skill.getDirectorReviewPrompt).toBe('function');
    expect(typeof skill.getCharacterVisualPrompt).toBe('function');
    expect(typeof skill.getSceneVisualPrompt).toBe('function');
    expect(typeof skill.getStoryboardVisualPrompt).toBe('function');
    expect(typeof skill.getMusicPromptForEmotion).toBe('function');
  });

  it('director prompt should require multi-dimension character visual schema', async () => {
    // v2.x: 角色视觉拆成 11 维 schema, headwear/shoes 已合并到 outfit, 增加了
    // bodyLanguage / colorScheme / silhouette / face / hair
    const { getDirectorSystemPrompt } = await import('@/lib/mckee-skill');
    const prompt = getDirectorSystemPrompt();
    expect(prompt).toContain('headShape');
    expect(prompt).toContain('bodyType');
    expect(prompt).toContain('skinTone');
    expect(prompt).toContain('face');
    expect(prompt).toContain('hair');
    expect(prompt).toContain('outfit');
    expect(prompt).toContain('props');
    expect(prompt).toContain('bodyLanguage');
    expect(prompt).toContain('colorScheme');
    expect(prompt).toContain('silhouette');
  });

  it('director prompt should require multi-dimension scene visual schema', async () => {
    // v2.x: 场景视觉去掉了 indoorOutdoor/shotScale/environment/background (镜头级别字段下沉到 storyboard),
    // 改成 timeOfDay / soundscape / smell / colorPalette 五感写作
    const { getDirectorSystemPrompt } = await import('@/lib/mckee-skill');
    const prompt = getDirectorSystemPrompt();
    expect(prompt).toContain('lighting');
    expect(prompt).toContain('atmosphere');
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('weather');
    expect(prompt).toContain('timeOfDay');
    expect(prompt).toContain('soundscape');
    expect(prompt).toContain('smell');
    expect(prompt).toContain('colorPalette');
  });

  it('character visual prompt should include --ar', async () => {
    const { getCharacterVisualPrompt } = await import('@/lib/mckee-skill');
    const prompt = getCharacterVisualPrompt('Hero', 'brave warrior', 'tall man', 'cinematic');
    expect(prompt).toContain('--ar');
    expect(prompt).toContain('turnaround sheet');
  });

  it('music prompt should map emotions correctly', async () => {
    const { getMusicPromptForEmotion } = await import('@/lib/mckee-skill');
    const tense = getMusicPromptForEmotion('紧张', '古装历史');
    expect(tense).toContain('suspenseful');
    expect(tense).toContain('guzheng');
    const happy = getMusicPromptForEmotion('欢快', '赛博科幻');
    expect(happy).toContain('cheerful');
    expect(happy).toContain('synthwave');
  });
});

describe('Midjourney Service', () => {
  it('should export hasMidjourney function', async () => {
    const { hasMidjourney } = await import('@/services/midjourney.service');
    expect(typeof hasMidjourney).toBe('function');
  });
});
