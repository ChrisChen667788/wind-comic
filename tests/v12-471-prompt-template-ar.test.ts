/**
 * v12.471 —— 出图模板不再写死 `--ar 16:9`;发给 MJ 的提示词参数全在末尾、每个只出现一次;
 * 发给其他引擎的提示词不带 MJ 语法。
 *
 * 病象:mckee-skill 的五个模板把 `--ar 16:9 --s 250` 写在正文里,调用方又按真实画幅传 aspectRatio,
 * MJ service 再追加一个 `--ar` —— 竖屏项目的 MJ 提示词里同时有 `--ar 16:9` 和 `--ar 9:16`;
 * 而且模板后面编排器还要接一长串正文,参数落在了正文中间(官方 Parameter List 列为错误写法)。
 * 非 MJ 引擎收到的是同一串文字,里面一句和请求画幅相反的 `--ar 16:9`。
 *
 * 这里的断言**不借被测解析器**:`--ar` 用独立正则数;「参数都在末尾」用「正文里的标志词全在第一个参数之前」判。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

vi.mock('@/lib/api-usage-tracker', () => ({ recordApiCall: vi.fn() }));

import {
  getCharacterVisualPrompt,
  getSceneVisualPrompt,
  getStoryboardVisualPrompt,
  getStoryboardSketchPrompt,
  getUnifiedStoryboardRenderPrompt,
} from '@/lib/mckee-skill';
import { enhanceCharacterPromptSeedance, enhanceScenePromptSeedance, styleAnchorBlock } from '@/lib/seedance-enhance';
import { withVerticalHints } from '@/lib/vertical-composition';
import { optimizeMidjourneyPrompt } from '@/lib/prompt-filter';
import { buildSketchDirective } from '@/lib/storyboard-sketch';
import { buildStyleBiblePrompt } from '@/lib/style-bible';
import { MidjourneyService } from '@/services/midjourney.service';
import { assembleMjPrompt, toPlainPrompt, splitMjParams, mjAspect } from '@/lib/midjourney-params';

// ── 独立判据(不调用被测代码) ───────────────────────────────────────────
const arValues = (p: string) => [...p.matchAll(/(?:^|\s)--(?:ar|aspect)\s+(\S+)/g)].map((m) => m[1]);
const countParam = (p: string, name: string) => [...p.matchAll(new RegExp(`(?:^|\\s)--${name}(?=\\s|$)`, 'g'))].length;
const firstParamAt = (p: string) => p.search(/(^|\s)--[a-z]/);
const hasMjSyntax = (p: string) => /(^|\s)--[a-z]/i.test(p);

const STYLE = 'ink wash painting, cinematic';
const CHAR = { name: '林雪', desc: '古装女侠,冷峻寡言', appearance: '黑发高马尾,青色劲装,腰佩短剑,左眉一道浅疤,身形修长' };

/** 库里存的旧分镜提示词:v12.471 之前由 getUnifiedStoryboardRenderPrompt + 编排器追加 + optimize 生成(形态取自本地库)。 */
const LEGACY_STORYBOARD =
  'cinematic film frame, she turns back in the rain, camera angle: low angle, lighting: rim light, color tone: cold teal, '
  + `${STYLE}, consistent character design throughout, same art style, high detail, professional cinematography --ar 16:9 --s 250 --cw 90, `
  + 'composition: rule of thirds, character action: grips the sword hilt, consistent character design, same character as reference '
  + '--no text --no words --no letters --no captions --no subtitles --no chinese --no calligraphy --no signage --no watermark';

/** 9:16 项目里各条出图路径的真实拼法(模板 + 编排器 / 路由在后面接的东西)。markers = 必须留在正文里的标志词。 */
const CASES: Array<{ name: string; prompt: string; markers: string[]; cref?: boolean }> = [
  {
    name: '角色三视图(整片管线:模板 + Seedance 锚点 + STYLE LOCK)',
    prompt: enhanceCharacterPromptSeedance(
      getCharacterVisualPrompt(CHAR.name, CHAR.desc, CHAR.appearance, STYLE, { genre: '古装武侠' }), CHAR.name,
    ) + '. ' + styleAnchorBlock(STYLE),
    markers: ['turnaround sheet', 'Character ID lock', 'STYLE LOCK'],
  },
  {
    name: '场景概念图(整片管线:模板 + 多机位 + STYLE LOCK)',
    prompt: enhanceScenePromptSeedance(getSceneVisualPrompt('雨夜的老街,石板路反光', '江南老街', STYLE)) + '. ' + styleAnchorBlock(STYLE),
    markers: ['environment concept art', 'Multi-lens prep', 'STYLE LOCK'],
  },
  {
    name: '统一分镜渲染(竖构图 + optimize + 草图锁)',
    prompt: optimizeMidjourneyPrompt(withVerticalHints(
      getUnifiedStoryboardRenderPrompt('she turns back in the rain', 'low angle', 'rim light', 'cold teal', STYLE, [CHAR.name], { [CHAR.name]: 'black hair' })
      + ', composition: rule of thirds, character action: grips the sword hilt', '9:16',
    )) + buildSketchDirective({ shotSize: 'medium shot' }),
    markers: ['cinematic film frame', 'composition: rule of thirds', 'character action', '[STORYBOARD LOCK]'],
    cref: true,
  },
  {
    name: '复审重生分镜(getStoryboardVisualPrompt)',
    prompt: getStoryboardVisualPrompt('rainy street, she turns back, tighter framing', STYLE),
    markers: ['cinematic film still', 'tighter framing'],
  },
  {
    name: '分镜草图(getStoryboardSketchPrompt)',
    prompt: getStoryboardSketchPrompt('雨夜街头回眸'),
    markers: ['storyboard sketch', 'professional storyboard'],
  },
  {
    name: '单张重生 + 用户修改意见(regenerate-asset-image 的拼法)',
    prompt: `${getCharacterVisualPrompt(CHAR.name, CHAR.desc, CHAR.appearance, '')}. Adjustment per user feedback: 头发改成红色`,
    markers: ['turnaround sheet', 'Adjustment per user feedback'],
  },
  {
    name: 'Style Bible(正文里带的是项目画幅)',
    prompt: buildStyleBiblePrompt({ styleKeywords: STYLE, genre: '古装', aspect: '9:16' }),
    markers: ['cinematic key art poster', 'visual identity'],
  },
  {
    name: '库里的旧分镜提示词(带 --ar 16:9 / --cw 90,用户在重生框里改一句再发)',
    prompt: `${LEGACY_STORYBOARD}, she is smiling now`,
    markers: ['cinematic film frame', 'composition: rule of thirds', 'she is smiling now'],
    cref: true,
  },
];

// ── 截下发给 MJ 网关的请求体 ──────────────────────────────────────────────
let submitted: string[] = [];
beforeEach(() => {
  submitted = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/mj/submit/imagine')) submitted.push(JSON.parse(String(init?.body)).prompt);
    // 提交即失败:只要请求体,不进 5 秒一轮的轮询
    return new Response(JSON.stringify({ code: 4, description: 'stop after submit (test)' }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.MJ_VERSION; });

async function sendToMj(prompt: string, opts: { aspectRatio?: string; cref?: string; sref?: string; cw?: number }): Promise<string> {
  await new MidjourneyService('test-key').generateImage(prompt, opts).catch(() => undefined);
  expect(submitted, 'MJ 网关应当收到一次提交').toHaveLength(1);
  return submitted[0];
}

describe('v12.471 · 模板正文不写画幅', () => {
  const outputs: Record<string, string> = {
    character: getCharacterVisualPrompt(CHAR.name, CHAR.desc, CHAR.appearance, STYLE, { genre: '古装武侠' }),
    characterModern: getCharacterVisualPrompt('Hero', 'office worker', 'tall man in a grey suit with glasses', STYLE),
    scene: getSceneVisualPrompt('雨夜的老街', '江南老街', STYLE),
    storyboardVisual: getStoryboardVisualPrompt('rainy street', STYLE),
    sketch: getStoryboardSketchPrompt('雨夜街头回眸'),
    unified: getUnifiedStoryboardRenderPrompt('rain', 'low', 'rim', 'teal', STYLE, [CHAR.name], { [CHAR.name]: 'black hair' }),
  };
  for (const [name, out] of Object.entries(outputs)) {
    it(`${name}:不含 --ar / --aspect`, () => {
      expect(arValues(out)).toEqual([]);
    });
  }
  it('统一分镜模板不再写死 --cw(角色权重归一致性策略)', () => {
    expect(countParam(outputs.unified, 'cw')).toBe(0);
  });
  it('没动别的:--s 250、场景的 --no people、古装的年代负向词都还在', () => {
    expect(outputs.character).toContain('--s 250');
    expect(outputs.character).toContain('--no hoodie');
    expect(outputs.scene).toContain('--no people');
    expect(outputs.unified).toContain('--s 250');
  });
});

describe('v12.471 · 9:16 项目各条路径 → MJ:只有一个 --ar 且等于项目画幅,参数全在末尾', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const sent = await sendToMj(c.prompt, {
        aspectRatio: '9:16',
        sref: 'https://cdn.example/style-bible.png',
        ...(c.cref ? { cref: 'https://cdn.example/linxue.png', cw: 125 } : {}),
      });
      // 修前:模板里的 16:9 + service 追加的 9:16(旧提示词 / Style Bible 同理)
      expect(arValues(sent), sent).toEqual(['9:16']);
      const cut = firstParamAt(sent);
      expect(cut, '应当有参数').toBeGreaterThan(0);
      for (const m of c.markers) {
        const at = sent.indexOf(m);
        expect(at, `标志词「${m}」丢了`).toBeGreaterThanOrEqual(0);
        expect(at, `「${m}」落在了参数后面(官方:参数必须在末尾)\n${sent}`).toBeLessThan(cut);
      }
      // 每个参数只出现一次
      for (const name of ['no', 's', 'v', 'sref', 'oref', 'ow', 'cref', 'cw']) {
        expect(countParam(sent, name), `--${name} 重复了\n${sent}`).toBeLessThanOrEqual(1);
      }
    });
  }

  it('有角色参考时权重取请求的值(锁脸 125 → V7 的 --ow 125),旧提示词里写死的 --cw 90 不留', async () => {
    const sent = await sendToMj(LEGACY_STORYBOARD, { aspectRatio: '9:16', cref: 'https://cdn.example/linxue.png', cw: 125 });
    expect(sent).toContain('--oref https://cdn.example/linxue.png');
    expect(countParam(sent, 'cw')).toBe(0);
    expect(countParam(sent, 'ow')).toBe(1);
  });

  it('V6.1 下同样只有一个 --cw,值来自请求', async () => {
    process.env.MJ_VERSION = '6.1';
    const sent = await sendToMj(LEGACY_STORYBOARD, { aspectRatio: '9:16', cref: 'https://cdn.example/linxue.png', cw: 80 });
    expect([...sent.matchAll(/--cw (\d+)/g)].map((m) => m[1])).toEqual(['80']);
    expect(countParam(sent, 'cref')).toBe(1);
  });

  it('请求没给画幅时保留正文里的那一个(不凭空变成 MJ 默认 1:1)', async () => {
    const sent = await sendToMj(LEGACY_STORYBOARD, {});
    expect(arValues(sent)).toEqual(['16:9']);
    expect(countParam(sent, 'cw'), '没有角色参考时,旧模板写死的 --cw 90 是孤零零的权重,不该发').toBe(0);
  });

  it('带小数的画幅换成整数比(官方:--ar cannot contain decimals)', async () => {
    const sent = await sendToMj('key art', { aspectRatio: '2.35:1' });
    expect(arValues(sent)).toEqual(['47:20']);
    expect(mjAspect('1.39:1')).toBe('139:100');
    expect(mjAspect('9:16')).toBe('9:16');
  });

  it('--no 合并成官方写法的一个列表,项不丢、不重复', async () => {
    const sent = await sendToMj(CASES[1].prompt + ' --no people --no watermark', { aspectRatio: '9:16' });
    const no = /--no ([^-]+?)(?= --|$)/.exec(sent)?.[1].split(/\s*,\s*/) ?? [];
    expect(no).toEqual(['people', 'person', 'character', 'figure', 'human', 'watermark']);
  });
});

describe('v12.471 · 非 MJ 引擎:不收 MJ 语法', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const plain = toPlainPrompt(c.prompt);
      expect(hasMjSyntax(plain), plain).toBe(false);
      expect(plain).not.toMatch(/16:9/);
      for (const m of c.markers) expect(plain).toContain(m);
    });
  }
  it('--no 的内容改写成普通文字留在原处(原来就是以这几个词送达的)', () => {
    const plain = toPlainPrompt(CASES[1].prompt);
    expect(plain).toContain('matte painting quality, no people, no person, no character, no figure, no human. Multi-lens prep');
  });
  it('没有 MJ 语法的提示词逐字不变', () => {
    const p = 'A single key shot from a short drama: rain -- at night, 9:16 aspect ratio, high detail.';
    expect(toPlainPrompt(p)).toBe(p);
  });
});

describe('v12.471 · 解析边界(拼在参数后面的正文要还给正文)', () => {
  it('值后面粘着的句号属于下一句', () => {
    const { text, params } = splitMjParams('scene --s 250. Multi-lens prep: wide');
    expect(text).toBe('scene. Multi-lens prep: wide');
    expect(params).toEqual([{ name: 's', value: '250' }]);
  });
  it('分镜重试的「, IDENTICAL face structure …」不会被 --no 吃进去', () => {
    const { text, params } = splitMjParams('shot --no watermark, IDENTICAL face structure to reference, same character identity, Hero');
    expect(params).toEqual([{ name: 'no', value: 'watermark' }]);
    expect(text).toBe('shot, IDENTICAL face structure to reference, same character identity, Hero');
  });
  it('用户写的多词负向项整体保留', () => {
    expect(splitMjParams('a cat --no blurry background, text').params).toEqual([{ name: 'no', value: 'blurry background, text' }]);
  });
  it('--no 后面直接跟正文:只认第一个词', () => {
    const { text, params } = splitMjParams('x --no t-shirt Character ID lock Hero here');
    expect(params).toEqual([{ name: 'no', value: 't-shirt' }]);
    expect(text).toBe('x Character ID lock Hero here');
  });
  it('换行、方括号截断 --no', () => {
    expect(splitMjParams('a --no face\nGlyph: 雨').text).toBe('a\nGlyph: 雨');
    expect(splitMjParams('a --no face [STORYBOARD LOCK] b').text).toBe('a [STORYBOARD LOCK] b');
  });
  it('别名归一、开关不吃后面的词、可选值只吃像取值的词', () => {
    expect(splitMjParams('a --aspect 9:16 b').params).toEqual([{ name: 'ar', value: '9:16' }]);
    const r = splitMjParams('a --tile b --niji 6 c --p d');
    expect(r.params).toEqual([{ name: 'tile', value: '' }, { name: 'niji', value: '6' }, { name: 'p', value: '' }]);
    expect(r.text).toBe('a b c d');
  });
  it('URL 里的 -- 和正文里的破折号不是参数', () => {
    expect(splitMjParams('https://cdn.example/a--b.png rain -- night').params).toEqual([]);
  });
  it('缺值的带值参数不发出去(发出去只会是无效参数)', () => {
    expect(assembleMjPrompt('a --s --no x', { version: '7' })).toBe('a --no x --v 7');
    expect(assembleMjPrompt('a --stylize', { version: '7' })).toBe('a --v 7');
  });
});

// ── 门禁:源码里不许再出现写死画幅的 `--ar 数字` 字面量 ──────────────────────
/** 只看字符串 / 模板字面量(注释里讲历史不算):TypeScript AST 取,不 grep 原文。 */
function hardcodedArLiterals(source: string, file = 'x.ts'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (/(^|\s)--(ar|aspect)\s+\d/.test(n.text)) hits.push(n.text);
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return hits;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('v12.471 · 门禁:不许写死画幅', () => {
  it('扫描器自证:字面量能抓到,注释与动态画幅不算', () => {
    expect(hardcodedArLiterals("const a = 'x --ar 16:9 --s 250';")).toHaveLength(1);
    expect(hardcodedArLiterals('const a = `x ${y} --ar 9:16`;')).toHaveLength(1);
    expect(hardcodedArLiterals('// --ar 16:9\nconst a = `--ar ${aspect}`;')).toHaveLength(0);
  });
  it('lib / services / app 里没有写死 `--ar 数字` 的字面量', () => {
    const files = ['lib', 'services', 'app'].flatMap((d) => sourceFiles(path.resolve(d)));
    expect(files.length, '扫描范围不能是空的').toBeGreaterThan(200);
    const bad = files.flatMap((f) => hardcodedArLiterals(fs.readFileSync(f, 'utf-8'), f).map((t) => `${path.relative(process.cwd(), f)}: ${t.slice(0, 80)}`));
    expect(bad).toEqual([]);
  });
});
