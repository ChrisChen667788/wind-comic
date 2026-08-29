/**
 * v12.366:禁止新增「单字正则匹配自由文本」—— 并把已复核的存量逐条记账。
 *
 * ## 为什么要有这道门禁
 *
 * 这个模式在本轮造成的实际损失(全部实测确认,不是推演):
 *   v12.358  `ai` 命中 `hair` → **61 个角色里 21 个被写成赛博朋克**,包括年代剧女主
 *   v12.361  `性` 命中「性格」→ **「性格温柔的小学老师」被判为 CSAM**
 *   v12.362  `清`/`明` 命中「清新明亮」→ **电商广告被锁成古装**,写进 prompt 还标着「用户已指定」
 *   v12.364  `老` 命中「老陈/老师/老板」→ **中年角色被配老年音色**
 *   v12.365  `冷` 命中「冷静/冷笑」→ **80% 的镜头误报色调冲突**
 *
 * ## 为什么是「记账」而不是「全部修掉」
 *
 * 清剩余站点时,我先拿构造样例吓自己(「灯火」→愤怒、「音乐」→喜悦),
 * 但**逐个用真实输入实测后发现:它们不误判**。原因是这些函数收的是
 * **短结构化字段**(`shot.emotion`、角色名)或**本就是单字动词**(劈/砸/踹),
 * 不是自由文本。
 *
 * 「构造样例能命中」不等于「实际会出错」—— 这一课在 v12.363 已经付过学费:
 * 那次我准备修的误判在真实数据里根本不会发生,真问题是完全不同的漏判。
 *
 * 所以:**已证实有害的五处已修;其余逐条复核并记账,新增的一律拦下**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const ALT = /\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g;
const SINGLE_CJK = /(?:^|\|)([一-龥])(?:\||$)/g;

/**
 * 已复核的存量 —— 每条都注明**为什么可以接受**。
 * 新增文件必须复核后加进来,否则红:不给静默新增留口子。
 */
const REVIEWED: Record<string, string> = {
  'lib/tts-prosody.ts': '输入是**角色名**(短字段),不是自由文本;年龄档已在 v12.364 收紧',
  'lib/emotion-tag.ts': '输入是 shot.emotion(短情绪词);v12.363 实测证实误判在真实数据里不发生,真问题是漏判(已修)',
  'lib/impact-sfx.ts': '劈/捶/撞/砸/踹**本就是单字动词**,没有多字等价写法',
  'lib/emotion-camera.ts': '升/推是运镜术语,输入为受控的运镜字段',
  'lib/seedance-enhance.ts': '急/惊用于强度分档,输入是已归一的情绪档',
  'lib/edit-intent.ts': '否定词按**位置**判定(须在动词前),设计已抑制误伤;实测基准句与含「分别」句结果一致',
  'lib/script-parser.ts': '地点后缀(里/中/前/旁)用于**剧本格式解析**,上下文由前置动词锁定',
  'lib/mckee-skill.ts': '武器词表(枪/刀/剑)+ 代词清理(他/她/们),均为受控场景',
  'services/hybrid-orchestrator.ts': '服饰/称谓词用于 prompt 增强,误命中只影响措辞不影响判定分支',
  'services/agents/editor-agent.ts': '哭/姐/母 用于旁白语气微调,不驱动分支',
  'lib/prompt-guardrails.ts': 'v12.361 已收紧;保留的敏感字有否定环视排除无害复合词',
  'lib/prompt-templates.ts': '两处均低危:①「多/加/增」须与「对白/台词」**同时**命中(「多加对白」正是这么说的);②速度词探测只决定要不要追加默认值,误判后果是「不追加」',
  'lib/shot-edit-merge.ts': 'v12.365 已收紧 note 侧;original 侧宽松是**有意的**(冲突需双边命中)',
};

function scan(): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?|mjs)$/.test(e.name)) return void 0 ?? undefined;
    }
  };
  void walk;
  const files: string[] = [];
  const collect = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) collect(p);
      else if (/\.(tsx?|mjs)$/.test(e.name)) files.push(p);
    }
  };
  for (const r of ['lib', 'app', 'services', 'components', 'scripts']) collect(path.join(ROOT, r));

  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel.startsWith('tests/')) continue;
    const src = fs.readFileSync(f, 'utf8');
    let n = 0;
    for (const line of src.split('\n')) {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      for (const m of line.matchAll(ALT)) {
        const body = m[0];
        if (!body.includes('|')) continue;
        const inner = body.slice(1, body.lastIndexOf('/'));
        const singles = [...('|' + inner + '|').matchAll(SINGLE_CJK)];
        if (singles.length >= 2) n++;
      }
    }
    if (n) out.set(rel, n);
  }
  return out;
}

describe('v12.366 单字正则门禁', () => {
  const found = scan();

  it('没有未经复核的新站点', () => {
    const unreviewed = [...found.keys()].filter((f) => !(f in REVIEWED));
    expect(unreviewed).toEqual([]);
  });

  it('复核清单里没有已经消失的条目(清单要跟着代码走)', () => {
    const stale = Object.keys(REVIEWED).filter((f) => !found.has(f));
    expect(stale).toEqual([]);
  });

  it('每条复核都写了理由,不是空占位', () => {
    for (const [f, why] of Object.entries(REVIEWED)) {
      expect(why.length, `${f} 缺理由`).toBeGreaterThan(12);
    }
  });

  it('本轮已修的五处不得回退成单字', () => {
    const read = (r: string) => fs.readFileSync(path.join(ROOT, r), 'utf8');
    // genre-vocab:规则行不得含单字备选
    for (const l of read('lib/genre-vocab.ts').split('\n').filter((x) => x.includes('_RE ='))) {
      expect(l.match(/\|[一-龥]\|/g) || []).toEqual([]);
    }
    // guardrails:仍有否定环视
    expect(read('lib/prompt-guardrails.ts')).toMatch(/\(\?<!\$\{性_INNOCUOUS_PREFIX\}\)/);
    // tts-prosody:老年词表无裸 `老`
    const eld = read('lib/tts-prosody.ts').split('\n').find((l) => l.includes('const ELDERLY_HINT')) || '';
    expect(eld).not.toMatch(/\|老\|/);
  });
});
