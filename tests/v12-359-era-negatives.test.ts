/**
 * v12.359:年代改了、负向词没改 —— 自相矛盾的 prompt,而它伪装成「生成模型的残留」。
 *
 * v12.358 修年代时**只换了年代片段**,配套负向词原样留着:
 *   · 柳如烟 改成 `ancient Chinese hanfu era`,负向词却仍是
 *     `--no historical --no ancient --no hanfu` → **要古风又禁古风**
 *   · 苏砚青 改成 `modern contemporary setting`,负向词却仍是
 *     `--no hoodie --no sneakers --no modern` → **要现代又禁现代**
 *
 * 实测 28 个角色**全部**不匹配。
 *
 * **最值得记的一笔**:柳如烟第一次重生出来穿古装配现代高跟鞋,我当时判成
 * 「生成模型的残留,不是设定错了」—— **那个判断是错的**。根因就是我自己留下的
 * 这条矛盾负向词。改对之后重生,高跟鞋消失。
 * 教训:看到「模型没听话」先回头查自己的 prompt 有没有自相矛盾,别急着甩锅给模型。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { detectEra } from '@/lib/mckee-skill';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.359 年代与负向词必须自洽', () => {
  it.each([
    ['古装年代剧', 'hanfu', ['modern', 'hoodie', 'sneakers']],
    ['未来感科幻短片', 'sci-fi', ['ancient', 'hanfu', 'historical']],
    ['中世纪奇幻', 'medieval', ['modern', 'contemporary']],
  ])('%s:负向词不能禁掉自己要的东西', (genre, positive, negatives) => {
    const v = detectEra({ genre });
    // 正向词出现在 constraint 里
    expect(v.constraint.toLowerCase()).toContain(positive.split('-')[0]);
    // 负向词里禁的都不是自己要的
    for (const n of negatives) expect(v.negative.toLowerCase()).toContain(n);
    // 关键:**不能禁掉自己**
    const own = positive.replace('-', '');
    expect(v.negative.toLowerCase().replace(/-/g, '')).not.toContain(`no ${own}`);
  });

  it('modern 与 republic 不带负向词(不需要排斥什么)', () => {
    expect(detectEra({ genre: '现代都市' }).negative).toBe('');
    expect(detectEra({ genre: '民国旗袍' }).negative).toBe('');
  });

  it('判不出年代时正负都为空 —— 不能只留一个负向词', () => {
    const v = detectEra({ description: '一个人站在那里' });
    expect(v.constraint).toBe('');
    expect(v.negative).toBe('');
  });
});

describe('v12.359 修复脚本成对处理', () => {
  const S = read('scripts/fix-character-era.mjs');
  const N = read('scripts/fix-era-negatives.mjs');

  it('era 修复脚本把年代与负向词做成**成对结构**,不再各改各的', () => {
    expect(S).toMatch(/const ERA_PAIRS = \[/);
    expect(S).toMatch(/era:/);
    expect(S).toMatch(/neg:/);
  });

  it('换年代时同步换负向词', () => {
    expect(S).toMatch(/const wantNeg = ERA_PAIRS\.find/);
    expect(S).toMatch(/next\.replace\(n, wantNeg\)/);
  });

  it('原来没负向词、新年代需要 → 补上(不能漏)', () => {
    expect(S).toMatch(/if \(wantNeg && !next\.includes\(wantNeg\)\) next = next \+ wantNeg/);
  });

  it('对齐脚本**不重新判定年代** —— 那已在 v12.358 定好,重判会引入新变数', () => {
    expect(N).toMatch(/不重新判定年代/);
    expect(N).toMatch(/const era = \[\.\.\.WANT\.keys\(\)\]\.find/);
  });

  it('三种情形都要处理:换 / 删 / 补', () => {
    expect(N).toMatch(/const why = present && want \? '换' : present \? '删' : '补'/);
  });

  it('把「误判成模型残留」这条教训写进注释', () => {
    expect(N).toMatch(/误判成/);
    expect(N).toMatch(/高跟鞋/);
  });

  it('两个脚本都支持 --dry', () => {
    for (const s of [S, N]) expect(s).toMatch(/--dry/);
  });
});

describe('v12.359 重生脚本', () => {
  const R = read('scripts/regen-fixed-characters.mjs');

  it('清单来自与备份库的对比,不是凭印象列的', () => {
    expect(R).toMatch(/清单由与备份库对比得出,不是凭印象/);
  });

  it('额度类错误立即停止,不继续空烧', () => {
    expect(R).toMatch(/额度\|quota\|balance\|402\|budget/);
    expect(R).toMatch(/判定额度受限,停止剩余/);
  });

  it('单个失败不中断整批(只有额度错才停)', () => {
    const win = R.slice(R.indexOf('if (!res.ok'), R.indexOf('ok++;'));
    expect(win).toMatch(/continue;/);
  });

  it('支持断点续跑 —— 已按新 prompt 重生过的跳过', () => {
    expect(R).toMatch(/function alreadyRegenerated/);
    expect(R).toMatch(/已按新 prompt 重生过/);
  });
});
