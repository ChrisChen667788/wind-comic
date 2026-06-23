/**
 * 阶段三十 v12.39.0 — 声音克隆纯函数单测。
 */
import { describe, expect, it } from 'vitest';
import {
  isValidVoiceId,
  normalizeVoiceId,
  buildVoiceCloneBody,
  parseVoiceCloneResponse,
  parseFileUploadResponse,
} from '@/lib/voice-clone';

describe('isValidVoiceId', () => {
  it('≥8 + 字母数字 + 字母开头', () => {
    expect(isValidVoiceId('winda1234')).toBe(true);
    expect(isValidVoiceId('abc')).toBe(false);          // 太短
    expect(isValidVoiceId('1winda234')).toBe(false);    // 数字开头
    expect(isValidVoiceId('winda_123')).toBe(false);    // 含下划线
  });
});

describe('normalizeVoiceId', () => {
  it('产出合法 id + 确定性(同名同 id)', () => {
    const a = normalizeVoiceId('陆晚晚');
    const b = normalizeVoiceId('陆晚晚');
    expect(a).toBe(b);
    expect(isValidVoiceId(a)).toBe(true);
  });
  it('ASCII 名也合法', () => {
    expect(isValidVoiceId(normalizeVoiceId('Hero'))).toBe(true);
    expect(isValidVoiceId(normalizeVoiceId('x'))).toBe(true); // 短名补足
  });
});

describe('buildVoiceCloneBody', () => {
  it('合法 → body;非法 voiceId/缺 fileId → throw', () => {
    expect(buildVoiceCloneBody('f1', 'winda1234')).toEqual({ file_id: 'f1', voice_id: 'winda1234', model: 'speech-02-hd' });
    expect(() => buildVoiceCloneBody('', 'winda1234')).toThrow(/file_id/);
    expect(() => buildVoiceCloneBody('f1', 'bad')).toThrow(/voice_id/);
  });
});

describe('parseVoiceCloneResponse', () => {
  it('ok → voiceId;base_resp 非 0 → throw', () => {
    expect(parseVoiceCloneResponse({ base_resp: { status_code: 0 } }, 'winda1234')).toEqual({ voiceId: 'winda1234', demoAudio: undefined });
    expect(() => parseVoiceCloneResponse({ base_resp: { status_code: 1026, status_msg: 'sensitive' } }, 'winda1234')).toThrow(/1026/);
  });
});

describe('parseFileUploadResponse', () => {
  it('取 file.file_id 或 file_id;缺/错 → throw', () => {
    expect(parseFileUploadResponse({ file: { file_id: 123 } })).toBe('123');
    expect(parseFileUploadResponse({ file_id: 'abc' })).toBe('abc');
    expect(() => parseFileUploadResponse({})).toThrow(/no file_id/);
    expect(() => parseFileUploadResponse({ base_resp: { status_code: 2 } })).toThrow(/file upload/);
  });
});
