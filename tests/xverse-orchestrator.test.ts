/**
 * HybridOrchestrator × XVerse 集成测试 (D8)
 *
 * 验证 hybrid-orchestrator.runWriter() 的 XVerse 主链路分支：
 *   - XVERSE_ENABLED=true 时，编剧步骤直接走 XVerse 双 Pass 流程
 *   - 不依赖 OpenAI key
 *   - 心跳事件正常发送
 *
 * 通过 __setXVerseService 注入带 mock transport 的 service。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';
import { XVerseService } from '@/services/xverse.service';
import { API_CONFIG } from '@/lib/config';
import { AgentRole, type DirectorPlan } from '@/types/agents';

const FAKE_PLAN: DirectorPlan = {
  genre: '古风',
  style: '水墨',
  characters: [
    {
      name: '青枫',
      role: '主角',
      description: '剑舞少女，渴望自由却背负师门血债',
      appearance: 'young female warrior, silver hair, jade hairpin, wearing dark blue hanfu robe',
    } as any,
  ],
  scenes: [
    { id: 's1', description: '夜雨竹林，少女独立', location: '竹林' } as any,
    { id: 's2', description: '宗门祠堂，长老审判', location: '祠堂' } as any,
  ],
  storyStructure: { acts: 3, totalShots: 5 } as any,
} as any;

function fakeChildOk(content: string) {
  return JSON.stringify({
    ok: true,
    content,
    elapsed: '0.2',
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  });
}

function buildMockScript(shotCount: number) {
  return {
    title: '青枫别师',
    logline: '当青枫遭遇师门反叛，她必须做出抉择，否则信念将永远破碎',
    synopsis: '一'.repeat(220),
    theme: '自由的代价是孤独，因为割舍是必经之路',
    incitingIncident: '一封血书在深夜送进竹屋',
    emotionCurve: { overall: '中→低→高→谷→平', temperatures: [0, -3, 5, -8, 7] },
    characterArcs: [{
      name: '青枫', arc: '从顺从到觉醒', desire: '回归师门',
      need: '直面真相', flaw: '过度责任感', paradox: '渴望自由却习惯服从',
      speechPattern: '简短，多用反问',
    }],
    shots: Array.from({ length: shotCount }).map((_, i) => ({
      shotNumber: i + 1,
      act: i < shotCount / 3 ? 1 : i < (shotCount * 2) / 3 ? 2 : 3,
      storyBeat: ['激励事件', '中点反转', '黑暗时刻', '高潮抉择', '尾声余韵'][i % 5],
      sceneDescription: '夜风掠过竹林，雨滴打在青石板上发出清脆的回响，远处宗门祠堂亮着昏黄的火光。'.repeat(2),
      visualPrompt: 'cinematic Chinese ink wash painting style, '.repeat(8) + 'volumetric mist',
      characters: ['青枫'],
      dialogue: '走吧，天晚了。',
      subtext: '我不想让你看到我流泪',
      action: '左手按住腰间剑柄，右手缓缓拭去脸上雨水，眼神在黑暗中如刀',
      emotion: '悲',
      emotionTemperature: [-3, 5, -8, 7, 0][i % 5],
      beat: '从希望到失落',
      cameraWork: '推→拉→俯',
      soundDesign: '远雷+雨打竹叶',
      duration: 8,
    })),
  };
}

describe('HybridOrchestrator × XVerse', () => {
  const originalXverse = { ...API_CONFIG.xverse };

  beforeEach(() => {
    API_CONFIG.xverse.baseURL = 'http://localhost:8000/v1';
    API_CONFIG.xverse.enabled = true;
    API_CONFIG.xverse.fallback = true;
  });

  afterEach(() => {
    Object.assign(API_CONFIG.xverse, originalXverse);
  });

  it('XVERSE_ENABLED=true 时 runWriter 直接走 XVerse 主路径', async () => {
    const orchestrator = new HybridOrchestrator();
    const xverseSvc = new XVerseService();

    let calls = 0;
    let pass1Hit = false;
    let pass2Hit = false;
    xverseSvc.__setTransport(async (payload) => {
      calls++;
      const sys = String(payload.system || '');
      if (sys.includes('精通分镜')) {
        pass1Hit = true;
        const lines = ['共规划 5 个镜头'];
        for (let i = 1; i <= 5; i++) lines.push(`镜头${i}: 场景${i} - 节拍 - 角色:青枫 - 台词:"x"`);
        return fakeChildOk(lines.join('\n'));
      }
      // Pass2 → 完整 JSON
      pass2Hit = true;
      return fakeChildOk(JSON.stringify(buildMockScript(5)));
    });

    orchestrator.__setXVerseService(xverseSvc);

    // 收集 agent 事件
    const events: { type: string; data: any }[] = [];
    orchestrator.onProgress = (type, data) => events.push({ type, data });

    const script = await orchestrator.runWriter(FAKE_PLAN);

    expect(script).toBeTruthy();
    expect(script.title).toBe('青枫别师');
    expect(script.shots).toBeDefined();
    expect(script.shots!.length).toBe(5);

    // 验证两个 Pass 都被命中
    expect(pass1Hit).toBe(true);
    expect(pass2Hit).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);

    // 验证至少有一条 agentTalk 提到 XVERSE
    const talks = events.filter(e => e.type === 'agentTalk');
    expect(talks.some(t => /XVERSE|XVerse/.test(String(t.data?.text || '')))).toBe(true);

    // 验证编剧 agent 最终为 completed
    const writer = orchestrator.getAgentState(AgentRole.WRITER);
    expect(writer).toBeTruthy();
    expect(writer!.status).toBe('completed');
    expect(writer!.progress).toBe(100);
    expect(writer!.output).toBeTruthy();
  });

  it('XVERSE_ENABLED=false 但有 baseURL → 仅 fallback 模式，不直接走 XVerse', async () => {
    API_CONFIG.xverse.enabled = false;
    API_CONFIG.xverse.fallback = true;

    const orchestrator = new HybridOrchestrator();
    const xverseSvc = new XVerseService();

    let xverseHit = false;
    xverseSvc.__setTransport(async () => {
      xverseHit = true;
      return fakeChildOk(JSON.stringify(buildMockScript(5)));
    });
    orchestrator.__setXVerseService(xverseSvc);

    const script = await orchestrator.runWriter(FAKE_PLAN);

    // 没有 OpenAI key，hybrid-orchestrator 走 "openai 缺席 + xverse 兜底" 分支
    // → XVerse 应被调用一次，编剧成功完成
    expect(xverseHit).toBe(true);
    expect(script).toBeTruthy();
    expect(script.shots?.length || 0).toBeGreaterThan(0);
  });

  it('XVerse 全部 fail → 优雅降级到 fallbackScript', async () => {
    const orchestrator = new HybridOrchestrator();
    const xverseSvc = new XVerseService();
    xverseSvc.__setTransport(async () => JSON.stringify({ ok: false, error: 'mock 503' }));
    orchestrator.__setXVerseService(xverseSvc);

    const script = await orchestrator.runWriter(FAKE_PLAN);
    expect(script).toBeTruthy();
    expect(script.title).toBeTruthy(); // fallbackScript 必有 title
  });
});
