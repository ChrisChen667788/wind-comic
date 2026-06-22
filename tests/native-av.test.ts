/**
 * 阶段二十七 P1 — 原生音画一体决策层单测(纯函数)。默认关 → 行为不变。
 */
import { describe, expect, it } from 'vitest';
import {
  nativeAudioEnabled,
  isNativeAudioProvider,
  shouldUseNativeAudio,
  nativeAudioShotNumbers,
  partitionDialogueShots,
} from '@/lib/native-av';

describe('nativeAudioEnabled', () => {
  it('仅 NATIVE_AV=1 开启', () => {
    const saved = process.env.NATIVE_AV;
    delete process.env.NATIVE_AV;
    expect(nativeAudioEnabled()).toBe(false);
    process.env.NATIVE_AV = '1';
    expect(nativeAudioEnabled()).toBe(true);
    process.env.NATIVE_AV = '0';
    expect(nativeAudioEnabled()).toBe(false);
    if (saved === undefined) delete process.env.NATIVE_AV; else process.env.NATIVE_AV = saved;
  });
});

describe('isNativeAudioProvider', () => {
  it('原生音频引擎(含变体)→ true', () => {
    expect(isNativeAudioProvider('grok-imagine')).toBe(true);
    expect(isNativeAudioProvider('seedance')).toBe(true);
    expect(isNativeAudioProvider('veo')).toBe(true);
    expect(isNativeAudioProvider('kling')).toBe(true);
    expect(isNativeAudioProvider('kling-flf')).toBe(true); // 变体前缀
    expect(isNativeAudioProvider('ltx')).toBe(true);
  });
  it('非原生 / 空 → false', () => {
    expect(isNativeAudioProvider('minimax-video')).toBe(false);
    expect(isNativeAudioProvider('vidu')).toBe(false);
    expect(isNativeAudioProvider(undefined)).toBe(false);
    expect(isNativeAudioProvider('')).toBe(false);
  });
});

describe('shouldUseNativeAudio', () => {
  it('开关 + 有台词 + 原生引擎 三者齐备才 true', () => {
    expect(shouldUseNativeAudio({ enabled: true, hasDialogue: true, ranProvider: 'veo' })).toBe(true);
    expect(shouldUseNativeAudio({ enabled: false, hasDialogue: true, ranProvider: 'veo' })).toBe(false);
    expect(shouldUseNativeAudio({ enabled: true, hasDialogue: false, ranProvider: 'veo' })).toBe(false);
    expect(shouldUseNativeAudio({ enabled: true, hasDialogue: true, ranProvider: 'minimax-video' })).toBe(false);
    expect(shouldUseNativeAudio({ enabled: true, hasDialogue: true, ranProvider: undefined })).toBe(false);
  });
});

describe('nativeAudioShotNumbers', () => {
  it('只收带 nativeAudio 标记 + 有 shotNumber 的镜', () => {
    const clips = [
      { shotNumber: 1, nativeAudio: true },
      { shotNumber: 2, nativeAudio: false },
      { shotNumber: 3 },
      { nativeAudio: true }, // 无 shotNumber → 丢
      { shotNumber: 5, nativeAudio: true },
    ];
    expect(nativeAudioShotNumbers(clips)).toEqual([1, 5]);
  });
});

describe('partitionDialogueShots', () => {
  it('按 native 集合把有台词镜分两组', () => {
    const shots = [{ shotNumber: 1 }, { shotNumber: 2 }, { shotNumber: 3 }];
    const { tts, native } = partitionDialogueShots(shots, new Set([2]));
    expect(tts.map((s) => s.shotNumber)).toEqual([1, 3]);
    expect(native.map((s) => s.shotNumber)).toEqual([2]);
  });
  it('空 native 集合 → 全走 TTS(零回归)', () => {
    const shots = [{ shotNumber: 1 }, { shotNumber: 2 }];
    const { tts, native } = partitionDialogueShots(shots, new Set());
    expect(tts.length).toBe(2);
    expect(native.length).toBe(0);
  });
});
