/**
 * v12.410 — BGM 不是「还没做」,是「做过、现在坏了、没人发现」。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * 全仓 7 处 BGM 调用点**全部直连** `minimaxService.generateMusic()`(music-2.6),
 * 没有任何兜底。而 MiniMax Music API 已对新用户停服(410 + 2153,**无预告**)——
 * 于是写在 README 上的「按剧生成 BGM」,实际是断服状态:用户一点就 502。
 *
 * 这是 v12.402 那条教训的直接续集:同一家供应商停 Music API 时是无预告的,
 * 而我们把一整项能力压在它一家身上。
 * **单点依赖 + 无兜底 = 供应商替我们决定功能生死。**
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * ① 一家挂了要能自动换下一家(这是本版的全部意义);
 * ② 全挂时的错误必须说清**每一家分别为什么失败** —— 只说「作曲失败」的话,
 *    用户无从判断该充值、该换 key、还是该等供应商恢复;
 * ③ MiniMax 必须**排在链尾**:它当下就是停服的那一家,排前面等于每次都先白等一轮。
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  generateMusic, registerMusicProvider, listMusicProviders,
  availableMusicProviders, NoMusicProviderError, _resetMusicProviders,
} from '@/lib/music-providers';
import fs from 'node:fs';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '')
     .split('\n').filter((l) => !l.trim().startsWith('//'))
     .map((l) => l.replace(/(?<!:)\/\/.*$/, '')).join('\n');

/**
 * 内置链只能快照一次:ES 模块有缓存,`_resetMusicProviders()` 之后再 import
 * `music-providers-builtin` 不会重新执行注册副作用 —— 第一次写这条测试就栽在这儿
 * (先跑的那条通过、后跑的那条拿到空表)。所以在任何 reset 之前先快照。
 */
let builtinIds: string[] = [];
let builtinList: ReturnType<typeof listMusicProviders> = [];
beforeAll(async () => {
  await import('@/lib/music-providers-builtin');
  builtinList = listMusicProviders();
  builtinIds = builtinList.map((p) => p.id);
});

beforeEach(() => _resetMusicProviders());

describe('v12.410 · BGM 供应商兜底链', () => {
  it('第一家挂了自动换下一家 —— 这是本版的全部意义', async () => {
    registerMusicProvider({
      id: 'dead', name: '停服的那家', priority: 1,
      available: () => true,
      generate: async () => { throw new Error('410 gone / 2153'); },
    });
    registerMusicProvider({
      id: 'alive', name: '还活着的', priority: 2,
      available: () => true,
      generate: async () => 'https://cdn/bgm.mp3',
    });
    const out = await generateMusic({ prompt: '悲情弦乐', durationSec: 30 });
    expect(out.url).toBe('https://cdn/bgm.mp3');
    expect(out.provider).toBe('alive');
  });

  it('返回空音频也算失败,继续换下一家(不能把空串当成功交上去)', async () => {
    registerMusicProvider({ id: 'empty', name: 'e', priority: 1, available: () => true, generate: async () => '' });
    registerMusicProvider({ id: 'ok', name: 'o', priority: 2, available: () => true, generate: async () => 'u' });
    expect((await generateMusic({ prompt: 'p' })).provider).toBe('ok');
  });

  it('未配置的 provider 直接跳过,不算一次失败尝试', async () => {
    registerMusicProvider({ id: 'nokey', name: 'n', priority: 1, available: () => false, generate: async () => 'x' });
    registerMusicProvider({ id: 'ok', name: 'o', priority: 2, available: () => true, generate: async () => 'u' });
    expect(availableMusicProviders().map((p) => p.id)).toEqual(['ok']);
    expect((await generateMusic({ prompt: 'p' })).provider).toBe('ok');
  });

  it('全挂时必须说清每一家分别为什么失败', async () => {
    registerMusicProvider({ id: 'a', name: 'A', priority: 1, available: () => true, generate: async () => { throw new Error('额度用尽'); } });
    registerMusicProvider({ id: 'b', name: 'B', priority: 2, available: () => false, generate: async () => 'x' });
    await expect(generateMusic({ prompt: 'p' })).rejects.toThrow(NoMusicProviderError);
    try {
      await generateMusic({ prompt: 'p' });
    } catch (e: any) {
      // 只说「作曲失败」,用户无从判断该充值、该换 key、还是该等供应商恢复
      expect(e.message).toContain('额度用尽');
      expect(e.message).toContain('未配置');
      expect(e.attempts.map((x: any) => x.id)).toEqual(['a', 'b']);
    }
  });

  it('一个 provider 都没有时不许静默返回空', async () => {
    await expect(generateMusic({ prompt: 'p' })).rejects.toThrow(/都不可用/);
  });

  it('内置链的顺序:MiniMax 必须在链尾 —— 它就是当下停服的那一家', () => {
    const ids = builtinIds;
    expect(ids.length, '窗口自证:内置 provider 一个都没注册上').toBeGreaterThanOrEqual(3);
    expect(ids).toContain('elevenlabs');
    expect(ids).toContain('selfhost');
    expect(ids[ids.length - 1], 'MiniMax 排前面 = 每次都先白等一轮停服的接口').toBe('minimax');
  });

  it('自托管那条必须在(唯一不会被供应商停服掐死的路径)', () => {
    const self = builtinList.find((p) => p.id === 'selfhost');
    expect(self, '没有自托管路径 = 又把命交给别人').toBeTruthy();
    expect(self!.name).toMatch(/ACE-Step|YuE|自托管/);
  });

  it('所有 BGM 调用点都走注册表,没有残留直连', () => {
    for (const f of ['services/agents/editor-agent.ts', 'app/api/projects/[id]/music/route.ts']) {
      const src = strip(fs.readFileSync(f, 'utf-8'));
      expect(src, `${f} 窗口自证:这文件里根本没有 BGM 逻辑?`).toMatch(/[Bb][Gg][Mm]|music|Music/);
      expect(
        src.includes('minimaxService.generateMusic'),
        `${f} 仍在直连 MiniMax —— 只改主路径不改旁路,正是这个项目最常犯的病`,
      ).toBe(false);
    }
  });
});
