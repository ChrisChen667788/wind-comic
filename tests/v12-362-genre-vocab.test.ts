/**
 * v12.362:同一个「是不是古装」的判断,在四个文件里各写一遍,而且四份都用单字。
 *
 *   lib/prompt-templates:39      /古装|宫|侠|剑|秦|唐|宋|明|清/
 *   lib/style-bible:39           /古装|秦|唐|宋|明|清|朝|宫|侠|武|仙|修|汉服|…/
 *   lib/idea-normalizer:123      /古装|宫|侠|剑|秦|唐|宋|明|清|武侠/
 *   lib/screenwriter-enhance:166 /古|侠|将军|皇|帝|仙/
 *
 * 实测误命中(全是正当的现代广告文案):
 *   「现代都市广告,画面**清**新**明**亮」→ 古装 ×3 处
 *   「运动品牌广告,热**血**沸腾」        → 惊悚
 *
 * `prompt-templates` 那处后果最远:结果被写成「题材锁定:古装(**用户已指定**,严格遵守)」
 * 塞进剧本 prompt —— 一句用户从没说过的话。owner 的电商/汽车广告就是这样被锁成古装的。
 *
 * 修法是**收口成一份共享词表**(`lib/genre-vocab`),不是把四个正则各改一遍 ——
 * 后者下次还会漂移成四份不一样的。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { detectGenreKind, isAncient, isHorror, isSad, ANCIENT_RE, SCIFI_RE } from '@/lib/genre-vocab';
import { enhanceIdeaForCreation } from '@/lib/prompt-templates';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.362 词表本身', () => {
  it.each([
    ['现代都市广告,画面清新明亮', '清新/明亮'],
    ['咖啡店里,阳光明媚的清晨', '明媚/清晨'],
    ['产品特写,金属光泽,冷色调', '无古装词'],
    ['他做事很有条理,思路清晰', '清晰'],
    ['复古滤镜的照片墙', '复古 —— `古` 单字曾命中'],
  ])('%s 不判古装(%s)', (t) => {
    expect(isAncient(t)).toBe(false);
  });

  it.each([
    ['运动品牌广告,热血沸腾的比赛', '热血'],
    ['他是个鬼才设计师', '鬼才'],
    ['血压偏高需要注意', '血压'],
  ])('%s 不判恐怖(%s)', (t) => {
    expect(isHorror(t)).toBe(false);
  });

  it.each([
    ['慈悲为怀的老人', '慈悲'],
    ['泪光中带着笑意,喜极而泣', '泪光可以是喜'],
  ])('%s 不判悲情(%s)', (t) => {
    expect(isSad(t)).toBe(false);
  });

  // v12.396:补正例。此前 isSad 全仓**只有上面那两条负例** ——
  // 把它改成 `() => false` 跑全量测试仍然全绿(实证过),
  // 而它唯一的消费方 prompt-templates 会因此永远不给 LLM 加「悲情基调」。
  // 同批的 isAncient / isHorror 看着也只有负例,但实证下来都有间接正例保护
  // (detectGenreKind 与 lock() 的「题材锁定」字段覆盖到了);
  // 只有 isSad 落在 detectedMoods 这条没人验的支线上。
  it.each([
    ['悲伤的结局让她彻底崩溃', '悲伤'],
    ['主角最终陷入绝望', '绝望'],
    ['凄凉的冬夜,老人独自离世', '凄凉'],
    ['她在雨里痛哭', '痛哭'],
    ['a tragic ending', 'tragic'],
  ])('%s 判为悲情(%s)', (t) => {
    expect(isSad(t)).toBe(true);
  });

  it.each([
    ['古装武侠短剧,侠客夜探山庄', 'ancient'],
    ['赛博朋克风格的机甲战斗', 'scifi'],
    ['中世纪骑士与魔法', 'fantasy'],
    ['民国旗袍女子', 'republic'],
    ['现代都市职场故事', 'modern'],
  ])('%s → %s(真题材仍判得出)', (t, kind) => {
    expect(detectGenreKind(t)).toBe(kind);
  });

  it('判不出返回 null —— 不替调用方猜默认值', () => {
    expect(detectGenreKind('一家人围坐吃饭,气氛温馨')).toBeNull();
    expect(detectGenreKind('')).toBeNull();
    expect(detectGenreKind(null)).toBeNull();
  });

  it('科幻词表没有裸 `ai`(hair/waist/fair 都含它)', () => {
    expect(SCIFI_RE.test('long straight hair')).toBe(false);
    expect(SCIFI_RE.test('slim waist, fair skin')).toBe(false);
  });

  it('词表里不得有单字备选项', () => {
    const src = read('lib/genre-vocab.ts');
    const rules = src.split('\n').filter((l) => l.includes('_RE ='));
    for (const r of rules) expect(r.match(/\|[一-龥]\|/g) || []).toEqual([]);
  });
});

describe('v12.362 端到端:题材锁定不再乱贴', () => {
  const lock = (idea: string) => {
    const blob = JSON.stringify(enhanceIdeaForCreation(idea));
    const m = blob.match(/题材锁定:([^(（"\\]*)/);
    return m ? m[1].trim() : '';
  };

  it.each([
    '电商广告片:一款主打"提神不失眠"的冷萃咖啡液。现代都市快节奏,画面清新明亮',
    '新能源汽车品牌广告:清晨的海岸公路,一辆流线型纯电SUV静音驶过',
    '运动品牌广告,热血沸腾的比赛现场',
  ])('现代广告文案不再被锁题材:%s', (idea) => {
    expect(lock(idea)).toBe('');
  });

  it('真古装仍然锁得住(不能为了少误判就不判了)', () => {
    expect(lock('古装武侠短剧,侠客夜探山庄')).toContain('古装');
  });

  it('真惊悚仍然判得出', () => {
    expect(lock('凶宅闹鬼,灵异事件调查')).toContain('惊悚');
  });
});

describe('v12.362 四个消费方都收口了', () => {
  it.each([
    'lib/prompt-templates.ts',
    'lib/style-bible.ts',
    'lib/idea-normalizer.ts',
    'lib/screenwriter-enhance.ts',
  ])('%s 从 genre-vocab 导入,不再自带正则', (rel) => {
    const s = read(rel);
    expect(s).toMatch(/from '\.\/genre-vocab'/);
    // 代码行里不得再出现旧的单字古装正则
    const code = s.split('\n').filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    }).join('\n');
    expect(code).not.toMatch(/\/古装\|宫\|侠\|剑\|秦\|唐\|宋\|明\|清/);
    expect(code).not.toMatch(/\/古\|侠\|将军\|皇\|帝\|仙\//);
  });
});
