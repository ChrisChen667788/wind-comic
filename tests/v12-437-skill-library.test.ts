/**
 * v12.437 —— 导演技能库:把方法论从代码搬成数据。
 *
 * 对标 LibTV:100+ 个专业视频 Skill,由导演们封装真实项目方法,用户能发布自己的。
 * 修前「题材镜头包」写死在 TS 常量里,加一个题材要改代码发一版。
 *
 * 顺带修掉一个埋了 9 个大版本的「造好没接线」:v12.193 起题材包命中后执行
 * `(orchestrator as any).bgmStyleHint = ...`,**全仓没有任何代码读这个字段** ——
 * 状态栏说「已注入」,BGM 风格那一半从来没生效。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSkill, loadSkillsFrom, splitFrontmatter, SKILLS_DIR } from '@/lib/skills/registry';
import {
  detectShotPack, genreShotPacks, detectDirectorMethods, buildSkillDirectiveBlock, MAX_DIRECTOR_METHODS,
} from '@/lib/genre-shot-packs';
import { withBgmStyleHint } from '@/lib/bgm-style';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

const GOOD_PACK = `---
name: noir
description: 黑色电影风格,用于雨夜、侦探、背叛题材
metadata:
  wind-comic:
    kind: genre-shot-pack
    label: 黑色电影
    priority: 5
    match: 黑色电影|noir|雨夜侦探
    cameraDefault: slow-push
    editStyle: 黑色电影:高反差,慢节奏:留白
    bgmStyleHint: smoky jazz, muted trumpet
---

# 正文
高反差布光。
`;

describe('v12.437 · 单个技能的解析与校验', () => {
  it('合法题材包:解析出流水线元数据,值里带冒号也不被截断', () => {
    const r = parseSkill('noir', 'x', GOOD_PACK);
    expect(r.problems).toEqual([]);
    expect(r.skill!.pipeline!.kind).toBe('genre-shot-pack');
    expect(r.skill!.pipeline!.editStyle).toBe('黑色电影:高反差,慢节奏:留白');
    expect(r.skill!.pipeline!.match.test('一个雨夜侦探的故事')).toBe(true);
    expect(r.skill!.body).toContain('高反差布光');
  });

  it('没有 wind-comic 元数据的是合法外部技能,只是不进流水线', () => {
    const r = parseSkill('writer', 'x', '---\nname: writer\ndescription: 写剧本\n---\n正文');
    expect(r.problems).toEqual([]);
    expect(r.skill!.pipeline).toBeNull();
  });

  it.each([
    ['没有 frontmatter', '# 只有正文', /frontmatter/],
    ['YAML 写坏', '---\nname: [未闭合\n---\n', /不是合法 YAML/],
    ['缺 name', '---\ndescription: d\n---\n', /name/],
    ['缺 description', '---\nname: noir\n---\n', /description/],
    ['name 与目录不一致', '---\nname: other\ndescription: d\n---\n', /必须与目录名/],
    ['name 有大写', '---\nname: Noir\ndescription: d\n---\n', /小写字母/],
  ])('%s → 报问题且不产出技能', (_label, src, re) => {
    const r = parseSkill('noir', 'x', src);
    expect(r.skill).toBeNull();
    expect(r.problems.map((p) => p.message).join('\n')).toMatch(re);
  });

  it.each([
    ['kind 未知', 'kind: whatever', /kind 必须是/],
    ['match 不是合法正则', 'match: "(未闭合"', /不是合法正则/],
    ['match 能匹配空串(会命中所有创意)', 'match: ".*"', /匹配空字符串/],
    ['priority 不是数字', 'priority: 高', /priority 必须是数字/],
    ['题材包缺 cameraDefault', 'cameraDefault: ""', /cameraDefault/],
  ])('wind-comic 元数据写坏:%s → 不进流水线', (_label, patch, re) => {
    const key = patch.split(':')[0];
    const src = GOOD_PACK.replace(new RegExp(`^    ${key}:.*$`, 'm'), `    ${patch}`);
    expect(src).not.toBe(GOOD_PACK); // 自证:替换真的落地了
    const r = parseSkill('noir', 'x', src);
    expect(r.skill).toBeNull();
    expect(r.problems.map((p) => p.message).join('\n')).toMatch(re);
  });

  it('frontmatter 分隔线要配对,「---x」不算结束', () => {
    expect(splitFrontmatter('---\nname: a\n---x\n')).toBeNull();
    expect(splitFrontmatter('---\nname: a\n---\nbody')).toEqual({ front: 'name: a', body: 'body' });
  });
});

describe('v12.437 · 目录加载:坏技能不能搞垮流水线', () => {
  let dir = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    const put = (id: string, src: string) => { fs.mkdirSync(path.join(dir, id)); fs.writeFileSync(path.join(dir, id, 'SKILL.md'), src); };
    put('noir', GOOD_PACK);
    put('broken', '---\nname: broken\n---\n'); // 缺 description
    put('a-first', GOOD_PACK.replace('name: noir', 'name: a-first').replace('priority: 5', 'priority: 90'));
    fs.mkdirSync(path.join(dir, 'docs-only')); // 没有 SKILL.md 的子目录
    fs.writeFileSync(path.join(dir, 'README.md'), '# 说明');
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('一个坏技能照样加载其它技能,问题如实返回', () => {
    const r = loadSkillsFrom(dir);
    expect(r.skills.map((s) => s.id).sort()).toEqual(['a-first', 'noir']);
    expect(r.problems.some((p) => p.id === 'broken')).toBe(true);
  });

  it('按 priority 排序,不按目录名字母序', () => {
    // a-first 字母序在前,但 priority 90 > 5
    expect(loadSkillsFrom(dir).skills.map((s) => s.id)).toEqual(['noir', 'a-first']);
  });

  it('目录不存在不抛错', () => {
    expect(loadSkillsFrom(path.join(dir, 'nope'))).toEqual({ skills: [], problems: [] });
  });

  it('仓里的真实技能库:零问题 —— 不许发一个坏技能出去', () => {
    const r = loadSkillsFrom(SKILLS_DIR);
    expect(r.problems).toEqual([]);
    expect(r.skills.length).toBeGreaterThanOrEqual(6);
  });
});

describe('v12.437 · 迁移保真:值与顺序都不许悄悄变', () => {
  // 取自迁移前 lib/genre-shot-packs.ts 的原始常量(git HEAD 版本)
  const BEFORE = [
    { id: 'suspense', label: '悬疑', cameraDefault: 'slow-push', editStyle: '悬疑压迫感:慢推特写,硬切留白,信息一点点给', bgmStyleHint: 'dark ambient tension, low drone, sparse piano',
      match: '悬疑|谜团|失踪|凶手|真相|惊悚|诡异|悬案|侦探|suspense|thriller|mystery' },
    { id: 'sweet', label: '甜宠', cameraDefault: 'orbit', editStyle: '甜宠轻快:环绕柔光,节奏明快,反应特写多给', bgmStyleHint: 'warm acoustic pop, light strings, heartbeat sweetness',
      match: '甜宠|恋爱|心动|暗恋|告白|情侣|撒糖|甜蜜|romance|crush|sweet love' },
    { id: 'costume', label: '古装', cameraDefault: 'crane', editStyle: '古装大气:升降大景别开合,转场沉稳,留足呼吸', bgmStyleHint: 'chinese orchestral, guzheng and dizi, epic historical',
      match: '古装|王朝|皇帝|将军|江湖|武侠|宫廷|仙侠|朝堂|大侠|ancient china|wuxia|dynasty' },
  ];

  it('三个题材包的字段逐字等于迁移前', () => {
    const packs = genreShotPacks();
    expect(packs.map((p) => p.id)).toEqual(BEFORE.map((b) => b.id));
    for (const b of BEFORE) {
      const p = packs.find((x) => x.id === b.id)!;
      expect(p.label).toBe(b.label);
      expect(p.cameraDefault).toBe(b.cameraDefault);
      expect(p.editStyle).toBe(b.editStyle);
      expect(p.bgmStyleHint).toBe(b.bgmStyleHint);
      expect(p.match.source).toBe(b.match);
      expect(p.match.flags).toContain('i');
    }
  });

  it('双命中的创意结果与迁移前一致 —— 目录字母序会把「宫廷悬疑」从悬疑改成古装', () => {
    expect(detectShotPack('宫廷里的一桩悬疑命案')!.id).toBe('suspense');
    expect(detectShotPack('将军暗恋公主')!.id).toBe('sweet');
  });
});

describe('v12.437 · 导演技法:可叠加,有上限', () => {
  it('一个创意可以同时命中多套技法', () => {
    const ids = detectDirectorMethods('侦探在雨夜追逐凶手,最后在天台对峙').map((m) => m.id);
    expect(ids).toContain('chase-action');
    expect(ids).toContain('dialogue-coverage');
  });

  it('不命中返回空,不强塞', () => {
    expect(detectDirectorMethods('新能源汽车广告')).toEqual([]);
    expect(detectDirectorMethods('')).toEqual([]);
  });

  it('叠加上限 3 个,免得把导演提示词撑爆', () => {
    expect(MAX_DIRECTOR_METHODS).toBe(3);
    const many = detectDirectorMethods('回忆里的追逐,独白中的争吵,对峙时的逃跑,内心崩溃的谈判');
    expect(many.length).toBeLessThanOrEqual(3);
  });

  it('技能块带上标签和正文;空列表返回空串', () => {
    const block = buildSkillDirectiveBlock([{ label: '追逐动作', body: '方向必须一致' }]);
    expect(block).toContain('追逐动作');
    expect(block).toContain('方向必须一致');
    expect(buildSkillDirectiveBlock([])).toBe('');
    expect(buildSkillDirectiveBlock([{ label: 'x', body: '   ' }])).toBe('');
  });

  it('每个进流水线的技能都有正文 —— 只有 frontmatter 的技能注入进去是一句空话', () => {
    for (const s of loadSkillsFrom(SKILLS_DIR).skills.filter((x) => x.pipeline)) {
      expect(s.body.length, `${s.id} 正文为空`).toBeGreaterThan(80);
    }
  });
});

describe('v12.437 · BGM 风格词:写了 9 个版本没人读,现在两条配乐路径都读', () => {
  it('拼接:有词就拼,没词不动,重复加工不叠加', () => {
    expect(withBgmStyleHint('悬疑配乐', 'dark ambient')).toBe('悬疑配乐. Genre style: dark ambient');
    expect(withBgmStyleHint('悬疑配乐', '')).toBe('悬疑配乐');
    expect(withBgmStyleHint('悬疑配乐', undefined)).toBe('悬疑配乐');
    const once = withBgmStyleHint('悬疑配乐', 'dark ambient');
    expect(withBgmStyleHint(once, 'dark ambient')).toBe(once);
  });

  it('create-pipeline 不再用 as any 写一个没人读的字段', () => {
    const code = stripComments(read('lib/create-pipeline.ts'));
    expect(code).not.toMatch(/\(orchestrator as any\)\.bgmStyleHint/);
    expect(code).toContain('orchestrator.setBgmStyleHint(pack.bgmStyleHint)');
  });

  it('orchestrator 有真字段和 setter', () => {
    const code = stripComments(read('services/hybrid-orchestrator.ts'));
    expect(code).toMatch(/bgmStyleHint: string = ''/);
    expect(code).toContain('setBgmStyleHint(hint: string)');
  });

  it('编辑 agent 的上下文类型声明了这个字段', () => {
    const code = stripComments(read('services/agents/editor-agent.ts'));
    const ctx = code.slice(code.indexOf('export interface EditorAgentCtx'), code.indexOf('export async function runEditor'));
    expect(ctx).toContain('bgmStyleHint');
  });

  it('单段配乐读它', () => {
    const code = stripComments(read('services/agents/editor-agent.ts'));
    expect(code).toContain('musicPrompt = withBgmStyleHint(musicPrompt, ctx.bgmStyleHint);');
  });

  it('多幕配乐三幕都读它 —— 多幕路径完全不经过 musicPrompt,只接一条长片照样丢', () => {
    const code = stripComments(read('services/agents/editor-agent.ts'));
    const wrapped = code.match(/withBgmStyleHint\(moodPromptForAct\(\d, dominantEmotion, genre\), ctx\.bgmStyleHint\)/g) || [];
    expect(wrapped.length).toBe(3);
    // 不许还有没包的 moodPromptForAct 直接喂给 bgm
    expect(code).not.toMatch(/bgm\(moodPromptForAct\(/);
  });
});

describe('v12.437 · 技能正文真的进了导演提示词', () => {
  it('orchestrator 把技能块拼在导演 system prompt 末尾', () => {
    const code = stripComments(read('services/hybrid-orchestrator.ts'));
    expect(code).toMatch(/buildLanguageDirective\(this\.targetLanguage\(\)\) \+ this\.skillDirectiveBlock;/);
  });

  it('create-pipeline 命中技能时设置技能块', () => {
    const code = stripComments(read('lib/create-pipeline.ts'));
    expect(code).toContain('orchestrator.setSkillDirectives(buildSkillDirectiveBlock(skillsInUse))');
    expect(code).toContain('const methods = detectDirectorMethods(idea);');
  });

  it('npm 里挂着 skills:check,用户丢文件夹进来有地方校验', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['skills:check']).toContain('skills-check');
    expect(pkg.dependencies.yaml).toBeTruthy();
  });

  it('仓里原有的 screenwriter 技能照样认得(外部技能,不进流水线)', () => {
    const s = loadSkillsFrom(SKILLS_DIR).skills.find((x) => x.id === 'screenwriter');
    expect(s).toBeTruthy();
    expect(s!.pipeline).toBeNull();
  });
});

describe('v12.437 · 运行时要读的目录必须进镜像', () => {
  it('Dockerfile 运行时阶段拷贝了 skills/ —— 漏了生产镜像会悄悄丢掉全部题材包', () => {
    const df = read('Dockerfile');
    // 运行时阶段 = 最后一个 FROM 之后
    const lastFrom = df.lastIndexOf('\nFROM ');
    expect(lastFrom).toBeGreaterThan(0);
    const runtime = df.slice(lastFrom);
    // 正向自证:切到的确实是运行时阶段(它会拷 .next)
    expect(runtime).toMatch(/COPY --from=builder[^\n]*\/app\/\.next/);
    expect(runtime).toMatch(/COPY --from=builder[^\n]*\/app\/skills \.\/skills/);
  });

  it('加载器按 cwd 找 skills/,与镜像里的 WORKDIR 对得上', () => {
    expect(SKILLS_DIR).toBe(path.join(process.cwd(), 'skills'));
    const df = read('Dockerfile');
    const runtime = df.slice(df.lastIndexOf('\nFROM '));
    expect(runtime).toMatch(/WORKDIR \/app/);
  });

  it('.dockerignore 没把 skills/ 排除掉(否则 COPY . . 那一步就拿不到)', () => {
    let ignore = '';
    try { ignore = read('.dockerignore'); } catch { return; } // 没有 .dockerignore 就没有被排除的风险
    const lines = ignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(lines.some((l) => /^\/?skills\/?(\*\*)?$/.test(l))).toBe(false);
  });
});
