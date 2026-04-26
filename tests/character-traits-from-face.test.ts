/**
 * traitsFromFace + /api/character-traits/from-face 端到端测试 · Sprint A.2
 *
 * Mock 全局 fetch (Vision API), 验证:
 *   · 正常路径: vision 返回完整 6 维 → 全字段保留
 *   · 缺字段: vision 返回部分字段 → 缺的填 "未明示" / unknown 而不是空
 *   · 不像人脸: vision 返回 confident=false → 我们透传 confident=false
 *   · 网络挂: traitsFromFace 返回 null
 *   · 端点: 缺 imageUrl → 400, vision 返 null → 422
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @/lib/config 提供假 OPENAI key (否则 traitsFromFace 早退)
vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: {
      apiKey: 'test-key',
      baseURL: 'https://mock.openai.local/v1',
      model: 'gpt-4o-test',
      creativeModel: 'gpt-4o-test',
    },
  },
}));

// Mock OpenAI SDK — 它内部调 fetch 我们截不到, 直接 mock 整个 client。
// vi.hoisted 让 mockChatCreate 先于 vi.mock 工厂执行 (vitest 会把 vi.mock 提到文件顶部)
const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}));
// 用 class 而不是 vi.fn().mockImplementation 因为 new vi.fn()(...) 在 vitest 里不被识别为构造器
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockChatCreate } };
    constructor(_opts?: any) { /* noop */ }
  },
}));

import { traitsFromFace } from '@/lib/character-traits';
import { POST as fromFaceHandler } from '@/app/api/character-traits/from-face/route';

const okResponse = (json: any) => ({
  choices: [{ message: { content: JSON.stringify(json) } }],
});

beforeEach(() => {
  mockChatCreate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────
// traitsFromFace 单元测试
// ──────────────────────────────────────────────────
describe('traitsFromFace · 反向抽取', () => {
  it('完整字段透传, confident=true 保留', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      name: '林小满',
      gender: 'female',
      ageGroup: '青年',
      build: '纤细修长',
      skinTone: '白皙',
      appearance: '黑长直发, 鹅蛋脸',
      costume: '白色衬衫',
      personality: '清冷 内敛',
      signature: '左腕红绳',
      confident: true,
    }));
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out).not.toBeNull();
    expect(out!.name).toBe('林小满');
    expect(out!.gender).toBe('female');
    expect(out!.ageGroup).toBe('青年');
    expect(out!.appearance).toBe('黑长直发, 鹅蛋脸');
    expect(out!.confident).toBe(true);
  });

  it('部分字段缺失: 自动归一化为"未明示" / unknown 而不是空', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      name: '神秘人',
      gender: 'unknown',
      ageGroup: '未明示',
      build: '',  // 故意空
      // skinTone 字段都不存在
      personality: '神秘',
      confident: false,
    }));
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out).not.toBeNull();
    expect(out!.gender).toBe('unknown');
    expect(out!.ageGroup).toBe('未明示');
    expect(out!.build).toBe('未明示');
    expect(out!.skinTone).toBe('未明示');
    expect(out!.personality).toBe('神秘');
    expect(out!.confident).toBe(false);
  });

  it('LLM 返回非法 gender → 归一到 unknown', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      name: 'X',
      gender: 'androgynous', // 不在白名单
      ageGroup: '青年',
      confident: true,
    }));
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out!.gender).toBe('unknown');
  });

  it('LLM 返回非法 ageGroup → 归一到 未明示', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      name: 'X',
      gender: 'male',
      ageGroup: '青壮年', // 不在白名单
      confident: true,
    }));
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out!.ageGroup).toBe('未明示');
  });

  it('OpenAI 抛错 → 返回 null', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('network error'));
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out).toBeNull();
  });

  it('LLM 返回非 JSON → 返回 null', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '这不是 JSON 而是散文' } }],
    });
    const out = await traitsFromFace('https://x.com/face.jpg');
    expect(out).toBeNull();
  });

  it('imageUrl 为空 → 直接返回 null, 不调 LLM', async () => {
    const out = await traitsFromFace('');
    expect(out).toBeNull();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('defaultName 在 LLM 没给 name 时兜底', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      // 故意不给 name
      gender: 'female',
      ageGroup: '青年',
      confident: true,
    }));
    const out = await traitsFromFace('https://x.com/face.jpg', { defaultName: '兜底名' });
    expect(out!.name).toBe('兜底名');
  });
});

// ──────────────────────────────────────────────────
// 端点集成测试
// ──────────────────────────────────────────────────
describe('POST /api/character-traits/from-face · 端点', () => {
  function mkReq(body: any): Request {
    return new Request('http://localhost/api/character-traits/from-face', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('缺 imageUrl → 400', async () => {
    const res = await fromFaceHandler(mkReq({}) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/imageUrl/);
  });

  it('imageUrl 为空字符串 → 400', async () => {
    const res = await fromFaceHandler(mkReq({ imageUrl: '   ' }) as any);
    expect(res.status).toBe(400);
  });

  it('vision 失败 → 422', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('boom'));
    const res = await fromFaceHandler(mkReq({ imageUrl: 'https://x.com/a.jpg' }) as any);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/识别失败/);
  });

  it('happy path → 200 + traits payload', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      name: '小满',
      gender: 'female',
      ageGroup: '青年',
      build: '纤细',
      skinTone: '白皙',
      appearance: '长发',
      costume: '校服',
      personality: '倔强',
      signature: '左腕红绳',
      confident: true,
    }));
    const res = await fromFaceHandler(mkReq({ imageUrl: 'https://x.com/a.jpg' }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('小满');
    expect(body.gender).toBe('female');
    expect(body.confident).toBe(true);
    expect(body.signature).toBe('左腕红绳');
  });

  it('defaultName 透传到 traitsFromFace, vision 没 name 时兜底', async () => {
    mockChatCreate.mockResolvedValueOnce(okResponse({
      gender: 'male',
      confident: true,
    }));
    const res = await fromFaceHandler(
      mkReq({ imageUrl: 'https://x.com/a.jpg', defaultName: '兜底名字' }) as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('兜底名字');
  });
});
