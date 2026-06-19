/**
 * v12.13.0(打斗劲爆度)— 动作模式剪辑策略:高光不整段慢放 + 硬切。
 */
import { describe, it, expect } from 'vitest';
import { detectHighlights } from '@/services/video-composer';
import { buildBeatSheetBlock } from '@/lib/writer-enhance';

// 强高光镜:极端情感(±9 → +35) + 高张力(9 → +30) = 65 ≥ 40 → highlight
const hlClip = { shotNumber: 3, videoUrl: 'x.mp4', duration: 3, transition: 'cross-dissolve', emotionTemperature: 9, tensionLevel: 9 };
const calmClip = { shotNumber: 2, videoUrl: 'y.mp4', duration: 5, transition: 'cross-dissolve', emotionTemperature: 1, tensionLevel: 3 };

describe('v12.13.0 · detectHighlights actionMode', () => {
  it('普通模式:高光镜降速做慢动作(保留既有行为)', () => {
    const [a] = detectHighlights([hlClip]);
    expect(a.isHighlight).toBe(true);
    expect(a.editStrategy.speedMultiplier).toBeLessThan(1.0); // 慢放
  });

  it('动作模式:高光镜不降速(speed=1.0)+ 硬切', () => {
    const [a] = detectHighlights([hlClip], { actionMode: true });
    expect(a.isHighlight).toBe(true);
    expect(a.editStrategy.speedMultiplier).toBe(1.0);       // 禁止整段慢放
    expect(a.editStrategy.transition).toBe('cut');           // 硬切
    expect(a.editStrategy.transitionDuration).toBeLessThan(0.15); // 极短转场
  });

  it('动作模式:非高光中段也硬切、不淡入', () => {
    // 放在序列中段(position>=0.2),低张力 → 轻微加速 + 硬切
    const [, mid] = detectHighlights([calmClip, { ...calmClip, shotNumber: 5 }, calmClip], { actionMode: true });
    expect(mid.editStrategy.transition).toBe('cut');
    expect(mid.editStrategy.speedMultiplier).toBeGreaterThanOrEqual(1.0); // 绝不慢放
  });

  it('buildBeatSheetBlock 含动作节奏铁律', () => {
    const b = buildBeatSheetBlock();
    expect(b).toContain('动作/打斗段的节奏铁律');
    expect(b).toContain('speedRamp');
    expect(b).toContain('continuous');
  });
});
