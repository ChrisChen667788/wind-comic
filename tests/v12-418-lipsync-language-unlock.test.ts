/**
 * v12.418 — ja / ko / ru 的成片完全没有口型,而解开它的引擎其实早就在仓库里。
 *
 * ── 现状 ──────────────────────────────────────────────────────────────
 * `lib/language-detect.ts` 里这三种语言的 `lipsync` 是 `'none'`。
 * v12.179 / v12.196 的注释解释过为什么:口型引擎只有 zh/en 音素表,
 * 拿 en viseme 驱动日语会**口型与发音严重错位**,而「错口型比无口型更伤观感」。
 *
 * 那个判断今天依然对 —— **但它受限于当时的引擎**。而 `services/lipsync-providers.ts`
 * 里的 Sync.so 是 language-agnostic 的(对齐波形而非音素):三种语言本可以有口型,
 * 只是**永远走不到它**,因为语言表在更早的一步就把它们判成了 none。
 *
 * ── 写这一版时差点犯的错(值得记下来)────────────────────────────────
 * 我一开始按调研结论「Kling 口型已接但零调用」去新建了一个 Sync.so provider ——
 * 结果 grep 后发现两件事:① 口型在主管线里**真的被调用**(editor-agent),
 * 调研那条结论是错的;② Sync.so **早就存在**于 `services/lipsync-providers.ts`,
 * 我加的那份是**第三份实现**。已撤掉。
 * **别人的结论也要先自己核一遍**,尤其当它让你去「补一个缺失的东西」时。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 锁那条保守:**只有装了语种无关引擎才解开**。没装就继续诚实降级 ——
 * 拿「可能行」的引擎去换「错口型」,是拿观感赌运气。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { decideLipsyncForLanguage, hasLanguageAgnosticLipsync, LANGUAGE_AGNOSTIC_LIPSYNC } from '@/lib/lipsync-language-gate';
import { syncSoModel, syncSoSyncMode } from '@/services/lipsync-providers';
import fs from 'node:fs';

const KEYS = ['SYNCSO_API_KEY', 'SYNCSO_MODEL', 'SYNCSO_SYNC_MODE'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe('v12.418 · ja/ko/ru 口型解锁', () => {
  it('没装语种无关引擎时,ja/ko/ru 继续诚实降级', () => {
    delete process.env.SYNCSO_API_KEY;
    for (const lang of ['ja', 'ko', 'ru'] as const) {
      const d = decideLipsyncForLanguage(lang);
      expect(d.enabled, `${lang} 不该在没有合适引擎时上口型`).toBe(false);
      expect(d.reason, '要说清为什么不做').toContain('错口型比无口型更伤');
      expect(d.reason, '还要说清怎么才能解开').toContain('SYNCSO_API_KEY');
    }
  });

  it('装了语种无关引擎后,ja/ko/ru 解开', () => {
    process.env.SYNCSO_API_KEY = 'real-key';
    for (const lang of ['ja', 'ko', 'ru'] as const) {
      const d = decideLipsyncForLanguage(lang);
      expect(d.enabled, `${lang} 应当解开`).toBe(true);
      expect(d.langCode, '语种无关引擎不看语言代号').toBe('any');
    }
  });

  it('zh/en 一直可用,且不受这条开关影响', () => {
    delete process.env.SYNCSO_API_KEY;
    expect(decideLipsyncForLanguage('zh')).toMatchObject({ enabled: true, langCode: 'zh' });
    expect(decideLipsyncForLanguage('en')).toMatchObject({ enabled: true, langCode: 'en' });
    process.env.SYNCSO_API_KEY = 'real-key';
    expect(decideLipsyncForLanguage('zh').langCode, '别把 zh 也改成 any —— 有音素表就该用音素表').toBe('zh');
  });

  it('拉丁语系仍映射到 en(历史行为不变)', () => {
    delete process.env.SYNCSO_API_KEY;
    for (const lang of ['es', 'fr', 'de', 'pt'] as const) {
      expect(decideLipsyncForLanguage(lang)).toMatchObject({ enabled: true, langCode: 'en' });
    }
  });

  it('占位 key 不算装了 —— your_xxx 会让人以为解开了其实没有', () => {
    process.env.SYNCSO_API_KEY = 'your_syncso_key_here';
    expect(hasLanguageAgnosticLipsync()).toBe(false);
    expect(decideLipsyncForLanguage('ja').enabled).toBe(false);
  });

  it('语种无关清单里不能混入只支持特定语种的引擎', () => {
    expect(LANGUAGE_AGNOSTIC_LIPSYNC).toContain('syncso');
    // 可灵是 5 语种(本轮复核纠正:不是坊间的 20+,那是 HeyGen 的数字)
    expect(LANGUAGE_AGNOSTIC_LIPSYNC).not.toContain('kling');
    // 自托管背后可能是任意引擎,我们无从知道它对日语行不行
    expect(LANGUAGE_AGNOSTIC_LIPSYNC).not.toContain('wav2lip-http');
  });

  it('Sync.so 模型不再写死在 beta 版上', () => {
    delete process.env.SYNCSO_MODEL;
    expect(syncSoModel(), 'beta 版随时可能下线,而下线后的报错长得像「参数不对」').toBe('lipsync-2');
    process.env.SYNCSO_MODEL = 'lipsync-2-pro';
    expect(syncSoModel()).toBe('lipsync-2-pro');
    process.env.SYNCSO_MODEL = 'not-a-real-model';
    expect(syncSoModel(), '乱填就照发 = 把一个必然 400 的请求送出去').toBe('lipsync-2');
  });

  it('sync_mode 默认不再截断画面 —— 短剧里一镜播到一半没了是看得见的', () => {
    delete process.env.SYNCSO_SYNC_MODE;
    expect(syncSoSyncMode()).toBe('bounce');
    expect(syncSoSyncMode()).not.toBe('cut_off');
    process.env.SYNCSO_SYNC_MODE = 'loop';
    expect(syncSoSyncMode()).toBe('loop');
    process.env.SYNCSO_SYNC_MODE = 'nonsense';
    expect(syncSoSyncMode()).toBe('bounce');
  });

  it('主管线与能力提示都走同一个判定 —— 只改一处就是旁路没跟上', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const f of ['services/agents/editor-agent.ts', 'lib/engine-capability-notes.ts']) {
      const src = strip(fs.readFileSync(f, 'utf-8'));
      expect(src, `${f} 窗口自证:这文件里没有口型逻辑?`).toMatch(/[Ll]ipsync|LipSync/);
      expect(src, `${f} 没接统一判定`).toContain('decideLipsyncForLanguage(');
      // 不得再自己拿语言表直接判 none
      expect(src.includes("=== 'none'"), `${f} 仍在自己判 none —— 那就绕过了引擎能力这一半`).toBe(false);
    }
  });
});
