/**
 * /api/polish-script 集成测试 (端到端 route handler)
 *
 * 直接调 POST handler, 不起 Next dev server。关键点:
 *   · Mock 全局 fetch, 让 route 不真的打 OpenAI / Claude
 *   · 用 vi.mock() 把 lib/config 的 openai.apiKey 设为 "test-key", 让 route 通过 503 校验
 *   · 覆盖 v2.11 升级后的关键路径: basic / pro / degraded / 输入校验
 *
 * 为什么要集成测试:
 *   polish-prompts + polish-json + sanitizeAudit 都有单测, 但"三者合在一起当 HTTP 接口跑"是
 *   另一回事 —— 参数解析、HTTP 状态码、mode 分支、errored 路径的响应形状, 都只能在这层锁。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock API_CONFIG —— 必须在 import route handler 之前, 否则 route 会先看到 ''  key 而 503
vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: {
      apiKey: 'test-key',
      baseURL: 'https://mock.openai.local/v1',
      model: 'claude-sonnet-test',
      creativeModel: 'claude-sonnet-test',
    },
  },
}));

// 真正 import route handler (依赖 mock 已生效)
import { POST } from '@/app/api/polish-script/route';

/** 构造 NextRequest 兼容的 Request (route 只用 .json(), 普通 Request 够用) */
function mkReq(body: any): Request {
  return new Request('http://localhost/api/polish-script', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 一个模拟 OpenAI Chat Completions 的 fetch 响应 */
function mockLlmResponse(content: unknown, opts?: { status?: number; errorMsg?: string }) {
  const status = opts?.status ?? 200;
  const body =
    opts?.errorMsg
      ? { error: { message: opts.errorMsg } }
      : {
          choices: [
            {
              message: {
                content: typeof content === 'string' ? content : JSON.stringify(content),
              },
            },
          ],
        };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────
// 输入校验
// ──────────────────────────────────────────────────
describe('POST /api/polish-script · 输入校验', () => {
  it('缺 script → 400', async () => {
    const res = await POST(mkReq({}) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/script/);
  });

  it('script 太长 → 413', async () => {
    const res = await POST(mkReq({ script: 'a'.repeat(32001) }) as any);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/过长/);
  });

  it('空字符串 → 400 (不算"有 script")', async () => {
    const res = await POST(mkReq({ script: '   ' }) as any);
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────
// Basic 模式 —— happy path + 降级
// ──────────────────────────────────────────────────
describe('POST /api/polish-script · Basic 模式', () => {
  it('LLM 返回干净 JSON → 返回 polished + summary + notes, 不带 audit', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: '黄昏的屋顶上, 少女倚着瓦。',
        summary: '增强画面感',
        notes: ['替换形容词', '合并两个短句'],
      }),
    );
    const res = await POST(mkReq({ script: '屋顶上有个女孩。' }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polished).toBe('黄昏的屋顶上, 少女倚着瓦。');
    expect(body.summary).toBe('增强画面感');
    expect(body.notes).toEqual(['替换形容词', '合并两个短句']);
    expect(body.audit).toBeNull();
    expect(body.mode).toBe('basic');
    expect(typeof body.elapsedMs).toBe('number');
    expect(body.model).toBeTruthy();
  });

  it('LLM 返回非 JSON 的散文 → degraded=true, polished 是剥壳后的文本', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse('这是一段纯散文, 没有 JSON 结构, 只能保底'),
    );
    const res = await POST(mkReq({ script: '原文' }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.polished).toContain('纯散文');
    expect(body.audit).toBeNull();
  });

  it('上游 503 → 502 + 透传错误消息', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse(null, { status: 503, errorMsg: 'upstream overloaded' }),
    );
    const res = await POST(mkReq({ script: '原文' }) as any);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('upstream overloaded');
  });

  it('上游无 content → 502', async () => {
    // choices[0].message.content 缺失
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await POST(mkReq({ script: '原文' }) as any);
    expect(res.status).toBe(502);
  });

  it('notes 超过 20 条会被截断', async () => {
    const manyNotes = Array.from({ length: 25 }, (_, i) => `第 ${i + 1} 条`);
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({ polished: 'x', summary: '', notes: manyNotes }),
    );
    const res = await POST(mkReq({ script: '原文' }) as any);
    const body = await res.json();
    expect(body.notes).toHaveLength(20);
  });
});

// ──────────────────────────────────────────────────
// Pro 模式 —— 带 audit + 白名单过滤
// ──────────────────────────────────────────────────
describe('POST /api/polish-script · Pro 模式', () => {
  const FULL_AUDIT = {
    hook: { strength: 'strong', at3s: '纵身跃下', rationale: '强反差' },
    actStructure: {
      incitingIncident: '父亲失踪',
      midpoint: '发现账本',
      climax: '仓库对峙',
      resolution: '烧账本',
      missingBeats: ['Theme Stated'],
    },
    dialogueIssues: {
      onTheNoseLines: ['我恨你'],
      abstractEmotionLines: ['她感到绝望'],
    },
    characterAnchors: [
      { name: '林小满', visualLock: '黑长直', speechStyle: '短促', arc: 'want: 复仇' },
    ],
    sceneLighting: [
      { scene: '阁楼', lightDirection: '侧逆光', quality: '硬光', colorTemp: '3200K', mood: '压抑' },
    ],
    continuityAnchors: ['第 3→4 场账本'],
    styleProfile: { genre: '悬疑', tone: '克制', rhythm: '慢热', artDirection: '胶片质感' },
    aigcReadiness: { score: 82, reasoning: '三要素齐备' },
    issues: [
      { severity: 'critical', category: 'structure', text: '中点缺失', where: '全片' },
    ],
  };

  it('返回完整 audit → 结构完整透出', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: '润色后文本',
        summary: '加了 Hook',
        notes: ['加阁楼'],
        audit: FULL_AUDIT,
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('pro');
    expect(body.audit).not.toBeNull();
    expect(body.audit.hook.strength).toBe('strong');
    expect(body.audit.aigcReadiness.score).toBe(82);
    expect(body.audit.sceneLighting).toHaveLength(1);
    expect(body.audit.issues).toHaveLength(1);
    expect(body.degraded).toBeUndefined();
  });

  it('audit 字段缺失 → degraded=true + audit=null', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: '仅 polished',
        summary: '',
        notes: [],
        // 无 audit 字段
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.mode).toBe('pro');
    expect(body.audit).toBeNull();
    expect(body.degraded).toBe(true);
  });

  it('audit 是空对象 → 识别为无内容 → audit=null + degraded=true', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: { hook: null, actStructure: null, characterAnchors: [], sceneLighting: [], issues: [] },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit).toBeNull();
    expect(body.degraded).toBe(true);
  });

  it('非法 severity / category 被归一到默认值', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: {
          ...FULL_AUDIT,
          issues: [
            { severity: 'hot-mess', category: 'spicy', text: '对白问题', where: '第 1 场' },
          ],
        },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit.issues[0].severity).toBe('minor');
    expect(body.audit.issues[0].category).toBe('other');
  });

  it('aigcReadiness.score 越界被 clamp 到 [0,100]', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: { ...FULL_AUDIT, aigcReadiness: { score: 150, reasoning: 'ok' } },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit.aigcReadiness.score).toBe(100);
  });

  it('characterAnchors 过多 → 截断到 12 条', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `角色${i}`, visualLock: '锁脸', speechStyle: '话风', arc: '弧光',
    }));
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: { ...FULL_AUDIT, characterAnchors: many },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit.characterAnchors).toHaveLength(12);
  });

  it('没有 name 的 characterAnchor 会被过滤', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: {
          ...FULL_AUDIT,
          characterAnchors: [
            { name: '', visualLock: 'x', speechStyle: '', arc: '' },
            { name: '有名字', visualLock: 'y', speechStyle: '', arc: '' },
          ],
        },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit.characterAnchors).toHaveLength(1);
    expect(body.audit.characterAnchors[0].name).toBe('有名字');
  });

  it('hook.strength 不在白名单 → 归一到 "ok"', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({
        polished: 'x', summary: '', notes: [],
        audit: { ...FULL_AUDIT, hook: { strength: 'super-strong', at3s: 'x', rationale: 'x' } },
      }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.audit.hook.strength).toBe('ok');
  });
});

// ──────────────────────────────────────────────────
// 默认 mode / 不合法 mode 处理
// ──────────────────────────────────────────────────
describe('POST /api/polish-script · mode 容错', () => {
  it('未传 mode → 默认 basic', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({ polished: 'x', summary: '', notes: [] }),
    );
    const res = await POST(mkReq({ script: '原文' }) as any);
    const body = await res.json();
    expect(body.mode).toBe('basic');
  });

  it('mode=xxxyyy → 归一到 basic', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({ polished: 'x', summary: '', notes: [] }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'xxxyyy' }) as any);
    const body = await res.json();
    expect(body.mode).toBe('basic');
    // basic 模式应该根本不尝试 audit
    expect(body.audit).toBeNull();
  });

  it('pro 明确 → mode=pro', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockLlmResponse({ polished: 'x', summary: '', notes: [], audit: null }),
    );
    const res = await POST(mkReq({ script: '原文', mode: 'pro' }) as any);
    const body = await res.json();
    expect(body.mode).toBe('pro');
  });
});
