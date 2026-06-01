/**
 * v9.2.2 — lib/slim-prompts 单测 (草稿精简编剧提示: 骨架要素 + 体积上限 + JSON 契约).
 */
import { describe, it, expect } from 'vitest';
import { getSlimWriterPrompt, DRAFT_JSON_CONTRACT } from '@/lib/slim-prompts';
import { getMcKeeWriterPrompt } from '@/lib/mckee-skill';

describe('v9.2.2 · getSlimWriterPrompt', () => {
  it('保留三幕骨架要素 (钩子 / 反转 / 悬念 / 三幕 / 前3秒)', () => {
    const p = getSlimWriterPrompt('cinematic');
    expect(p).toContain('钩子');
    expect(p).toContain('反转');
    expect(p).toMatch(/悬念|钩子/);
    expect(p).toContain('三幕');
    expect(p).toMatch(/前 3 秒/);
  });

  it('含严格 JSON 契约 (title/shots/字段 + 禁 markdown)', () => {
    const p = getSlimWriterPrompt('cinematic');
    expect(p).toContain(DRAFT_JSON_CONTRACT);
    for (const f of ['title', 'synopsis', 'shots', 'shotNumber', 'sceneDescription', 'action', 'emotion', 'characters', 'visualPrompt']) {
      expect(p).toContain(f);
    }
    expect(p).toMatch(/无 markdown|无 ```/);
  });

  it('体积远小于完整 McKee (<15%, 且绝对 <1000 字)', () => {
    const slim = getSlimWriterPrompt('cinematic', { note: '草稿 #1 · 温度 0.7' });
    const mckee = getMcKeeWriterPrompt('', 'cinematic', { isScriptAdaptation: false, directorTotalShots: 6, minShots: 4, maxShots: 8 });
    expect(slim.length).toBeLessThan(1000);
    expect(slim.length).toBeLessThan(mckee.length * 0.15);
  });

  it('注入画风; 空 / 纯空白 → 默认 cinematic', () => {
    expect(getSlimWriterPrompt('诗意水墨')).toContain('诗意水墨');
    expect(getSlimWriterPrompt('')).toContain('cinematic');
    expect(getSlimWriterPrompt('   ')).toContain('cinematic');
  });

  it('镜头范围进文案; 默认 4-8; maxShots 不小于 minShots (clamp)', () => {
    expect(getSlimWriterPrompt('x')).toContain('4-8');
    expect(getSlimWriterPrompt('x', { minShots: 3, maxShots: 5 })).toContain('3-5');
    expect(getSlimWriterPrompt('x', { minShots: 6, maxShots: 2 })).toContain('6-6');
  });

  it('note 提供时附加, 缺省时不含', () => {
    expect(getSlimWriterPrompt('x', { note: '草稿 #2 · 温度 0.95' })).toContain('附注: 草稿 #2 · 温度 0.95');
    expect(getSlimWriterPrompt('x')).not.toContain('附注:');
  });
});
