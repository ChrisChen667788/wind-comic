/**
 * v12.203 — prosody 角色纠偏(纯函数)+ music BGM API 接线锁。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { characterProsodyBias, deriveProsody } from '@/lib/tts-prosody';
import fs from 'fs';

beforeEach(() => { vi.resetModules(); });

describe('v12.203 · prosody 角色纠偏 + AI 作曲', () => {
  it('性别线索:男角压低音高降速,女角提亮', () => {
    const male = characterProsodyBias('老陈大爷');
    expect(male.pitchDelta).toBeLessThan(0);
    const female = characterProsodyBias('林舒小姐');
    expect(female.pitchDelta).toBeGreaterThan(0);
    expect(characterProsodyBias('').pitchDelta).toBe(0); // 无名零偏
  });
  it('年龄线索:老者慢、孩童快而高', () => {
    expect(characterProsodyBias('王爷爷').speedMul).toBeLessThanOrEqual(0.92);
    const kid = characterProsodyBias('小娃娃');
    expect(kid.speedMul).toBeGreaterThanOrEqual(1.02);
    expect(kid.pitchDelta).toBeGreaterThan(0);
  });
  it('deriveProsody 叠加 character 后仍在合法区间', () => {
    const p = deriveProsody({ emotion: '激动', emotionTemperature: 8, character: '暴躁大叔' });
    expect(p.pitch).toBeGreaterThanOrEqual(-12);
    expect(p.pitch).toBeLessThanOrEqual(12);
    expect(p.speed).toBeGreaterThanOrEqual(0.5);
    expect(p.speed).toBeLessThanOrEqual(2.0);
    // 不传 character 行为不变(向后兼容)
    const noChar = deriveProsody({ emotion: '激动', emotionTemperature: 8 });
    expect(typeof noChar.pitch).toBe('number');
  });
  // v12.271:grep 源码 → **真路由行为断言**。music 端点是独立 API,能直接跑处理函数,
  // 不必读源码猜。以下四条都是真调 POST 并检查它实际返回/实际落库的东西。
  it('行为:music 路由成功时真的把 music 资产落库(type=music + mediaUrls)', async () => {
    const saved: any[] = [];
    // v12.410:music 路由改走 provider 注册表(此前直连 MiniMax 一家,而它已停服 410,
    // 整项 BGM 能力断服)。注册表按 `available()` 门控 —— 没配 key 的 provider 直接跳过,
    // 而不是拿空 key 去调、换回一个看不懂的 401。旧路由不检查 key 就直接 new,
    // 所以这条测试此前不设 key 也能过;现在要让某一家真的可用。
    process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
    vi.doMock('@/services/minimax.service', () => ({
      MinimaxService: class { async generateMusic() { return 'https://cdn.example/bgm.mp3'; } },
    }));
    vi.doMock('@/lib/asset-storage', () => ({ persistAsset: async () => ({ url: 'https://cdn.example/persisted.mp3' }) }));
    vi.doMock('@/lib/repos/asset-repo', () => ({ upsertAsset: async (a: any) => { saved.push(a); } }));
    vi.doMock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true, guard: {} }) }));
    vi.doMock('../../../auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-1' }) }));
    vi.doMock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-1' }) }));
    vi.doMock('@/lib/repos/project-repo', () => ({ getOwnedProject: async () => ({ id: 'p-1' }) }));
    const mod: any = await import('@/app/api/projects/[id]/music/route');
    const res = await mod.POST(
      { json: async () => ({ prompt: '悬疑 noir,低频大提琴', style: 'noir' }) } as any,
      { params: Promise.resolve({ id: 'p-1' }) } as any,
    );
    expect(res.status, `路由应成功,实际 ${res.status}`).toBe(200);
    // 无条件断言 —— 早期版本用 if(saved.length) 包着,mock 路径写错时会**静默空转**(实测 403 却仍绿)
    expect(saved.length, 'upsertAsset 必须被调用').toBe(1);
    expect(saved[0].type, '必须以 music 类型落库(recompose 靠它当 BGM)').toBe('music');
    expect(Array.isArray(saved[0].mediaUrls) && saved[0].mediaUrls.length > 0).toBe(true);
  });

  it('行为:未登录 → 401(不进任何生成/计费)', async () => {
    vi.doMock('../../../auth/lib', () => ({ getUserFromRequest: () => null }));
    vi.doMock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => null }));
    const mod: any = await import('@/app/api/projects/[id]/music/route');
    const res = await mod.POST({ json: async () => ({ prompt: '悬疑 noir 大提琴' }) } as any,
      { params: Promise.resolve({ id: 'p-1' }) } as any);
    expect(res.status).toBe(401);
  });

  // MusicGenPanel 的挂载属「UI 元素在不在页面上」,用源码存在性核对最直接,
  // 强行渲染整页只会引入更脆的 mock —— 此处诚实保留。
  it('接线:项目页挂载 MusicGenPanel 入口', () => {
    expect(fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8')).toContain('MusicGenPanel');
  });
});
