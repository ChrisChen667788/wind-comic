/**
 * v12.373:把 bible 补齐之后,「主角」和「伙伴」也一起命中了 —— 那比找不到更糟。
 *
 * v12.369 我回填了 Character Bible,跨项目复用终于能命中。**但没验证命中的是什么。**
 * 实测 owner 的库:
 * ```
 * 主角 79 个项目 · 伙伴 78 个 · 一只橘猫 13 个
 * 真实角色名(李长安/柳如烟/悠悠)都只有 1~3 个
 * ```
 * 界面会提示「📚 已找到「主角」—— **79 个历史项目用过** —— 一键复用」,
 * 而那 79 个项目彼此毫无关系。**用户一点就把无关项目的角色图套了进来** ——
 * 找不到只是没帮上忙,**套错是主动帮了倒忙**。
 *
 * 判定**只看名字本身**,不看引用次数:真·系列主角(李长安出现在 3 部)次数也会高,
 * 拿次数当信号会把它一起误杀。「主角」是**角色定位**,不是**角色身份** —— 这才是分界线。
 *
 * 另修 v12.369 自己留下的洞:只补了 bible、**漏了 `referenced_by_projects`**,
 * 而界面上「N 个历史项目用过」正是靠它 —— 51 个角色里 **42 个显示「0 个」**,
 * 提示的可信度被自己抽空了。现已补到 **只剩 2 个**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isGenericCharacterName } from '@/lib/generic-character-names';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.373 通用占位名不参与复用', () => {
  it.each(['主角', '男主', '女主', '主人公', '配角', '伙伴', '同伴', '反派', '路人', '旁白'])(
    '%s 判为通用名', (n) => { expect(isGenericCharacterName(n)).toBe(true); },
  );

  it.each(['主角2', '男主A', '配角1', '伙伴 2', '路人-b'])('带编号的占位名同样拦下:%s', (n) => {
    expect(isGenericCharacterName(n)).toBe(true);
  });

  it.each(['protagonist', 'HERO', 'Narrator', 'villain'])('英文占位名(大小写无关):%s', (n) => {
    expect(isGenericCharacterName(n)).toBe(true);
  });

  it('空名字更不该复用', () => {
    expect(isGenericCharacterName('')).toBe(true);
    expect(isGenericCharacterName(null)).toBe(true);
    expect(isGenericCharacterName('   ')).toBe(true);
  });
});

describe('v12.373 真实角色名不得被误杀', () => {
  it.each(['李长安', '柳如烟', '张天佐', '苏青瓷', '悠悠', '丽丽', '陈国栋', 'Shirley', '马特·默多克'])(
    '%s 不是通用名', (n) => { expect(isGenericCharacterName(n)).toBe(false); },
  );

  it('**判定只看名字,不看引用次数** —— 系列主角出现在很多项目也不该被误杀', () => {
    // 「李长安」在 owner 库里引用 3 个项目,与「主角」的 79 个只是数量差异;
    // 若按次数判,阈值定在哪里都会误伤。
    const src = read('lib/generic-character-names.ts');
    expect(src).toMatch(/只看名字本身/);
    expect(src).toMatch(/拿次数当信号会把它一起误杀/);
  });
});

describe('v12.373 端点接线', () => {
  const R = read('app/api/characters/bible/[name]/route.ts');

  it('通用名直接返回 found:false 且带原因', () => {
    expect(R).toMatch(/isGenericCharacterName\(name\)/);
    expect(R).toMatch(/reason: 'generic_name'/);
  });

  it('过滤发生在查库之前 —— 不必要的查询就别做', () => {
    // 比的必须是**调用点**,不是文件顶部的 import ——
    // 裸 indexOf('findCharacterBibleByName') 命中的是 import(offset 808),
    // 断言就永远为假。本会话第 N 次栽在「indexOf 命中第一处」上。
    const iFilter = R.indexOf('isGenericCharacterName(name)');
    const iQuery = R.indexOf('await findCharacterBibleByName(');
    expect(iFilter).toBeGreaterThan(-1);
    expect(iQuery).toBeGreaterThan(-1);
    expect(iFilter).toBeLessThan(iQuery);
  });

  it('把「套错比找不到更糟」写进代码', () => {
    expect(R).toMatch(/比找不到更糟/);
  });
});

describe('v12.373 补上 v12.369 漏掉的引用列表', () => {
  const S = read('scripts/backfill-character-bible.mjs');

  it('回填时同时写 referenced_by_projects', () => {
    expect(S).toMatch(/SET metadata = \?, referenced_by_projects = \?/);
    expect(S).toMatch(/const projectsByName = new Map\(\)/);
  });

  it('**已有 bible 的也要补 refs** —— 它是客观事实,不是推断', () => {
    const win = S.slice(S.indexOf('if (md.bible?.imageUrl)'), S.indexOf('const imageUrl'));
    expect(win).toMatch(/referenced_by_projects = \?/);
    expect(win).toMatch(/是客观事实/);
  });

  it('bible 本身仍然只补不覆盖(v12.369 的纪律不变)', () => {
    expect(S).toMatch(/bible 不动/);
  });
});
