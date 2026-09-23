/**
 * v12.453 · 创作页角色锁定区两处真机问题(v12.447 真机发现,当时另开待办)。
 *
 * ① 更新函数不纯:onChange(父组件的 setState)写在 setSlots 的更新函数里面 —— React 可能在渲染期调用它,
 *    报「渲染中更新别的组件」;StrictMode 下更新函数会被调两次,父组件因此被通知两次。
 * ② 槽位栅格按视口断点排(md:grid-cols-3),而它实际在一个 320px 宽的窄列里 —— 1024 宽下每格被压到 99px,
 *    角色名输入框只剩 18px、整排控件溢出卡片外点不到(jsdom 量不了布局,这条的真凭据是浏览器实测)。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast-provider';
import { CharacterLockSection, type LockedCharacter } from '@/components/create/character-lock-section';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderStrict(value: LockedCharacter[] = []) {
  const onChange = vi.fn();
  const { container } = render(
    <StrictMode>
      <ToastProvider><CharacterLockSection value={value} onChange={onChange} /></ToastProvider>
    </StrictMode>,
  );
  return { onChange, container };
}

describe('v12.453 · 角色锁定区', () => {
  it('StrictMode 下改一次角色名,父组件只被通知一次(修前更新函数被调两次 → 通知两次)', async () => {
    const { onChange } = renderStrict();
    const name = screen.getAllByPlaceholderText(/角色名/)[0];
    fireEvent.change(name, { target: { value: '林晚' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('改动期间不出现 React 的「渲染中更新别的组件」告警', async () => {
    const errs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errs.push(a.map(String).join(' ')); });
    const { onChange } = renderStrict();
    fireEvent.change(screen.getAllByPlaceholderText(/角色名/)[0], { target: { value: '陆沉' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(errs.filter((e) => /Cannot update a component|渲染中更新|update a component .* while rendering/i.test(e))).toEqual([]);
  });

  it('连着改两个槽位,两次改动都留得住(更新函数改用当前 state 算,不能把前一次冲掉)', async () => {
    const { onChange } = renderStrict();
    const names = screen.getAllByPlaceholderText(/角色名/);
    fireEvent.change(names[0], { target: { value: '林晚' } });
    fireEvent.change(names[1], { target: { value: '陆沉' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect((names[0] as HTMLInputElement).value).toBe('林晚');
    expect((names[1] as HTMLInputElement).value).toBe('陆沉');
  });

  it('槽位栅格按可用宽度排,不再用视口断点(窄列里 md:grid-cols-3 会把每格压到 99px)', () => {
    const { container } = renderStrict();
    const grid = [...container.querySelectorAll('div')].find((d) => d.className.includes('grid') && d.className.includes('gap-3') && d.querySelector('input[placeholder^="角色名"]'));
    expect(grid, '找得到槽位栅格').toBeTruthy();
    expect(grid!.className).toContain('auto-fit');
    expect(grid!.className).toContain('minmax(200px');
    expect(grid!.className, '不能再按视口断点分列').not.toMatch(/\b(sm|md|lg|xl):grid-cols-/);
  });
});
