/**
 * v12.369:跨项目角色复用「设计写得很清楚,数据覆盖率 3%」。
 *
 * `/api/characters/bible/[name]` 的文件头把交互设计写得很完整 ——
 * 用户在创作工坊输入角色名 → 查历史 bible → 命中就提示
 * 「已找到「李长安」—— 一键复用?」并回填图/特征/cw。**这是跨项目角色一致性的核心机制。**
 *
 * 但实测:owner 的 `global_assets` 有 **73 条**角色,**只有 2 条**带 `metadata.bible`。
 * 端点要求 `bible.imageUrl` 非空,于是查任何角色都返回 `{found:false}` ——
 * 功能在数据层面覆盖率 **3%,等于不存在**。前端也从没调过它(接线扫描里的孤儿之一)。
 *
 * 回填从**已有资产**取:图优先 `persistent_url`(外链会过期),traits 取 v12.345 建好的
 * 角色库档案与 DNA 标签,role/cw 有锁定记录就用它。**只补不覆盖** ——
 * 已有的 bible 是真实使用过程中攒下的,比推断出来的可信。
 *
 * 实测:回填 49 条后,李长安/柳如烟/张天佐/丽丽 **全部命中**,
 * 且指向的是最新重生的图(柳如烟正是 v12.359 修好负向词后那张)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SCRIPT = read('scripts/backfill-character-bible.mjs');
const ROUTE = read('app/api/characters/bible/[name]/route.ts');

describe('v12.369 回填脚本', () => {
  it('图优先 persistent_url —— 外链会过期', () => {
    expect(SCRIPT).toMatch(/r\.persistent_url \|\|/);
    expect(SCRIPT).toMatch(/优先本地,外链会过期/);
  });

  /**
   * v12.373 修订:原断言锁的是**那一行代码的写法**
   * (`if (md.bible?.imageUrl) { kept++; continue; }`)。v12.373 为了同时补
   * `referenced_by_projects` 把它展开成多行块,**行为一字未变**、断言却红了。
   * 改成验行为:命中已有 bible 就计入 kept 并跳过后续写 bible 的逻辑。
   */
  it('**只补不覆盖** —— 已有 bible 原样保留', () => {
    const win = SCRIPT.slice(SCRIPT.indexOf('if (md.bible?.imageUrl)'), SCRIPT.indexOf('const imageUrl'));
    expect(win).toMatch(/kept\+\+; continue;/);
    // 且这段里不得出现改写 bible 的动作
    expect(win).not.toMatch(/bible = \{/);
    expect(SCRIPT).toMatch(/比推断出来的可信/);
  });

  it('没图就不补 —— 端点要求 imageUrl,补个空的等于制造假命中', () => {
    expect(SCRIPT).toMatch(/if \(!imageUrl\) \{ noImage\+\+; continue; \}/);
  });

  it('traits 取角色库档案与 DNA 标签(v12.345 建的)', () => {
    expect(SCRIPT).toMatch(/character_library/);
    expect(SCRIPT).toMatch(/visualTags: j\(lib\.visual_tags\)/);
  });

  it('role/cw 优先用锁定记录,否则给稳妥默认', () => {
    expect(SCRIPT).toMatch(/project_locked_characters/);
    expect(SCRIPT).toMatch(/lock\?\.role \|\| 'supporting'/);
    expect(SCRIPT).toMatch(/Number\(lock\?\.cw\) \|\| 100/);
  });

  it('必须显式传 userId,且支持 --dry', () => {
    expect(SCRIPT).toMatch(/if \(!userId\)/);
    expect(SCRIPT).toMatch(/--dry/);
  });
});

describe('v12.369 过期注释', () => {
  it('文件头不再声称「缺 token 回退 DB 第一个用户」—— 代码 v12.233 已改掉', () => {
    const head = ROUTE.slice(0, ROUTE.indexOf('export const runtime'));
    expect(head).not.toMatch(/缺 token 时回退到 DB 第一个用户\(Demo\)。$/m);
    expect(head).toMatch(/__no_auth__/);
  });

  it('代码确实用哨兵,没有回落', () => {
    expect(ROUTE).toMatch(/return '__no_auth__'/);
    expect(ROUTE).not.toMatch(/SELECT id FROM users[\s\S]{0,40}LIMIT 1/);
  });

  it('把「注释与实现矛盾比没注释更糟」写下来', () => {
    expect(ROUTE).toMatch(/比没有注释更糟/);
  });
});
