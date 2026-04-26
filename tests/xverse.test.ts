/**
 * XVerseService 单元测试 (v2.0 Sprint 0 D7+)
 *
 * 通过注入 transport 模拟子进程返回，避免真实 fetch / Python 服务依赖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  XVerseService,
  safeJSONParse,
  hasXVerse,
  isXVersePrimary,
} from '@/services/xverse.service';
import { API_CONFIG } from '@/lib/config';

// ────────────────────────────────────────────
// safeJSONParse
// ────────────────────────────────────────────

describe('safeJSONParse', () => {
  it('裸 JSON 直接解析', () => {
    expect(safeJSONParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('带前后缀文本时仍能提取', () => {
    expect(safeJSONParse('剧本:\n{"title":"x"}\n--end--')).toEqual({ title: 'x' });
  });

  it('完全无效返回 null', () => {
    expect(safeJSONParse('not json at all')).toBeNull();
    expect(safeJSONParse('')).toBeNull();
  });
});

// ────────────────────────────────────────────
// 配置 gate
// ────────────────────────────────────────────

describe('hasXVerse / isXVersePrimary', () => {
  const originalEnabled = API_CONFIG.xverse.enabled;
  const originalFallback = API_CONFIG.xverse.fallback;
  const originalUrl = API_CONFIG.xverse.baseURL;

  beforeEach(() => {
    API_CONFIG.xverse.enabled = originalEnabled;
    API_CONFIG.xverse.fallback = originalFallback;
    API_CONFIG.xverse.baseURL = originalUrl;
  });

  it('enabled=true → 始终可用', () => {
    API_CONFIG.xverse.enabled = true;
    expect(hasXVerse()).toBe(true);
    expect(isXVersePrimary()).toBe(true);
  });

  it('enabled=false 但有 baseURL + fallback → 仅 fallback 可用', () => {
    API_CONFIG.xverse.enabled = false;
    API_CONFIG.xverse.fallback = true;
    API_CONFIG.xverse.baseURL = 'http://localhost:8000/v1';
    expect(hasXVerse()).toBe(true);
    expect(isXVersePrimary()).toBe(false);
  });

  it('fallback=false 且未启用 → 完全不可用', () => {
    API_CONFIG.xverse.enabled = false;
    API_CONFIG.xverse.fallback = false;
    expect(hasXVerse()).toBe(false);
  });
});

// ────────────────────────────────────────────
// XVerseService.chat
// ────────────────────────────────────────────

function makeChildOk(content: string) {
  return JSON.stringify({ ok: true, content, elapsed: '0.5', usage: { prompt_tokens: 10, completion_tokens: 20 } });
}
function makeChildErr(error: string) {
  return JSON.stringify({ ok: false, error, elapsed: '0.1' });
}

describe('XVerseService.chat', () => {
  beforeEach(() => {
    API_CONFIG.xverse.baseURL = 'http://localhost:8000/v1';
    API_CONFIG.xverse.enabled = true;
  });

  it('未配置 baseURL 时返回 ok=false', async () => {
    API_CONFIG.xverse.baseURL = '';
    const svc = new XVerseService();
    const r = await svc.chat('sys', 'user');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it('成功调用返回 content + 自动剥 markdown', async () => {
    const svc = new XVerseService();
    svc.__setTransport(async () => makeChildOk('```json\n{"title":"x"}\n```'));
    const r = await svc.chat('sys', 'user', { json: true });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('{"title":"x"}');
    expect(r.usage?.completion_tokens).toBe(20);
  });

  it('child error 透传', async () => {
    const svc = new XVerseService();
    svc.__setTransport(async () => makeChildErr('timeout'));
    const r = await svc.chat('sys', 'user');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('timeout');
  });

  it('选用 fast 模型时命中 fastModel', async () => {
    const svc = new XVerseService();
    let receivedModel = '';
    svc.__setTransport(async (payload) => {
      receivedModel = String(payload.model || '');
      return makeChildOk('hi');
    });
    await svc.chat('sys', 'user', { fast: true });
    expect(receivedModel).toBe(API_CONFIG.xverse.fastModel);
  });

  it('user 超长会被截断', async () => {
    const svc = new XVerseService();
    let receivedUserLen = 0;
    svc.__setTransport(async (payload) => {
      receivedUserLen = String(payload.user || '').length;
      return makeChildOk('ok');
    });
    const longInput = 'A'.repeat(50_000);
    await svc.chat('sys', longInput);
    // MAX_USER_CHARS=24000，加上截断尾巴
    expect(receivedUserLen).toBeLessThan(25_000);
    expect(receivedUserLen).toBeGreaterThan(24_000);
  });
});

// ────────────────────────────────────────────
// XVerseService.writeScript Two-Pass
// ────────────────────────────────────────────

describe('XVerseService.writeScript', () => {
  beforeEach(() => {
    API_CONFIG.xverse.baseURL = 'http://localhost:8000/v1';
    API_CONFIG.xverse.enabled = true;
  });

  it('Two-Pass 流程：Pass1 规划 + Pass2 JSON', async () => {
    const svc = new XVerseService();
    let pass = 0;
    svc.__setTransport(async (payload) => {
      pass++;
      // 区分 Pass1 / Pass2 / 修补
      const sys = String(payload.system || '');
      if (sys.includes('精通分镜')) {
        // Pass1: 文本规划
        return makeChildOk('共规划 5 个镜头\n镜头1: A - x - 角色:甲 - 台词:"y"\n镜头2: B\n镜头3: C\n镜头4: D\n镜头5: E');
      }
      // Pass2: JSON
      const fakeScript = {
        title: 'XVerse 测试稿',
        logline: '当主角遭遇激励事件，他必须行动否则失败',
        synopsis: 'A'.repeat(220),
        theme: '自由的代价是孤独，因为割舍是必经之路',
        incitingIncident: '某事件',
        emotionCurve: { overall: '起伏', temperatures: [0, -3, 5, -8, 7] },
        characterArcs: [{ name: '甲', arc: '从a到b', desire: 'x', need: 'y', flaw: 'z', paradox: 'p', speechPattern: 's' }],
        shots: Array.from({ length: 5 }).map((_, i) => ({
          shotNumber: i + 1,
          act: 1,
          storyBeat: 'beat',
          sceneDescription: '夜风掠过窗棂，烛火摇曳如心跳，远处传来悠长的钟鸣。'.repeat(4),
          visualPrompt: 'cinematic 3D Chinese donghua style, '.repeat(8) + 'volumetric lighting',
          characters: ['甲'],
          dialogue: '走吧，天晚了',
          subtext: '我不想让你看到我哭',
          action: '左手按住腰间伤口，拖着右腿一步步挪向门口，背影在月光下颤抖',
          emotion: '悲',
          emotionTemperature: -3,
          beat: '从希望到失落',
          cameraWork: '推→拉',
          soundDesign: '远雷+低吟',
          duration: 8,
        })),
      };
      return makeChildOk(JSON.stringify(fakeScript));
    });

    const result = await svc.writeScript({
      plan: {
        genre: '古风',
        style: '水墨',
        characters: [{ name: '甲', role: '主角', description: '主角', appearance: 'cinematic' }],
        scenes: [{ id: 's1', description: '夜场', location: '院内' }],
        storyStructure: { acts: 3, totalShots: 5 },
      } as any,
      userContext: '用户创意：一个关于离别的小故事',
      directorTotalShots: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.script).toBeTruthy();
    expect(result.script?.shots?.length).toBe(5);
    expect(pass).toBeGreaterThanOrEqual(2); // Pass1 + Pass2
    expect(result.passes.pass1Ms).toBeGreaterThanOrEqual(0);
    expect(result.passes.pass2Ms).toBeGreaterThanOrEqual(0);
  });

  it('Pass2 JSON 损坏 → 调用修复后仍可恢复', async () => {
    const svc = new XVerseService();
    let calls = 0;
    svc.__setTransport(async (payload) => {
      calls++;
      const sys = String(payload.system || '');
      if (sys.includes('精通分镜')) return makeChildOk('共规划 4 个镜头\n镜头1\n镜头2\n镜头3\n镜头4');
      if (sys.startsWith('你是一个 JSON 修复机')) {
        return makeChildOk(JSON.stringify({
          title: 'fixed', shots: Array.from({ length: 4 }).map((_, i) => ({ shotNumber: i + 1 })),
        }));
      }
      // Pass2 给坏 JSON
      return makeChildOk('this is not json !@#');
    });

    const result = await svc.writeScript({
      plan: { genre: 'g', style: 's', characters: [], scenes: [], storyStructure: { acts: 3, totalShots: 4 } } as any,
      userContext: 'ctx',
      directorTotalShots: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.script?.title).toBe('fixed');
    expect(calls).toBeGreaterThanOrEqual(3); // Pass1 + Pass2 + fix
  });
});
