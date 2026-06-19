/**
 * v12.13.1(劲爆度第二波)— 打击音效层 + 选择性 impact 慢镜。
 */
import { describe, it, expect } from 'vitest';
import { findImpactCues, impactShotSet, impactSfxNode, IMPACT_VERBS_RE } from '@/lib/impact-sfx';
import { detectHighlights } from '@/services/video-composer';

describe('v12.13.1 · findImpactCues', () => {
  const shots = [
    { shotNumber: 1, duration: 3, beats: [
      { startSec: 0, endSec: 1, action: '起手蓄势' },                         // 无冲击
      { startSec: 1, endSec: 2, action: '右膝顶进对手肋部', speedRamp: '0.2x slow-mo on impact' }, // speedRamp → 强冲击
    ] },
    { shotNumber: 2, duration: 3, beats: [
      { startSec: 0, endSec: 1.5, action: '裹火拳套轰中护臂' },               // 动词「轰中」→ 冲击
    ] },
    { shotNumber: 3, duration: 4, beats: [
      { startSec: 0, endSec: 2, action: '缓步走向出口' },                      // 无冲击
    ] },
  ];

  it('命中 speedRamp / 冲击动词,跳过无冲击 beat', () => {
    const cues = findImpactCues(shots as any);
    expect(cues.map((c) => c.shotNumber)).toEqual([1, 2]);
    expect(cues.find((c) => c.shotNumber === 1)?.intensity).toBe(1.0); // speedRamp 更强
    expect(cues.find((c) => c.shotNumber === 2)?.intensity).toBe(0.7); // 纯动词次之
  });

  it('atSec 取 beat 中点', () => {
    const cues = findImpactCues(shots as any);
    expect(cues.find((c) => c.shotNumber === 1)?.atSec).toBe(1.5); // (1+2)/2
  });

  it('impactShotSet 去重镜号', () => {
    expect([...impactShotSet(findImpactCues(shots as any))].sort()).toEqual([1, 2]);
  });

  it('IMPACT_VERBS_RE 命中中英冲击动词', () => {
    expect(IMPACT_VERBS_RE.test('一拳砸中面门')).toBe(true);
    expect(IMPACT_VERBS_RE.test('a hard punch lands')).toBe(true);
    expect(IMPACT_VERBS_RE.test('缓缓转身离开')).toBe(false);
  });
});

describe('v12.13.1 · impactSfxNode(ffmpeg 滤镜源节点)', () => {
  it('合成闷响打击:含 anoisesrc + 低通 + 衰减 + 立体声 + adelay 定位 + 标签', () => {
    const node = impactSfxNode(1500, 1.0, 'sfx0');
    expect(node).toContain('anoisesrc=');
    expect(node).toContain('lowpass=f=250');
    expect(node).toContain('afade=t=out');
    expect(node).toContain('channel_layouts=stereo');
    expect(node).toContain('adelay=1500|1500');
    expect(node).toMatch(/\[sfx0\]$/);
  });
  it('负偏移钳到 0、强度越界不报错', () => {
    expect(impactSfxNode(-50, 5, 'sfx1')).toContain('adelay=0|0');
  });
});

describe('v12.13.1 · 选择性 impact 慢镜', () => {
  const hl = { shotNumber: 3, videoUrl: 'x.mp4', transition: 'cut', emotionTemperature: 9, tensionLevel: 9 };

  it('短冲击镜(≤2s 且在 impactShots)→ 强调慢镜 0.55', () => {
    const [a] = detectHighlights([{ ...hl, duration: 1.5 }], { actionMode: true, impactShots: [3] });
    expect(a.editStrategy.speedMultiplier).toBe(0.55);
  });
  it('长镜即便是冲击镜也不慢放(避免泄气)', () => {
    const [a] = detectHighlights([{ ...hl, duration: 5 }], { actionMode: true, impactShots: [3] });
    expect(a.editStrategy.speedMultiplier).toBe(1.0);
  });
  it('非冲击镜的动作高光保持 1.0', () => {
    const [a] = detectHighlights([{ ...hl, duration: 1.5 }], { actionMode: true, impactShots: [99] });
    expect(a.editStrategy.speedMultiplier).toBe(1.0);
  });
});
