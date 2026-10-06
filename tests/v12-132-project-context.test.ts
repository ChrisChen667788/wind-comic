/**
 * v12.132 — issue #2 Bug B:重生/补拍统一贯通角色参考(parseProjectContext / applyProjectContext)。
 */
import { describe, it, expect, vi } from 'vitest';
import { parseProjectContext, applyProjectContext } from '@/lib/orchestrator-project-context';

describe('v12.132 · 项目上下文贯通', () => {
  it('parseProjectContext:三列都解析,locked_characters 容错', () => {
    const ctx = parseProjectContext({
      style_id: 'cinematic',
      primary_character_ref: 'https://cdn/monster.png',
      locked_characters: JSON.stringify([{ name: '毛绒怪', role: 'lead', cw: 100, imageUrl: 'u' }]),
    });
    expect(ctx.styleId).toBe('cinematic');
    expect(ctx.primaryRef).toBe('https://cdn/monster.png');
    expect(ctx.lockedCharacters).toHaveLength(1);
  });
  it('非法 locked_characters JSON → 空数组不炸', () => {
    expect(parseProjectContext({ locked_characters: '{bad' }).lockedCharacters).toEqual([]);
  });
  it('空行 / null 安全', () => {
    expect(parseProjectContext(null).lockedCharacters).toEqual([]);
    expect(parseProjectContext({}).styleId).toBeUndefined();
  });
  it('applyProjectContext:调用三个 setter,返回实际贯通项', () => {
    const orch = { setUserStyle: vi.fn(), setPrimaryCharacterRef: vi.fn(), setLockedCharacters: vi.fn(), setAspect: vi.fn() };
    const applied = applyProjectContext(orch, {
      styleId: 's', primaryRef: 'r',
      lockedCharacters: [{ name: 'a', role: 'lead', cw: 100, imageUrl: 'u' }],
    });
    expect(orch.setUserStyle).toHaveBeenCalledWith('s');
    expect(orch.setPrimaryCharacterRef).toHaveBeenCalledWith('r');
    expect(orch.setLockedCharacters).toHaveBeenCalledOnce();
    expect(applied).toEqual({ style: true, primaryRef: true, locked: 1, aspect: null }); // v12.467 起多一项画幅
    expect(orch.setAspect).not.toHaveBeenCalled(); // 没画幅就不动编排器的默认值
  });
  it('无角色参考时只贯通 style,不误调 setter', () => {
    const orch = { setUserStyle: vi.fn(), setPrimaryCharacterRef: vi.fn(), setLockedCharacters: vi.fn(), setAspect: vi.fn() };
    applyProjectContext(orch, { styleId: 's', lockedCharacters: [] });
    expect(orch.setPrimaryCharacterRef).not.toHaveBeenCalled();
    expect(orch.setLockedCharacters).not.toHaveBeenCalled();
  });
});
