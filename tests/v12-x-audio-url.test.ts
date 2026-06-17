/**
 * #4 修复回归 —— 配音 URL 加载分类:成片没人声 的根因是 TTS 返回 data:/serve-file
 * 被当成「非 http」丢弃。锁死三种形态的处理。
 */
import { describe, it, expect } from 'vitest';
import { audioUrlLoadKind } from '@/lib/audio-url';

describe('#4 · audioUrlLoadKind', () => {
  it('vectorengine-tts 的 data:audio → 解码加载(此前被丢)', () => {
    expect(audioUrlLoadKind('data:audio/mpeg;base64,AAAA')).toBe('data');
  });
  it('minimax 的 /api/serve-file?path= → 下载加载(此前被丢)', () => {
    expect(audioUrlLoadKind('/api/serve-file?path=%2Ftmp%2Fvo.mp3')).toBe('download');
  });
  it('http(s) → 下载', () => {
    expect(audioUrlLoadKind('https://cdn/v.mp3')).toBe('download');
    expect(audioUrlLoadKind('http://cdn/v.mp3')).toBe('download');
  });
  it('空 / 未知形态 → 跳过(不静默当 http)', () => {
    expect(audioUrlLoadKind('')).toBe('skip');
    expect(audioUrlLoadKind(null)).toBe('skip');
    expect(audioUrlLoadKind(undefined)).toBe('skip');
    expect(audioUrlLoadKind('file:///x.mp3')).toBe('skip');
    expect(audioUrlLoadKind('relative/path.mp3')).toBe('skip');
  });
});
