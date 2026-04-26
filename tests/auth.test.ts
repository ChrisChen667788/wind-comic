import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getToken, setToken, clearToken, getStoredUser, storeUser, clearUser } from '@/lib/auth';

describe('Auth Utils', () => {
  // 注: tests/setup.ts 现在用的是真实 in-memory localStorage (Map 实现),
  // 不再是裸 vi.fn(). 因此这里用 vi.spyOn 包一层, 既能保留 toHaveBeenCalledWith
  // 断言风格, 又能让 getItem 走真实存储.
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(localStorage, 'getItem');
    vi.spyOn(localStorage, 'setItem');
    vi.spyOn(localStorage, 'removeItem');
  });

  it('setToken stores token', () => {
    setToken('test-token');
    expect(localStorage.setItem).toHaveBeenCalledWith('qfmj-token', 'test-token');
    expect(localStorage.getItem('qfmj-token')).toBe('test-token');
  });

  it('getToken retrieves token', () => {
    localStorage.setItem('qfmj-token', 'my-token');
    expect(getToken()).toBe('my-token');
  });

  it('clearToken removes token', () => {
    localStorage.setItem('qfmj-token', 'stale');
    clearToken();
    expect(localStorage.removeItem).toHaveBeenCalledWith('qfmj-token');
    expect(localStorage.getItem('qfmj-token')).toBeNull();
  });

  it('storeUser stores user JSON', () => {
    const user = { id: '1', name: 'Test' };
    storeUser(user);
    expect(localStorage.setItem).toHaveBeenCalledWith('qfmj-user', JSON.stringify(user));
    expect(localStorage.getItem('qfmj-user')).toBe(JSON.stringify(user));
  });

  it('getStoredUser parses stored user', () => {
    localStorage.setItem('qfmj-user', '{"id":"1","name":"Test"}');
    const user = getStoredUser();
    expect(user).toEqual({ id: '1', name: 'Test' });
  });

  it('getStoredUser returns null for invalid JSON', () => {
    localStorage.setItem('qfmj-user', 'invalid');
    expect(getStoredUser()).toBeNull();
  });

  it('clearUser removes user', () => {
    localStorage.setItem('qfmj-user', '{}');
    clearUser();
    expect(localStorage.removeItem).toHaveBeenCalledWith('qfmj-user');
    expect(localStorage.getItem('qfmj-user')).toBeNull();
  });
});
