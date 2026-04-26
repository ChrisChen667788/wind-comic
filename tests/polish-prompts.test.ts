/**
 * lib/polish-prompts 的快照 / 行为回归测试。
 *
 * 为什么要测 prompt 文本本身:
 *   Pro 模式的剧本医生是整条管线的"写作质量 QA", 如果 prompt 里的
 *   "三幕结构 / AIGC 铁律 / 锁脸 identity 锚" 这些关键字被误删,
 *   诊断输出就会静默退化, 而没有硬 crash —— 必须测试锁死。
 *
 * 两类断言:
 *   1. 包含关键短语 (防止 prompt 灵魂被悄悄改掉)
 *   2. readiness 分级阈值 (0 / 64 / 65 / 84 / 85 / 100 边界)
 */

import { describe, it, expect } from 'vitest';
import { buildPolishPrompt, readinessLevel } from '@/lib/polish-prompts';

describe('buildPolishPrompt · basic mode', () => {
  it('contains basic-level iron rules and JSON schema', () => {
    const p = buildPolishPrompt({ mode: 'basic' });
    expect(p).toContain('影视文学编辑');
    expect(p).toContain('不新增/删减故事情节');
    expect(p).toContain('polished');
    expect(p).toContain('summary');
    expect(p).toContain('notes');
    // basic 不应该带 pro 独有的 audit 结构
    expect(p).not.toContain('aigcReadiness');
    expect(p).not.toContain('characterAnchors');
  });

  it('honors style / intensity / focus', () => {
    const p = buildPolishPrompt({
      mode: 'basic',
      style: 'commercial',
      intensity: 'heavy',
      focus: '第一人称 + 更多潜台词',
    });
    expect(p).toContain('商业');
    expect(p).toContain('重度');
    expect(p).toContain('第一人称');
  });

  it('falls back gracefully when style is unknown', () => {
    const p = buildPolishPrompt({ mode: 'basic', style: 'gibberish' as any });
    expect(p).toContain('保持原风格');
  });
});

describe('buildPolishPrompt · pro mode (industry grade)', () => {
  const p = buildPolishPrompt({ mode: 'pro', style: 'thriller', intensity: 'moderate' });

  it('cites the three theory pillars (McKee / Field / Seger)', () => {
    // Pro 模式的灵魂 —— 不准被不小心删掉
    expect(p).toContain('McKee');
    expect(p).toContain('Field');
    expect(p).toContain('Seger');
  });

  it('covers all three perspectives: screenwriter / manju / AIGC producer', () => {
    expect(p).toMatch(/编剧医生/);
    expect(p).toMatch(/漫剧|swipe-stop/);
    expect(p).toMatch(/AIGC 制片|AIGC 制片视角/);
  });

  it('enforces AIGC 铁律 (identity lock + promptable lighting + continuity)', () => {
    expect(p).toContain('identity');
    expect(p).toContain('锁脸');
    // 光源方向 + 光质 + 色温 三元组必须都提到
    expect(p).toMatch(/正\/侧\/顶\/逆|光源方向/);
    expect(p).toMatch(/硬光|柔光/);
    expect(p).toMatch(/色温|暖黄|冷蓝/);
    // v2.10 Keyframes 衔接
    expect(p).toMatch(/首尾帧|keyframes|衔接/i);
  });

  it('mandates 3-second hook for vertical short video', () => {
    expect(p).toContain('前 3 秒');
    expect(p).toMatch(/Hook|钩/);
  });

  it('requires structured audit JSON schema', () => {
    // Pro 模式 JSON 骨架里应出现这些关键字段
    const keys = [
      'hook',
      'actStructure',
      'incitingIncident',
      'midpoint',
      'climax',
      'dialogueIssues',
      'onTheNoseLines',
      'characterAnchors',
      'visualLock',
      'sceneLighting',
      'continuityAnchors',
      'styleProfile',
      'aigcReadiness',
      'issues',
    ];
    for (const k of keys) {
      expect(p, `pro prompt missing field: ${k}`).toContain(k);
    }
  });

  it('reflects the chosen style + intensity in pro mode', () => {
    expect(p).toContain('悬疑'); // thriller
    expect(p).toContain('中度');
  });

  it('shares the same JSON strictness tail as basic', () => {
    // 两档都必须禁 markdown 围栏
    expect(p).toMatch(/不要.*markdown 围栏|```json/);
    expect(p).toContain('从第一个 {');
  });
});

describe('readinessLevel thresholds', () => {
  it('< 65 → red', () => {
    expect(readinessLevel(0).level).toBe('red');
    expect(readinessLevel(64).level).toBe('red');
  });
  it('[65, 85) → amber', () => {
    expect(readinessLevel(65).level).toBe('amber');
    expect(readinessLevel(84).level).toBe('amber');
  });
  it('>= 85 → green', () => {
    expect(readinessLevel(85).level).toBe('green');
    expect(readinessLevel(100).level).toBe('green');
  });
  it('labels are non-empty and informative', () => {
    expect(readinessLevel(50).label).toMatch(/不足|重度/);
    expect(readinessLevel(70).label).toMatch(/基本|再过/);
    expect(readinessLevel(95).label).toMatch(/就绪|Director/);
  });
});
