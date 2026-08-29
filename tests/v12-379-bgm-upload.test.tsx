/**
 * v12.379:AI 作曲塌了之后,这个片子没有任何办法配上背景乐。
 *
 * v12.376 查明 MiniMax Music API 对本账号已永久停用(410 / 2153),
 * 而它是本项目唯一的配乐来源。后端其实一直留着另一条口子 ——
 * recompose 认 `body.bgmUrl`(customBgm),优先级还在 music 资产之上 ——
 * 但全仓搜下来**前端零消费方**:能力做好了、入口没接,
 * 只因 AI 作曲一直能用,没人发现。现在它成了唯一通路。
 *
 * 补通道时又挖出一个更值得修的:recompose 取 `musicAssets[0]`,
 * 而 listAssetsByType 是 `ORDER BY shot_number` —— music 资产的 shot_number 全是 NULL,
 * 顺序实际由插入次序决定。项目 1 有两条(6 月那条 AI 作曲文件早丢了、刚上传的自备),
 * [0] 稳稳取到坏的那条 —— **上传了却没声音,还查不出原因**。
 * v12.374 的守卫本来就能判可达性;既然能判,就该拿它来**选**,不只是用来**拒**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { MusicGenPanel } from '@/components/project/music-gen-panel';

const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/recompose/route.ts'), 'utf-8');

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('自备 BGM 的入口真的在界面上', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('渲染出上传控件,且只收音频', () => {
    const { container } = render(<MusicGenPanel projectId="p1" />);
    expect(screen.getByText(/上传自己的音乐/)).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input, '没有文件选择控件,这条通路就还是不存在').toBeTruthy();
    expect(input.accept).toBe('audio/*');
  });

  it('选中文件即调上传端点(不是只把文件名显示出来)', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any, o: any) => {
      calls.push({ url: String(u), body: o?.body });
      return { ok: true, json: async () => ({ ok: true, musicUrl: '/api/serve-file?key=abc' }) } as any;
    }));
    const { container } = render(<MusicGenPanel projectId="p1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'bgm.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toContain('/api/projects/p1/music/upload');
    expect(calls[0].body, '要用 multipart 传文件').toBeInstanceOf(FormData);
    await waitFor(() => expect(screen.getByText(/已存为项目配乐/)).toBeTruthy());
  });

  it('AI 作曲返回「已停用」时改口,不再让人重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ message: 'AI 作曲失败:该接口已对本账号停用', code: 'PROVIDER_DISCONTINUED' }),
    })) as any);
    const { container } = render(<MusicGenPanel projectId="p1" />);
    const text = container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /AI 作曲/.test(b.textContent || ''))!;
    // 直接触发 React 的 onChange:jsdom 里赋值 .value 不会冒泡出 change
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(text, '悬疑 noir 大提琴');
    text.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();

    // 「已对本账号停用」同时出现在错误行和提示行里,取提示行独有的措辞
    await waitFor(() => expect(screen.getByText(/重试和充值都无效/)).toBeTruthy());
    // 提示里应当**指名**可行的那条路,而不是只说「失败了」——
    // 所以「上传自己的音乐」会出现两次:一次是区域标签,一次是提示里的指引
    expect(screen.getAllByText(/上传自己的音乐/).length, '停用提示没有指向可行路径').toBeGreaterThanOrEqual(2);
    // 停用之后作曲按钮该锁上 —— 让人对着一堵墙反复点是浪费时间
    await waitFor(() => expect(btn.disabled).toBe(true));
  });
});

describe('BGM 选路:挑一条可达的,而不是挑第一条', () => {
  it('候选按时间倒序,再用可达性过滤后取第一条', () => {
    const i = ROUTE.indexOf('const musicCandidates');
    expect(i).toBeGreaterThan(0);
    const win = ROUTE.slice(i, ROUTE.indexOf('const keepSet', i));
    expect(win).toContain('updated_at');            // 新的优先
    expect(win).toContain('filterReachable');       // 可达的才算数
    expect(win).not.toContain('musicAssets[0]');    // 不再挑第一条
  });

  it('自备 bgmUrl 仍优先于项目配乐,但同样要过可达性', () => {
    const i = ROUTE.indexOf('const musicPick');
    expect(i).toBeGreaterThan(0);
    const win = ROUTE.slice(i, i + 320);
    expect(win).toContain('customBgm');
    expect(win).toContain('isMediaReachable');
  });

  it('一条可达的都没有时才算 dropped,并如实报数', () => {
    const i = ROUTE.indexOf('musicDropped = true');
    expect(i).toBeGreaterThan(0);
    const win = ROUTE.slice(Math.max(0, i - 260), i + 260);
    expect(win).toContain('musicCandidates');
    expect(win).toContain('没有一条');
  });
});
