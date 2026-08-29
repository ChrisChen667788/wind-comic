/**
 * v12.381:「一键多语」翻译好了,成片却永远用中文台词。
 *
 * localize 把翻译稿存成 `script-<lang>` 资产(原稿零破坏,可反复出多语版),
 * 备份存成 `script-original`。于是一个项目的 script 资产可以有好几条 ——
 * owner 那个汽车广告项目实测就有三条:「剧本」、script-ru、script-en。
 *
 * 但三个消费方各选各的:
 *   · localize    过滤掉 script-* 再取第一条(唯一正确的那个)
 *   · pull-sheet  直接取 [0],不过滤
 *   · recompose   直接取 [0],不过滤
 * 而 listAssetsByType 是 ORDER BY shot_number,script 的 shot_number 全是 NULL,
 * 顺序实际由插入次序决定 —— 现在碰巧主稿在前,但那不是任何保证。
 *
 * recompose 那条最要命:v12.187 给它加了 body.language 让 TTS 按语种发音,
 * 台词来源却没跟着切 —— 传 language:'en' 会用英语嗓念主稿台词,字幕也烧主稿。
 * 多语版做到成片这一步就断了。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pickScriptAsset, isPrimaryScript, localizedLangOf } from '@/lib/script-asset';

/** 照 owner 库里的真实形态构造:主稿在前,翻译稿在后 */
const REAL = [
  { name: '剧本', data: '{"shots":[{"shotNumber":1,"dialogue":"828キロ。"}]}' },
  { name: 'script-ru', data: '{"shots":[{"shotNumber":1,"dialogue":"828 километров."}]}' },
  { name: 'script-en', data: '{"shots":[{"shotNumber":1,"dialogue":"828 kilometers."}]}' },
];

describe('按语种选稿', () => {
  it('请求 en / ru → 拿到对应翻译稿', () => {
    expect(pickScriptAsset(REAL, 'en').row?.name).toBe('script-en');
    expect(pickScriptAsset(REAL, 'ru').row?.name).toBe('script-ru');
    expect(pickScriptAsset(REAL, 'en').fellBack).toBe(false);
  });

  it('不指定 / 指定 zh → 拿主稿', () => {
    expect(pickScriptAsset(REAL).row?.name).toBe('剧本');
    expect(pickScriptAsset(REAL, 'zh').row?.name).toBe('剧本');
    expect(pickScriptAsset(REAL, '').row?.name).toBe('剧本');
  });

  it('请求了没有的语种 → 回退主稿,并且**说出来**', () => {
    const p = pickScriptAsset(REAL, 'ja');
    expect(p.row?.name).toBe('剧本');
    expect(p.fellBack, '静默回退 = 选了日语却出了别的语种,还查不出原因').toBe(true);
    expect(p.requested).toBe('ja');
  });

  it('不承诺主稿是中文 —— 实测那个项目的主稿存的是日语', () => {
    // 第一版我把 usedLanguage 写死成 'zh',而「剧本」里其实是日语台词
    // (created 与 updated 都是 09:53、从未被改过,是一开始就用日语创作的)
    expect(pickScriptAsset(REAL).usedLanguage).toBeNull();
    expect(pickScriptAsset(REAL, 'ja').usedLanguage).toBeNull();
  });

  it('顺序无关 —— 翻译稿排在主稿前面也要选对', () => {
    const shuffled = [REAL[1], REAL[2], REAL[0]];
    expect(pickScriptAsset(shuffled).row?.name, '这正是 ORDER BY shot_number 全为 NULL 时的风险').toBe('剧本');
    expect(pickScriptAsset(shuffled, 'en').row?.name).toBe('script-en');
  });

  it('只有翻译稿、没有主稿时**不乱抓一条** —— 拿俄语稿出中文片比没剧本更糟', () => {
    const noPrimary = [REAL[1], REAL[2]];
    expect(pickScriptAsset(noPrimary).row).toBeNull();
    expect(pickScriptAsset(noPrimary, 'ja').row).toBeNull();
    // 但明确请求 ru 时仍该拿到 ru
    expect(pickScriptAsset(noPrimary, 'ru').row?.name).toBe('script-ru');
  });

  it('script-original 是备份,不是主稿也不是某语种稿', () => {
    expect(isPrimaryScript('script-original')).toBe(false);
    expect(localizedLangOf('script-original')).toBeNull();
    const withBackup = [{ name: 'script-original', data: '{}' }, ...REAL];
    expect(pickScriptAsset(withBackup).row?.name).toBe('剧本');
  });

  it('判据认「script- + 两位语种码」,不是笼统的 script- 前缀', () => {
    expect(localizedLangOf('script-en')).toBe('en');
    expect(localizedLangOf('script-EN')).toBe('en');
    expect(localizedLangOf('script-drafts')).toBeNull();   // 将来可能出现的非语种资产
    expect(isPrimaryScript('script-drafts')).toBe(true);
  });

  it('畸形输入不抛错', () => {
    for (const v of [null, undefined, [], [null], [{}], 'x' as any]) {
      expect(() => pickScriptAsset(v as any, 'en')).not.toThrow();
    }
    expect(pickScriptAsset(null as any).row).toBeNull();
  });
});

describe('三个消费方都走同一个入口', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
  const ROUTES = [
    'app/api/projects/[id]/recompose/route.ts',
    'app/api/projects/[id]/pull-sheet/route.ts',
    'app/api/projects/[id]/localize/route.ts',
  ];

  it('三处都调 pickScriptAsset,且不再有各自的取 [0] / 各自的过滤', () => {
    for (const p of ROUTES) {
      const src = read(p);
      expect(src, `${p} 没走唯一入口`).toContain('pickScriptAsset');
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, `${p} 还留着自己那份 script- 过滤`).not.toMatch(/!\/\^script-\/\.test/);
      expect(code, `${p} 还在直接取第一条`).not.toMatch(/script(Assets|Rows)\[0\]/);
    }
  });

  it('recompose 把 body.language 真正传给了选稿(而不是只喂给 TTS)', () => {
    const src = read(ROUTES[0]);
    const i = src.indexOf('pickScriptAsset(');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 120)).toContain('language');
  });

  it('回退时如实回报,不静默', () => {
    const src = read(ROUTES[0]);
    expect(src).toContain('scriptFellBackFrom');
    const i = src.indexOf('ok: true, finalVideoUrl');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 500), '响应里要带上回退信息').toContain('scriptFellBackFrom');
  });
});
