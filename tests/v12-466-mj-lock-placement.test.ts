/**
 * v12.466(随本版带上的 v12.465 补丁)· 草图锁那句不能落在 MJ 的 `--no` 参数后面。
 *
 * 编排器把草图锁(` [STORYBOARD LOCK] Strictly follow the composition …`)**追加在提示词末尾**,
 * 而这时提示词多半已经带着 `optimizeMidjourneyPrompt` 加的 `--no text, watermark …` ——
 * MJ 把 `--no` 之后的文字都当负面词:「严格按草图构图」就成了「不要按草图构图」。
 * v12.465 新加的 MJ 垫图(MJ_SKETCH_IMAGE_PROMPT=1)会让 MJ 收到这句锁,所以在 MJ 服务里挪到参数之前。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lockBeforeParams, stripSketchLock } from '@/lib/image-router';
import { buildSketchDirective } from '@/lib/storyboard-sketch';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const LOCK = buildSketchDirective({ shotSize: 'LS', angle: 'high' });

describe('v12.466 · lockBeforeParams', () => {
  it('**锁在 --no 之后 → 挪到第一个参数之前**,其余文字与参数原样', () => {
    const p = `a rainy street. Color: ACES color pipeline, filmic tonal range --ar 9:16 --no text, watermark${LOCK}`;
    const out = lockBeforeParams(p);
    expect(out).toBe(`a rainy street. Color: ACES color pipeline, filmic tonal range${LOCK} --ar 9:16 --no text, watermark`);
    expect(out.indexOf('[STORYBOARD LOCK]')).toBeLessThan(out.indexOf('--no'));
    expect(stripSketchLock(out), '挪过之后照样能被整句剥掉').toBe('a rainy street. Color: ACES color pipeline, filmic tonal range --ar 9:16 --no text, watermark');
  });

  it('换行后追加的画中字说明留在原处,只挪锁那一句', () => {
    const p = `a sign --no text${LOCK}\nRender the sign text exactly: 雨夜`;
    expect(lockBeforeParams(p)).toBe(`a sign${LOCK} --no text\nRender the sign text exactly: 雨夜`);
  });

  it('没有锁 / 没有参数 / 锁已经在参数前:原样(正常侧)', () => {
    expect(lockBeforeParams('a rainy street --ar 9:16 --no text')).toBe('a rainy street --ar 9:16 --no text');
    expect(lockBeforeParams(`a rainy street${LOCK}`)).toBe(`a rainy street${LOCK}`);
    expect(lockBeforeParams(`a rainy street${LOCK} --ar 9:16`)).toBe(`a rainy street${LOCK} --ar 9:16`);
  });
});

describe('v12.466 · MJ 提交的提示词里锁在参数前', () => {
  it('**/mj/submit/imagine 的 prompt:锁在 --no 之前,--ar 等参数仍在末尾**', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u).includes('/mj/submit/imagine')) bodies.push(JSON.parse(String(init!.body)));
      return { ok: true, status: 200, json: async () => ({ code: 0, description: 'stop-after-submit' }) };
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { MidjourneyService } = await import('@/services/midjourney.service');
    const svc = new MidjourneyService('test-key');
    await expect(svc.generateImage(`a rainy street --no text, watermark${LOCK}`, { aspectRatio: '9:16', skipUpscale: true })).rejects.toThrow('stop-after-submit');
    const p: string = bodies[0].prompt;
    expect(p.indexOf('[STORYBOARD LOCK]')).toBeGreaterThan(0);
    expect(p.indexOf('[STORYBOARD LOCK]'), '锁在负面词参数之前').toBeLessThan(p.indexOf('--no'));
    expect(p, '窗口自证:MJ 参数照常追加').toMatch(/--ar 9:16/);
  });
});
