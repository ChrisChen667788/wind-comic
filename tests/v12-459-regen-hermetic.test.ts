/**
 * v12.459 · 单镜重生在 MOCK_ENGINES=1 下必须全封闭。
 *
 * 真机验证片段重拍时,开着 MOCK_ENGINES=1,MiniMax 仍真建了一条 Hailuo-2.3 任务:
 * 单镜重生有自己一条直连引擎的链,从不经过插件链(mock-video 只在插件链里排第一)。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { hermeticRegenAttempts } from '@/lib/regen-hermetic';
import { resolveVerifiedServeFilePath } from '@/lib/serve-file-sign';
import { resolveFFprobePath } from '@/services/video-composer';

const FP = resolveFFprobePath();
const HAS_FFPROBE = spawnSync(FP, ['-version']).status === 0;

afterEach(() => { delete process.env.MOCK_ENGINES; });

describe('v12.459 · 单镜重生全封闭', () => {
  it('没开 MOCK_ENGINES → 引擎链原样返回(线上零变化)', () => {
    const attempts = [{ name: 'veo', gen: vi.fn() }, { name: 'minimax', gen: vi.fn() }];
    expect(hermeticRegenAttempts(attempts, { prompt: 'p', durationS: 3 })).toBe(attempts);
  });

  it('**开了 MOCK_ENGINES → 一个真引擎都不调**,只剩本地假片', async () => {
    process.env.MOCK_ENGINES = '1';
    const veo = vi.fn(); const minimax = vi.fn(); const kling = vi.fn();
    const out = hermeticRegenAttempts(
      [{ name: 'veo', gen: veo }, { name: 'minimax', gen: minimax }, { name: 'kling', gen: kling }],
      { prompt: '她回头', durationS: 3, aspect: '16:9' },
    );
    expect(out.map((a) => a.name)).toEqual(['mock-video']);
    const url = await out[0].gen();
    expect(veo).not.toHaveBeenCalled();
    expect(minimax).not.toHaveBeenCalled();
    expect(kling).not.toHaveBeenCalled();
    // 站内签名地址(不是 http://localhost —— 那会被 safeFetch 的 SSRF 防护拦下)
    expect(url).toMatch(/^\/api\/serve-file\?path=/);
    const file = resolveVerifiedServeFilePath(url);
    expect(file && fs.existsSync(file)).toBe(true);
    if (HAS_FFPROBE) {
      const d = Number(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file!]).toString());
      expect(Math.round(d)).toBe(3);
    }
  }, 60_000);

  it('编排器的单镜重生真的走了这道闸(否则上面两条等于没测)', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    const i = src.indexOf('async regenerateShot(');
    const j = src.indexOf('for (const a of attempts)', i);
    expect(i).toBeGreaterThan(0);
    expect(j, '找不到引擎循环').toBeGreaterThan(i);
    expect(src.slice(i, j)).toContain('hermeticRegenAttempts(');
  });
});
