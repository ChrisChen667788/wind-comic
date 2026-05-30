'use client';

/**
 * v8.3 P6.1 — Phosphor 全局图标默认 (ultra-thin Light weight).
 *
 * lucide → Phosphor 全量迁移后, 89 个文件的图标默认走 context 的 light 字重 (premium 细线),
 * 不必逐个 usage 写 weight; 个别需强调的图标 (P1 已手动设 duotone/bold) 的显式 prop 仍覆盖此默认。
 */

import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <IconContext.Provider value={{ weight: 'light' }}>
      {children}
    </IconContext.Provider>
  );
}
