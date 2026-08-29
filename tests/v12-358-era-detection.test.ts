/**
 * v12.358:年代/题材判定 —— 单字匹配把 61 个角色里 21 个写成了赛博朋克。
 *
 * owner 让我「修掉柳如烟那个 prompt」。查下去发现不是一个 prompt 的事,
 * 而是**同一个错误在三处代码里各犯一遍**:拿单个常用汉字 / 无词界的英文片段,
 * 去 match 自由文本。
 *
 *   lib/mckee-skill  年代:  /…|修|清|明|朝|…|ai|…/
 *     · `ai` 命中 **hair**(还有 waist / fair / straight)→ 提到头发就变赛博朋克
 *     · `修` 命中「身姿修长」、`清` 命中「清澈」、`明` 命中「聪明」→ 现代角色变古装
 *   lib/script-parser 题材: /古|朝|宫|侠|武|…/、/爱|恋|…/、/杀|死|案|凶|…/
 *     · `死` 命中「死死盯着」(分镜里极常见)→ 任何片子都成「悬疑」
 *     · `古` 命中「复古」→ 新能源汽车广告成「古装」
 *
 * 第二处的后果更远:结果会被 `prompt-templates` 写成
 * 「4. 题材锁定:古装(**用户已指定**,严格遵守)」塞进剧本 prompt ——
 * 一句用户从没说过的话,却标着「用户已指定」,后续所有环节严格遵守它。
 *
 * 三条修法:**权威来源优先**(genre/style 盖过自由文本)、**词界与多字词**、
 * **判不出就不加约束**(而不是默认塞一个年代)。
 */
import { describe, it, expect } from 'vitest';
import { detectEra } from '@/lib/mckee-skill';
import fs from 'fs';
import path from 'path';

describe('v12.358 年代判定:不再被偶然子串带偏', () => {
  it.each([
    ['long straight hair, fair skin, slim waist', '英文外貌 —— 旧版因 ai∈hair 判成赛博'],
    ['身姿修长,体态匀称', '中文 —— 旧版因「修」判成古装'],
    ['眼神清澈,聪明伶俐', '中文 —— 旧版因「清/明」判成古装'],
    ['朝气蓬勃的年轻人', '中文 —— 旧版因「朝」判成古装'],
  ])('自由外貌描述不产生年代约束:%s', (desc) => {
    const v = detectEra({ description: desc });
    expect(v.kind).toBe('unknown');
    expect(v.constraint).toBe('');
  });

  it('**判不出就不加约束** —— 不再默认塞 modern contemporary', () => {
    const v = detectEra({ description: '一个人站在那里' });
    expect(v.constraint).toBe('');
    expect(v.source).toBe('none');
  });

  it.each([
    ['古装年代剧', 'ancient'],
    ['未来感科幻短片', 'scifi'],
    ['现代都市职场', 'modern'],
    ['中世纪奇幻', 'fantasy'],
    ['民国旗袍', 'republic'],
  ])('显式 genre 正确识别:%s → %s', (genre, kind) => {
    const v = detectEra({ genre });
    expect(v.kind).toBe(kind);
    expect(v.source).toBe('explicit');
  });

  it('**权威来源盖过自由文本** —— 描述里的偶然词不该翻盘', () => {
    const v = detectEra({ genre: '古装武侠', description: 'cyberpunk neon hair, futuristic' });
    expect(v.kind).toBe('ancient');
    expect(v.source).toBe('explicit');
  });

  it('没有 genre 时才降级看自由文本(启发式仍可用,只是不再优先)', () => {
    const v = detectEra({ description: '一身赛博朋克装扮的机器人' });
    expect(v.kind).toBe('scifi');
    expect(v.source).toBe('freetext');
  });

  it('英文一律带词界 —— 源码里不得再出现裸 ai', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/mckee-skill.ts'), 'utf8');
    const rules = src.slice(src.indexOf('const ERA_RULES'), src.indexOf('const NO_ERA'));
    expect(rules).not.toMatch(/\|ai\|/);
    expect(rules).toMatch(/\\bcyberpunk\\b/);
    expect(rules).toMatch(/\\bancient\\b/);
  });

  it('中文一律双字及以上 —— 规则里不得有单字备选项', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/mckee-skill.ts'), 'utf8');
    const rules = src.slice(src.indexOf('const ERA_RULES'), src.indexOf('const NO_ERA'));
    // 抓形如 |X| 的单个中日韩字符备选项
    const singles = rules.match(/\|[一-龥]\|/g) || [];
    expect(singles).toEqual([]);
  });
});

describe('v12.358 题材判定同样收紧', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/script-parser.ts'), 'utf8');
  const fn = src.slice(src.indexOf('function detectGenre'), src.indexOf('function generatePlotSummary'));

  it('古装规则不再用单字「古/朝/宫/武」', () => {
    expect(fn).not.toMatch(/\/古\|朝\|宫\|侠\|武\|/);
    expect(fn).toMatch(/古装\|古风\|汉服\|武侠/);
  });

  it('悬疑规则不再用单字「死」——「死死盯着」在分镜里极常见', () => {
    expect(fn).not.toMatch(/杀\|死\|案\|凶\|/);
    expect(fn).toMatch(/悬疑\|推理\|凶手\|命案/);
  });

  it('爱情规则不再用单字「爱」——「可爱/喜爱」会误命中', () => {
    expect(fn).not.toMatch(/\/爱\|恋\|/);
    expect(fn).toMatch(/恋爱\|心动\|表白/);
  });

  it('英文 AI 带词界', () => {
    expect(fn).toMatch(/\\bAI\\b/);
  });

  it('规则里不再有单字备选项', () => {
    const singles = fn.match(/[/|][一-龥][|/]/g) || [];
    expect(singles).toEqual([]);
  });
});

describe('v12.358 数据修复脚本', () => {
  const s = fs.readFileSync(path.join(process.cwd(), 'scripts/fix-character-era.mjs'), 'utf8');

  /** 只看代码行:说明注释里必然提到那两个被污染的字段名。 */
  const code = s.split('\n')
    .filter((l) => { const t = l.trimStart(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');

  it('**只看 title** —— description 与 script_data 都是被污染的 prompt 脚手架', () => {
    expect(s).toMatch(/eraForProject\(String\(r\.title \|\| ''\)\)/);
    expect(code).not.toMatch(/script_data/);
    expect(code).not.toMatch(/r\.pdesc/);
  });

  it('把「踩过两次」写进注释,免得后人再拿那两个字段当依据', () => {
    expect(s).toMatch(/踩过两次才找对/);
    expect(s).toMatch(/它也不是描述/);
  });

  it('判不出题材就不动,交给人', () => {
    expect(s).toMatch(/if \(!want\)/);
    expect(s).toMatch(/判不出题材,不动/);
  });

  it('只替换年代片段,其余描述一字不动', () => {
    expect(s).toMatch(/prompt\.replace\(current, want\)/);
  });

  it('支持 --dry', () => {
    expect(s).toMatch(/const DRY = process\.argv\.includes\('--dry'\)/);
  });
});

describe('v12.358 源码里不得混入控制字符', () => {
  /**
   * 本版真踩到:用 python heredoc 写 TS 时,`\b` 被解释成**退格符**(0x08),
   * 于是源码里是 `/…|<BS>AI<BS>/` —— 一个永远匹配不上的正则,而 tsc 完全不报错。
   * 是上面那条「英文 AI 带词界」的断言把它抓出来的。
   *
   * 这类字符肉眼不可见、review 也看不出,所以固化成门禁。
   */
  it('lib / app / services / scripts 下无退格符等控制字符', () => {
    const roots = ['lib', 'app', 'services', 'scripts'];
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|mjs)$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          // 允许 \t \n \r,其余 C0 控制字符一律不许
          if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) {
            bad.push(path.relative(process.cwd(), p));
          }
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    // 已复核的正当用途 —— 新增文件必须复核后加进来,否则红(不给静默新增留口子)
    const REVIEWED = new Set([
      'lib/aaf-export.ts',            // AAF 是二进制格式,字符串要 NUL 终止
      'services/intro-outro.ts',      // 就是那个**剔除**控制字符的正则本身
      'scripts/api-health-audit.mjs', // NUL 当 Map 复合键分隔符
    ]);
    expect(bad.filter((f) => !REVIEWED.has(f))).toEqual([]);
  });
});
