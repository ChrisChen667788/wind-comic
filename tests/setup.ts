import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 每个测试后清理
afterEach(() => {
  cleanup();
});

// In-memory localStorage 实现 — 真正可读写, 测试可断言内容
// (此前是裸 vi.fn() 桩, 任何 setItem 都被吃掉, getItem 永远 undefined,
//  导致 wizard 草稿等测试无法验证 "保存到 localStorage")
const __localStore = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => (__localStore.has(key) ? __localStore.get(key)! : null),
  setItem: (key: string, value: string) => { __localStore.set(key, String(value)); },
  removeItem: (key: string) => { __localStore.delete(key); },
  clear: () => { __localStore.clear(); },
  key: (i: number) => Array.from(__localStore.keys())[i] ?? null,
  get length() { return __localStore.size; },
};
global.localStorage = localStorageMock as any;
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
