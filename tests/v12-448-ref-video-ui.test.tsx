/**
 * v12.448 · 界面:镜头工坊的「动作参考」入口与弹窗(真渲染、真点击,网络换成假的)。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { RefVideoModal } from '@/components/project/ref-video-modal';
import { ShotWorkshopTab } from '@/components/project/shot-workshop-tab';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
function mockFetch(route: Route) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch' as never).mockImplementation((async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = route(url, init) ?? { status: 404, body: { error: 'unexpected' } };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
  }) as never);
  return calls;
}

const UPLOADED = { shotNumber: 2, url: '/api/serve-file?key=k', source: 'upload', durationSec: 15, width: 640, height: 360, trimmedFrom: 20 };

describe('v12.448 · 动作参考弹窗', () => {
  it('打开先说清前提:只有 H3 能用、H3 只能按量付费;没挂时显示空态', async () => {
    mockFetch(() => ({ body: { shotNumber: 2, refVideo: null, h3KnownUnavailable: false } }));
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={() => {}} onClose={() => {}} />);
    const note = document.querySelector('[data-ref-video-note]')!;
    expect(note.textContent).toContain('H3');
    expect(note.textContent).toContain('按量付费');
    await waitFor(() => expect(screen.getByText('这一镜还没挂参考视频')).toBeTruthy());
    expect(document.querySelector('[data-h3-unavailable]')).toBeNull();
  });

  it('本服务已确认 H3 不可用时,直说「挂上也会被忽略」', async () => {
    mockFetch(() => ({ body: { shotNumber: 2, refVideo: null, h3KnownUnavailable: true } }));
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-h3-unavailable]')).toBeTruthy());
  });

  it('上传:以 multipart 发出镜号与文件;回来的截取信息如实告知;通知工坊打标', async () => {
    const calls = mockFetch((url, init) => (init?.method === 'POST'
      ? { body: { ok: true, refVideo: UPLOADED, h3KnownUnavailable: false } }
      : { body: { shotNumber: 2, refVideo: null } }));
    const onChange = vi.fn();
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={onChange} onClose={() => {}} />);
    await waitFor(() => screen.getByText('这一镜还没挂参考视频'));
    fireEvent.change(screen.getByLabelText('上传参考视频'), { target: { files: [new File(['x'], 'move.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(2, UPLOADED));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('/api/projects/p1/ref-video');
    const fd = post.init!.body as FormData;
    expect(fd.get('shotNumber')).toBe('2');
    expect((fd.get('file') as File).name).toBe('move.mp4');
    expect(screen.getByRole('status').textContent).toContain('已截取前 15 秒');
    expect(screen.getByText(/本地上传 · 15 秒/)).toBeTruthy();
  });

  it('上传被服务端拒:把原因显示出来,不通知工坊,也不卡在忙碌', async () => {
    mockFetch((url, init) => (init?.method === 'POST'
      ? { status: 422, body: { error: '太短了:1.0 秒,至少 2 秒' } }
      : { body: { refVideo: null } }));
    const onChange = vi.fn();
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={onChange} onClose={() => {}} />);
    await waitFor(() => screen.getByText('这一镜还没挂参考视频'));
    fireEvent.change(screen.getByLabelText('上传参考视频'), { target: { files: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('太短了'));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect((document.querySelector('[data-ref-video-upload]') as HTMLButtonElement).disabled).toBe(false));
  });

  it('贴链接:非 http 当场拦下不发请求;合法链接以 JSON 发出', async () => {
    const calls = mockFetch((url, init) => (init?.method === 'POST'
      ? { body: { ok: true, refVideo: { shotNumber: 2, url: 'https://cdn.example/m.mp4', source: 'link' } } }
      : { body: { refVideo: null } }));
    const onChange = vi.fn();
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={onChange} onClose={() => {}} />);
    await waitFor(() => screen.getByText('这一镜还没挂参考视频'));
    fireEvent.change(screen.getByLabelText('参考视频链接'), { target: { value: 'ftp://x/m.mp4' } });
    fireEvent.click(screen.getByLabelText('保存链接'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('http'));
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('参考视频链接'), { target: { value: 'https://cdn.example/m.mp4' } });
    fireEvent.click(screen.getByLabelText('保存链接'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ shotNumber: 2, url: 'https://cdn.example/m.mp4' });
  });

  it('取下:发 DELETE,通知工坊去掉标记', async () => {
    const calls = mockFetch((url, init) => (init?.method === 'DELETE'
      ? { body: { ok: true, removed: true } }
      : { body: { shotNumber: 2, refVideo: UPLOADED } }));
    const onChange = vi.fn();
    render(<RefVideoModal projectId="p1" shotNumber={2} onChange={onChange} onClose={() => {}} />);
    await waitFor(() => screen.getByText('取下'));
    fireEvent.click(screen.getByText('取下'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(2, null));
    expect(calls.find((c) => c.init?.method === 'DELETE')!.url).toBe('/api/projects/p1/ref-video?shot=2');
    expect(screen.getByText('这一镜还没挂参考视频')).toBeTruthy();
  });
});

describe('v12.448 · 镜头工坊的入口与标记', () => {
  const videos = [{ shotNumber: 1, videoUrl: 'https://v/1.mp4' }, { shotNumber: 2, videoUrl: 'https://v/2.mp4' }];

  it('挂了参考视频的镜显示「动作参考」标记,没挂的不显示;每镜都有入口', async () => {
    mockFetch((url) => (url === '/api/projects/p1/ref-video' ? { body: { items: [{ shotNumber: 2, url: 'https://cdn.example/m.mp4', source: 'link' }] } } : undefined));
    render(<ShotWorkshopTab projectId="p1" videos={videos} storyboards={[]} />);
    await waitFor(() => expect(document.querySelectorAll('[data-ref-video-chip]')).toHaveLength(1));
    expect(document.querySelectorAll('[data-ref-video-open]')).toHaveLength(2);
  });

  it('点入口打开该镜的弹窗;弹窗里取下后标记随之消失', async () => {
    mockFetch((url, init) => {
      if (url === '/api/projects/p1/ref-video') return { body: { items: [{ shotNumber: 2, url: 'https://cdn.example/m.mp4', source: 'link' }] } };
      if (init?.method === 'DELETE') return { body: { ok: true, removed: true } };
      if (url === '/api/projects/p1/ref-video?shot=2') return { body: { shotNumber: 2, refVideo: { shotNumber: 2, url: 'https://cdn.example/m.mp4', source: 'link' } } };
      return undefined;
    });
    render(<ShotWorkshopTab projectId="p1" videos={videos} storyboards={[]} />);
    await waitFor(() => expect(document.querySelectorAll('[data-ref-video-chip]')).toHaveLength(1));
    fireEvent.click(document.querySelector('[data-ref-video-open="2"]')!);
    await waitFor(() => screen.getByRole('dialog', { name: '动作参考视频 · Shot 2' }));
    await waitFor(() => screen.getByText('取下'));
    fireEvent.click(screen.getByText('取下'));
    await waitFor(() => expect(document.querySelectorAll('[data-ref-video-chip]')).toHaveLength(0));
  });

  it('读列表失败不影响工坊本身', async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    render(<ShotWorkshopTab projectId="p1" videos={videos} storyboards={[]} />);
    await waitFor(() => expect(document.querySelectorAll('[data-ref-video-open]')).toHaveLength(2));
    expect(document.querySelectorAll('[data-ref-video-chip]')).toHaveLength(0);
  });
});
