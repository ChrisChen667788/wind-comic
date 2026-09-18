/**
 * v12.447 UI 侧:角度图上传入口。
 *
 * 链路那头(lib/locked-characters → orchestrator → elements-registry)接通之后,
 * 入口如果不做,用户永远填不进去 —— 这正是本仓最常犯的「造好没接线」的另一半。
 * 这里只测**行为**:没正面图不给传、满 3 张收起入口、重复图不进、删得掉。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast-provider';
import { CharacterLockSection, MAX_ANGLE_REFS, type LockedCharacter } from '@/components/create/character-lock-section';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const FRONT = 'https://cdn.example/front.png';
const base = (over: Partial<LockedCharacter> = {}): LockedCharacter =>
  ({ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, ...over });

function renderWith(value: LockedCharacter[]) {
  const onChange = vi.fn();
  render(<ToastProvider><CharacterLockSection value={value} onChange={onChange} /></ToastProvider>);
  return onChange;
}

const upload = (url: string) => vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
  ok: true, json: async () => ({ url }),
} as never);

const pickFile = async (url: string) => {
  upload(url);
  const input = screen.getByLabelText('上传角度图') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
};

describe('v12.447 · 角度图入口', () => {
  it('还没传正面图时不出现角度图入口(先有脸才谈角度)', () => {
    renderWith([base({ imageUrl: '' })]);
    expect(screen.queryByLabelText('上传角度图')).toBeNull();
  });

  it('传了正面图就给入口', () => {
    renderWith([base()]);
    expect(screen.getByLabelText('上传角度图')).toBeTruthy();
  });

  it('上传成功后按选定角度写回 refs', async () => {
    const onChange = renderWith([base()]);
    fireEvent.change(screen.getByLabelText('角度图类型'), { target: { value: 'three_quarter' } });
    await pickFile('https://cdn.example/tq.png');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as LockedCharacter[];
    expect(next[0].refs).toEqual([{ role: 'three_quarter', url: 'https://cdn.example/tq.png' }]);
  });

  it('同一张图不重复进(与正面图重复也算)', async () => {
    const onChange = renderWith([base({ refs: [{ role: 'side', url: 'https://cdn.example/side.png' }] })]);
    await pickFile(FRONT);
    await waitFor(() => expect(screen.getByText('这张图已经在了')).toBeTruthy());
    expect(onChange, '重复图不该写回').not.toHaveBeenCalled();

    cleanup();
    const onChange2 = renderWith([base({ refs: [{ role: 'side', url: 'https://cdn.example/side.png' }] })]);
    await pickFile('https://cdn.example/side.png');
    await waitFor(() => expect(screen.getByText('这张图已经在了')).toBeTruthy());
    expect(onChange2).not.toHaveBeenCalled();
  });

  it(`满 ${MAX_ANGLE_REFS} 张后收起上传入口(而不是让人传完才被拒)`, () => {
    renderWith([base({ refs: [
      { role: 'side', url: 'https://cdn.example/1.png' },
      { role: 'three_quarter', url: 'https://cdn.example/2.png' },
      { role: 'detail', url: 'https://cdn.example/3.png' },
    ] })]);
    expect(screen.queryByLabelText('上传角度图')).toBeNull();
    expect(screen.getAllByText(/移除第|侧面|3\/4 侧|背面/).length).toBeGreaterThan(0);
  });

  it('删得掉,且只删点中的那张', async () => {
    const refs: LockedCharacter['refs'] = [
      { role: 'side', url: 'https://cdn.example/1.png' },
      { role: 'detail', url: 'https://cdn.example/2.png' },
    ];
    const onChange = renderWith([base({ refs })]);
    fireEvent.click(screen.getByLabelText('移除第 1 张角度图'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as LockedCharacter[];
    expect(next[0].refs).toEqual([{ role: 'detail', url: 'https://cdn.example/2.png' }]);
  });

  it('上传失败不写回,也不留下 busy 卡死', async () => {
    const onChange = renderWith([base()]);
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({ ok: false, json: async () => ({ error: '文件太大' }) } as never);
    const input = screen.getByLabelText('上传角度图') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByText('文件太大')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByText('+ 传图') as HTMLButtonElement).disabled).toBe(false));
  });
});
