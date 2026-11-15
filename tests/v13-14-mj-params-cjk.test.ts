/**
 * v13.14 —— v12.471 的 MJ 参数解析器遇到中文全角标点会把后面的整句吞进参数。
 *
 * 病象(修前实测):
 *   `雨夜街头 --s 250。她回头看向镜头`   → toPlainPrompt 只剩「雨夜街头」,整句丢了;MJ 侧 `--s` 的值变成「250。她回头看向镜头」
 *   `rainy street --ar 16:9，竖屏构图`   → 两侧都丢「竖屏构图」(画幅以请求为准,正文里那个 --ar 连同被吞的字一起删掉)
 *   `x --no text，她回头看向镜头`        → 整句进了负向列表
 * 真实场景:分镜重生弹窗预填的是库里存的旧提示词(以 `--no … --no watermark` 结尾),用户接着打一句中文。
 * 根因:取值时只按空白切、只剥 ASCII 标点;`--no` 的词不认全角标点;中文没有空格,「一项超过 3 个词就是正文」的判断永远不触发。
 *
 * 断言不借被测解析器:标志句是否在第一个参数之前、纯文本里有没有 MJ 写法,都用独立正则判。
 */
import { describe, it, expect } from 'vitest';
import { assembleMjPrompt, toPlainPrompt, splitMjParams } from '@/lib/midjourney-params';
import { optimizeMidjourneyPrompt } from '@/lib/prompt-filter';

const firstParamAt = (p: string) => { const i = p.search(/(^|\s)--[a-z]/i); return i < 0 ? p.length : i; };
const arValues = (p: string) => [...p.matchAll(/(?:^|\s)--(?:ar|aspect)\s+(\S+)/g)].map((m) => m[1]);
const noItems = (p: string) => {
  const m = /(?:^|\s)--no\s+(.*?)(?=\s--[a-z]|$)/.exec(p);
  return m ? m[1].split(/\s*,\s*/) : [];
};
const hasMjSyntax = (p: string) => /(^|\s)--[a-z]/i.test(p);
const mj = (p: string) => assembleMjPrompt(p, { aspectRatio: '9:16', version: '7' });

/** 用户在预填的旧提示词后面接一句中文:各种全角标点 */
const SENTENCE = '她回头看向镜头';
/** 每个样例里「本来就是负向词」的那一项 —— 修好标点后它必须仍然是负向词,不能连带被挪进正文 */
const ORIGINAL_NEGATIVE = (p: string) => /--no (\w+)/.exec(p)?.[1];
const CASES: Array<{ name: string; prompt: string }> = [
  { name: '--s 后面接句号', prompt: `雨夜街头 --s 250。${SENTENCE}` },
  { name: '--ar 后面接逗号', prompt: `rainy street --ar 16:9，${SENTENCE}` },
  { name: '--no 后面接逗号', prompt: `rainy street --no text，${SENTENCE}` },
  { name: '--no 后面接逗号 + 很短的一句', prompt: `rainy street --no text，她在笑` },
  { name: '--no 后面接分号', prompt: `rainy street --no watermark；${SENTENCE}` },
  { name: '--no 后面接顿号', prompt: `rainy street --no watermark、${SENTENCE}` },
  { name: '--no 后面接感叹号', prompt: `rainy street --no watermark！${SENTENCE}` },
  { name: '--no 后面接全角括号', prompt: `rainy street --no watermark（${SENTENCE}）` },
  { name: '--no 后面接书名号 / 引号', prompt: `rainy street --no watermark「${SENTENCE}」` },
  { name: '--no 后面空格再接一整句中文(没有标点)', prompt: `rainy street --no watermark ${SENTENCE}` },
  { name: '--cw 后面接冒号', prompt: `rainy street --cw 90：${SENTENCE}` },
  {
    name: '库里旧分镜提示词(optimize 过、以 --no watermark 结尾)+ 用户接一句',
    prompt: `${optimizeMidjourneyPrompt('cinematic film frame, she turns back in the rain --ar 16:9 --s 250 --cw 90, composition: rule of thirds')}，${SENTENCE}`,
  },
];

describe('v13.14 · 参数后紧跟中文全角标点:那句中文留在正文里', () => {
  for (const c of CASES) {
    it(`${c.name} → MJ:整句在第一个参数之前,且不在 --no 列表里`, () => {
      const out = mj(c.prompt);
      const sentence = c.prompt.includes(SENTENCE) ? SENTENCE : '她在笑';
      const neg = ORIGINAL_NEGATIVE(c.prompt);
      if (neg) expect(noItems(out), `原有负向词「${neg}」丢了\n${out}`).toContain(neg);
      const at = out.indexOf(sentence);
      expect(at, `整句丢了\n${out}`).toBeGreaterThanOrEqual(0);
      expect(at, `整句落在参数后面(会被 MJ 当成参数值 / 负向词)\n${out}`).toBeLessThan(firstParamAt(out));
      expect(noItems(out).some((x) => x.includes(sentence)), out).toBe(false);
      expect(arValues(out), out).toEqual(['9:16']);
    });
    it(`${c.name} → 非 MJ:整句原样保留,没有 MJ 写法`, () => {
      const out = toPlainPrompt(c.prompt);
      expect(out, out).toContain(c.prompt.includes(SENTENCE) ? SENTENCE : '她在笑');
      expect(hasMjSyntax(out), out).toBe(false);
    });
  }

  it('参数值本身只取 ASCII:--s 的值是 250,不是「250。…」', () => {
    expect(splitMjParams(`a --s 250。${SENTENCE}`).params).toEqual([{ name: 's', value: '250' }]);
    expect(splitMjParams(`a --ar 16:9，竖屏`).params).toEqual([{ name: 'ar', value: '16:9' }]);
  });
});

describe('v13.14 · 接缝:拿掉参数后全角标点贴前文,开头不留残渣', () => {
  it('逐字输出', () => {
    expect(toPlainPrompt('rainy street --ar 16:9，竖屏构图')).toBe('rainy street，竖屏构图');
    expect(mj('rainy street --ar 16:9，竖屏构图')).toBe('rainy street，竖屏构图 --ar 9:16 --v 7');
    expect(toPlainPrompt(`雨夜街头 --s 250。${SENTENCE}`)).toBe(`雨夜街头。${SENTENCE}`);
    expect(toPlainPrompt(`--ar 16:9，${SENTENCE}`)).toBe(SENTENCE);
  });
  it('`--no` 后面直接就是一整句中文:一个负向项都不认,整句还给正文', () => {
    const r = splitMjParams(`雨夜街头 --no ${SENTENCE}`);
    expect(r.params.filter((x) => x.name === 'no' && x.value)).toEqual([]);
    expect(r.text).toContain(SENTENCE);
    expect(noItems(mj(`雨夜街头 --no ${SENTENCE}`))).toEqual([]);
  });
});

describe('v13.14 · 复查查出的同类问题(都在解析器里)', () => {
  it('负向词后空一格接短中文:那句话是正文,不是负向词', () => {
    for (const [p, neg, text] of [
      ['晴天街头 --no watermark 她微笑', 'watermark', '她微笑'],
      ['场景描述 --no watermark 她微笑 他站在旁边', 'watermark', '她微笑 他站在旁边'],
      ['scene --no 文字 她笑了', '文字', '她笑了'],
    ] as const) {
      const out = mj(p);
      expect(noItems(out), out).toEqual([neg]);
      expect(out.indexOf(text), out).toBeGreaterThanOrEqual(0);
      expect(out.indexOf(text), out).toBeLessThan(firstParamAt(out));
    }
  });
  it('英文多词负向项照旧(blurry background)', () => {
    expect(splitMjParams('scene --no blurry background, text').params).toEqual([{ name: 'no', value: 'blurry background, text' }]);
  });
  it('中文 / emoji 紧贴 `--` 不打空格也认得出参数 —— 否则 MJ 收到两个 --ar', () => {
    for (const [p, rest] of [['雨夜街头--ar 16:9 竖屏', '雨夜街头 竖屏'], ['sunny day ☀️--ar 16:9 scene', 'sunny day ☀️ scene']] as const) {
      expect(arValues(mj(p)), mj(p)).toEqual(['9:16']);
      expect(toPlainPrompt(p)).toBe(rest);
    }
  });
  it('不认识的 `--单词` 是正文,原样留着(只认官方参数名)', () => {
    for (const p of ['雨夜--one more time', 'the --best shot of her']) {
      expect(toPlainPrompt(p)).toBe(p);
      expect(mj(p)).toBe(`${p} --ar 9:16 --v 7`);
    }
    expect(toPlainPrompt('scene --tile pattern')).toBe('scene pattern'); // 官方开关照认
  });
  it('URL、标识符、查询串里的 `--` 不是参数(正向对照)', () => {
    const p = 'see https://x.com/a--b and file--ar 9:16 and q=--no x';
    expect(splitMjParams(p).params).toEqual([]);
    expect(toPlainPrompt(p)).toBe(p);
  });
  it('输入法打出的全角空格当分隔:值不丢,也不在正文里留下「　9:16」', () => {
    expect(splitMjParams('雨夜 --ar\u30009:16 场景').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(toPlainPrompt('雨夜 --ar\u30009:16 场景')).toBe('雨夜 场景');
    expect(splitMjParams('雨夜 --no\u3000文字').params).toEqual([{ name: 'no', value: '文字' }]);
  });
  it('`--ar 9 : 16` 冒号两边带空格:整体是一个比例', () => {
    expect(splitMjParams('雨夜 --ar 9 : 16 电影感').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(toPlainPrompt('雨夜 --ar 9 : 16 电影感')).toBe('雨夜 电影感');
  });
  it('值两头的引号:成对的一起拿掉,只有结尾的还给正文', () => {
    expect(splitMjParams('scene --ar "16:9"').params).toEqual([{ name: 'ar', value: '16:9' }]);
    expect(toPlainPrompt('scene --s "250" more')).toBe('scene more');
    expect(splitMjParams('scene --ar 16:9" style').params).toEqual([{ name: 'ar', value: '16:9' }]);
    expect(toPlainPrompt('scene --ar 16:9" style')).toBe('scene " style');
  });
});

describe('v13.14 · 第二轮复查', () => {
  it('URL 值的路径里可以有中文,不在汉字处截断;遇全角标点才结束', () => {
    expect(splitMjParams('scene --sref https://cdn.example.com/图片.jpg description').params)
      .toEqual([{ name: 'sref', value: 'https://cdn.example.com/图片.jpg' }]);
    expect(toPlainPrompt('scene --sref https://cdn.example.com/图片.jpg。下一句')).toBe('scene。下一句');
  });
  it('日文假名、韩文跟在负向词后面同样是正文', () => {
    expect(noItems(mj('scene --no watermark かのじょはわらう'))).toEqual(['watermark']);
    expect(noItems(mj('scene --no watermark 그녀는 웃는다'))).toEqual(['watermark']);
  });
  it('全角数字比例 ９：１６ / 带小数且冒号两边有空格 2.35 : 1', () => {
    expect(splitMjParams('scene --ar ９：１６ 竖屏').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(toPlainPrompt('scene --ar ９：１６ 竖屏')).toBe('scene 竖屏');
    expect(splitMjParams('scene --ar 2.35 : 1 wide').params).toEqual([{ name: 'ar', value: '2.35:1' }]);
  });
  it('紧贴前文的 `--名字`:类型明确且值对得上才是参数,否则是破折号接正文', () => {
    for (const p of ['雨夜--no way out', '等待--raw emotion', '雨夜--ar wide']) expect(toPlainPrompt(p), p).toBe(p);
    expect(splitMjParams('雨夜街头--s 250 竖屏').params).toEqual([{ name: 's', value: '250' }]);
    expect(splitMjParams('雨夜街头--sref https://x.com/a.png 竖屏').params).toEqual([{ name: 'sref', value: 'https://x.com/a.png' }]);
  });
  it('下划线、字母数字紧贴的 `--` 不是参数(file_--ar / v2--ar)', () => {
    for (const p of ['file_--ar 9:16 x', 'v2--ar 9:16 x', 'snake_case--ar 9:16 x']) expect(splitMjParams(p).params, p).toEqual([]);
  });
  it('官方开关参数逐个认得', () => {
    for (const f of ['draft', 'edit', 'fast', 'hd', 'loop', 'public', 'raw', 'relax', 'sd', 'stealth', 'tile', 'turbo', 'video']) {
      expect(splitMjParams(`scene --${f} 镜头`).params, f).toEqual([{ name: f, value: '' }]);
    }
  });
  it('汉字折算的边界:6 个字是负向词,7 个字是正文', () => {
    expect(splitMjParams('x --no 六个字的词组').params).toEqual([{ name: 'no', value: '六个字的词组' }]);
    expect(splitMjParams('x --no 七个字的一句话').params.filter((p) => p.value)).toEqual([]);
  });
  it('中文负向项后面接英文词:英文词回正文,不并进同一项', () => {
    expect(noItems(mj('scene --no 文字 watermark'))).toEqual(['文字']);
  });
  it('参数夹在两个全角逗号之间:拿掉后只留一个', () => {
    expect(toPlainPrompt('雨夜，--ar 16:9，竖屏')).toBe('雨夜，竖屏');
  });
  it('扩展 A 区汉字同样按汉字折算', () => {
    expect(splitMjParams('scene --no 㐀㐁㐂㐃㐄㐅㐆㐇 next').params.filter((p) => p.value)).toEqual([]);
  });
});

describe('v13.14 · 第三轮复查(10-30 红队):放宽只为不打空格的文字', () => {
  // 初版把「前面必须是空白」放宽成「前面不是字母数字 / URL 符号」—— 其余 ASCII 标点都被放行,
  // 这些写法里的参数被拿走、只剩空括号 / 空反引号。修前(v13.13)它们原样保留,这里锁回修前行为。
  const ASCII_TIGHT = [
    'scene `--ar 16:9` text', '(--ar 16:9) text', '[--ar 16:9] text', '!--ar 16:9',
    "val'--ar 16:9 text", '"quoted"--s 250 more', '(rule of thirds)--s 250',
  ];
  it('紧挨着 ASCII 标点的 `--参数` 不是参数:正文逐字不变', () => {
    for (const p of ASCII_TIGHT) {
      expect(splitMjParams(p).params, p).toEqual([]);
      expect(toPlainPrompt(p), p).toBe(p);
    }
  });
  it('紧挨着中文 / 全角标点 / emoji 的照样认(值对得上类型时)', () => {
    expect(splitMjParams('雨夜。--ar 9:16').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(toPlainPrompt('雨夜。--ar 9:16')).toBe('雨夜。');
    expect(toPlainPrompt('🌧️--ar 9:16 雨')).toBe('🌧️ 雨');
  });
  it('出口审计那条:中文紧贴的 --ar 与带空格的参数混在一起,纯文本里一个参数都不剩(修前 --ar 9:16 原样漏给视频引擎)', () => {
    const p = '人物在雨夜街头--ar 9:16 --no text --s 250';
    expect(splitMjParams(p).params).toEqual([
      { name: 'ar', value: '9:16' }, { name: 'no', value: 'text' }, { name: 's', value: '250' },
    ]);
    const plain = toPlainPrompt(p);
    expect(plain).toBe('人物在雨夜街头, no text');
    expect(plain).not.toMatch(/--[a-z]/i);
  });
});

describe('v13.14 · 第四轮复查(11-04):接缝与空值', () => {
  it('参数夹在同一串全角标点之间:只留一串(修前不认这种参数;初版拼出「。。」)', () => {
    expect(toPlainPrompt('雨夜。--ar 16:9。竖屏')).toBe('雨夜。竖屏');
    expect(toPlainPrompt('雨夜！--ar 16:9！竖屏')).toBe('雨夜！竖屏');
    expect(toPlainPrompt('雨夜、--ar 16:9、竖屏')).toBe('雨夜、竖屏');
    expect(toPlainPrompt('雨夜……--ar 16:9……竖屏')).toBe('雨夜……竖屏');
    expect(mj('雨夜。--ar 16:9。竖屏')).toBe('雨夜。竖屏 --ar 9:16 --v 7');
  });
  it('全角左括号 / 左引号紧贴的 `--参数` 是在引用它:原样保留(和 ASCII 括号一样,不留空的「」)', () => {
    for (const p of ['雨夜「--ar 16:9」竖屏', '雨夜（--ar 16:9）竖屏', '雨夜“--s 250”竖屏']) {
      expect(splitMjParams(p).params, p).toEqual([]);
      expect(toPlainPrompt(p), p).toBe(p);
    }
  });
  it('`--ar ""`:引号拿掉后是空值,引号也一起拿走,不留在正文里', () => {
    expect(toPlainPrompt('scene --ar ""')).toBe('scene');
    expect(toPlainPrompt("scene --ar ''")).toBe('scene');
    expect(toPlainPrompt('scene --s "" more')).toBe('scene more');
  });
  it('参数在最前面:拿掉后开头的全角分隔符 ！？ 也不留;…… —— 是正文的开头,留着', () => {
    expect(toPlainPrompt('--ar 16:9！这是正文')).toBe('这是正文');
    expect(toPlainPrompt('--ar 16:9？这是正文')).toBe('这是正文');
    expect(toPlainPrompt('  --ar 16:9，这是正文')).toBe('这是正文');
    expect(toPlainPrompt('--ar 16:9……这是正文')).toBe('……这是正文');
  });
  it('**用户正文本来就以 …… —— 。！开头:一个字都不剥**(参数在中间 / 结尾 / 没有参数;初版对所有正文都剥)', () => {
    for (const p of ['……他终于开口 --ar 9:16', '——雨停了 --s 250', '。她回头 --ar 9:16', '！故事继续 --ar 16:9']) {
      const body = p.replace(/ --.*$/, '');
      expect(toPlainPrompt(p), p).toBe(body);
      expect(splitMjParams(p).text, p).toBe(body);
      expect(mj(p).startsWith(body), p).toBe(true);
    }
    expect(mj('……她回头看向镜头')).toBe('……她回头看向镜头 --ar 9:16 --v 7');
  });
  it('接缝两侧重复的全角标点只留一份(左串结尾与右串开头相同的那段)', () => {
    expect(toPlainPrompt('雨夜。--ar 16:9。！竖屏')).toBe('雨夜。！竖屏');
    expect(toPlainPrompt('雨夜……--ar 16:9…她回头')).toBe('雨夜……她回头');
    expect(toPlainPrompt('A，。--ar 16:9。B')).toBe('A，。B');
    expect(toPlainPrompt('A！？--ar 16:9？B')).toBe('A！？B');
  });
  it('**接缝处不重复的标点照原样**:`。！|。第二幕` 右边的句号是下一句的开头,不能被吃掉(第六轮复查)', () => {
    expect(toPlainPrompt('她回眸。！--ar 9:16。第二幕：战场')).toBe('她回眸。！。第二幕：战场');
    expect(toPlainPrompt('雨夜。！--ar 16:9。竖屏')).toBe('雨夜。！。竖屏');
  });
  it('前面的逗号让位给后面别的标点(`雨夜，--ar 16:9。竖屏` → 「雨夜。竖屏」)', () => {
    expect(toPlainPrompt('雨夜，--ar 16:9。竖屏')).toBe('雨夜。竖屏');
  });
  it('〖〘﹙﹛｢〝«„ 紧贴的 `--参数` 同样是引用:原样保留', () => {
    for (const p of ['〖--ar 16:9〗正文', '〘--ar 16:9〙正文', '﹙--ar 16:9﹚正文', '﹛--s 250﹜正文', '｢--ar 16:9｣ scene', '〝--ar 16:9〟 scene', '«--ar 16:9» scène', '„--s 250“ Szene']) {
      expect(splitMjParams(p).params, p).toEqual([]);
      expect(toPlainPrompt(p), p).toBe(p);
    }
  });
  it('紧贴中文 + 冒号两边带空格的比例 `雨夜--ar 9 : 16`:整体是一个参数', () => {
    expect(splitMjParams('雨夜--ar 9 : 16 场景').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(toPlainPrompt('雨夜--ar 9 : 16 场景')).toBe('雨夜 场景');
  });
});

describe('v13.14 · 第七轮复查(11-04):看不见的字符与结束引号', () => {
  it('零宽空格 / 零宽连接符夹在括号或 ASCII 引号和 `--` 之间:照样是引用,不是参数(看上去和没夹一样)', () => {
    for (const p of ['「\u200B--ar 16:9」', '「\u200D--ar 16:9」', '(\u200B--ar 16:9)', '"\u200B--ar 16:9"']) {
      expect(splitMjParams(p).params, JSON.stringify(p)).toEqual([]);
      expect(toPlainPrompt(p), JSON.stringify(p)).toBe(p);
    }
    expect(splitMjParams('雨夜\u200B--ar 16:9').params, '中文 + 零宽空格 + 参数:照样是参数').toEqual([{ name: 'ar', value: '16:9' }]);
  });
  it('结束引号 ” ’ » › 紧贴的不算参数:`’` 在英文里是撇号(it’s--ar 与 it\'s--ar 一样),» 在丹麦语里是开引号', () => {
    for (const p of ['“雨夜”--ar 16:9', 'it’s--ar 16:9', '»--ar 16:9«', '›--s 250']) {
      expect(splitMjParams(p).params, p).toEqual([]);
      expect(toPlainPrompt(p), p).toBe(p);
    }
  });
  it('右括号 / emoji 紧贴、值对得上类型的照样是参数', () => {
    expect(splitMjParams('雨夜」--ar 9:16').params).toEqual([{ name: 'ar', value: '9:16' }]);
    expect(splitMjParams('她😊--ar 9:16').params).toEqual([{ name: 'ar', value: '9:16' }]);
  });
});

describe('v13.14 · 第八轮复查(11-04,真实提示词):负向词后面不打空格直接接中文', () => {
  // 库里 289 / 371 条提示词以 `--no watermark` 结尾;用户在重生弹窗里接着打中文、不打空格
  it('**`--no watermark她回头看向镜头`:负向词到英文为止,中文是正文**(切不开时 watermark 跟着整句进了正向描述)', () => {
    const p = 'beautiful shot --ar 16:9 --s 250 --no watermark她回头看向镜头，光线柔和。';
    expect(mj(p)).toBe('beautiful shot 她回头看向镜头，光线柔和。 --s 250 --no watermark --ar 9:16 --v 7');
    expect(noItems(mj(p))).toEqual(['watermark']);
    expect(toPlainPrompt(p)).toBe('beautiful shot, no watermark 她回头看向镜头，光线柔和。');
  });
  it('**英文开头的中文负向词是一个词:`AI感`、`3D渲染`、`CG感`、`PS痕迹` 不切**(只有后面那段中文 7 个字起才是正文)', () => {
    expect(noItems(mj('shot --no AI感'))).toEqual(['AI感']);
    expect(noItems(mj('shot --no 3D渲染, CG感'))).toEqual(['3D渲染', 'CG感']);
    expect(mj('shot --no PS痕迹 她回头')).toBe('shot 她回头 --no PS痕迹 --ar 9:16 --v 7');
  });
  it('多词项 / 第二项也一样切', () => {
    expect(noItems(mj('shot --no blurry watermark她回头看向镜头'))).toEqual(['blurry watermark']);
    expect(noItems(mj('shot --no text, watermark她回头看向镜头'))).toEqual(['text', 'watermark']);
    expect(mj('shot --no text, watermark她回头看向镜头').startsWith('shot 她回头看向镜头 ')).toBe(true);
  });
});

describe('v13.14 · 正常侧不变', () => {
  it('2–6 个字的中文负向词照样是负向词;7 个字起才当正文', () => {
    for (const w of ['文字', '不要字幕', '现代服装元素']) expect(splitMjParams(`x --no ${w}`).params, w).toEqual([{ name: 'no', value: w }]);
    expect(splitMjParams('x --no 现代都市服装元素').params.filter((p) => p.value)).toEqual([]);
  });
  it('短的中文负向词照样是负向词(--no 文字 / --no 文字, 水印)', () => {
    expect(splitMjParams('雨夜街头 --no 文字').params).toEqual([{ name: 'no', value: '文字' }]);
    expect(splitMjParams('雨夜街头 --no 文字, 水印').params).toEqual([{ name: 'no', value: '文字, 水印' }]);
    expect(noItems(mj('雨夜街头 --no 文字, 水印'))).toEqual(['文字', '水印']);
  });
  it('英文的既有行为逐字不变', () => {
    const p = 'scene --no people --no person --ar 16:9 --s 250. Multi-lens prep: wide';
    expect(mj(p)).toBe('scene. Multi-lens prep: wide --no people, person --s 250 --ar 9:16 --v 7');
    expect(toPlainPrompt(p)).toBe('scene, no people, no person. Multi-lens prep: wide');
    expect(splitMjParams('shot --no watermark, IDENTICAL face structure to reference').params).toEqual([{ name: 'no', value: 'watermark' }]);
  });
  it('像参数其实不是的(`--no-audio`)也逐字不变,首尾空白都不动', () => {
    const p = '  雨夜 --no-audio 标志  ';
    expect(toPlainPrompt(p)).toBe(p);
  });
  it('没有 MJ 写法的中文提示词逐字不变', () => {
    const p = '雨夜街头,她回头看向镜头。镜头推近 —— 冷色调。';
    expect(toPlainPrompt(p)).toBe(p);
  });
});
