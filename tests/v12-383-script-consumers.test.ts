/**
 * v12.383:v12.381 立了唯一入口,却只手工接了三个消费方 —— 实际有十一个。
 *
 * v12.381 修的是「一个项目可以有多条 script 资产(主稿 + script-<lang> 多语稿 +
 * script-original 备份),而 ORDER BY shot_number 在 shot_number 全为 NULL 时
 * 等于插入次序」。我当时**用手数了三个消费方**:recompose、pull-sheet、localize。
 *
 * 全仓扫描先挖出三个漏网的:
 *   · pull-sheet/import   —— 读写**都**落在 [0]。CSV 回灌会把 owner 在 Excel 里
 *                            改好的分镜 merge 进俄语稿、中文主稿一字未改,
 *                            而 projects.script_data 同步成中俄混杂内容 —— 接口还是 200。
 *   · pull-sheet/replicate —— 用俄语台词和角色名起一个**全新项目**。
 *   · pull-sheet/save-template
 * 把这条不变量登记进 consumer-gate 之后,门禁**又**扫出八个:
 *   export-aaf / export-edl / lipsync / publish-readiness / render-loop /
 *   save-template / shot-audio / lib/film-health-io。
 *
 * 手工枚举漏了 8/11。这正是 contracts.ts 开篇那张表在讲的事 ——
 * 只不过这次犯的人是我,而且是在刚立完唯一入口的下一版。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { pickScriptAsset } from '@/lib/script-asset';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
/** 判「有没有绕过」要剥掉注释 —— 本版的注释正在解释那个写法 */
const codeOf = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('唯一入口:不靠手数,靠门禁', () => {
  it('全仓没有任何地方再直接取 script 资产的第一条', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/consumer-gate.mjs'], { cwd: process.cwd(), encoding: 'utf-8' });
    expect(out).toContain('消费方门禁通过');
  });

  it('契约本身在册 —— 删掉它,上面那条就永远绿了', () => {
    const c = read('lib/consumer-gate/contracts.ts');
    expect(c).toContain('script-asset-must-use-pickScriptAsset');
    // 两种变量拼法都要收:recompose 叫 scriptAssets,pull-sheet 系叫 scriptRows
    const i = c.indexOf('script-asset-must-use-pickScriptAsset');
    const win = c.slice(i, i + 1800);
    expect(win).toMatch(/script\(Assets\|Rows\)/);
    expect(win, '这条契约不该有例外 —— 有例外就得写清理由').toMatch(/allow:\s*\[\s*\]/);
  });

  it('import 路由的**写回**也指向选中的那条,不是 [0]', () => {
    // 读一条、算 merge、再写回 —— 读写指向不同资产是最坏的情况:
    // 改动落到俄语稿,主稿看起来「没变化」,而接口返回 200
    const code = codeOf(read('app/api/projects/[id]/pull-sheet/import/route.ts'));
    expect(code).toContain('pickScriptAsset');
    // 锚调用点而不是裸名字 —— 裸名字的第一处是 import。
    // anchor-gate 追不到这里(变量经过 codeOf(read(...)) 两层转换,
    // 它的变量→源文件映射断在中间),所以这条得自己小心。
    const i = code.indexOf('updateAssetBySelector(id,');
    expect(i, '找不到写回调用点').toBeGreaterThan(0);
    const win = code.slice(i, i + 200);
    expect(win, '写回的 selector 必须用选中那条的 name').toContain('scriptPick.row.name');
    expect(win).not.toContain('scriptRows[0]');
  });
});

describe('选路行为(与消费方无关的不变量)', () => {
  const rows = [
    { name: 'script-ru', data: '{"shots":[{"shotNumber":1,"dialogue":"Достаточно"}]}' },
    { name: '剧本', data: '{"shots":[{"shotNumber":1,"dialogue":"够了"}]}' },
    { name: 'script-original', data: '{"shots":[]}' },
  ];

  it('翻译稿排在主稿前面时,仍然选主稿 —— 这正是 [0] 会选错的那一刻', () => {
    expect(pickScriptAsset(rows).row?.name).toBe('剧本');
  });

  it('写回用的 name 与读出来的是同一条', () => {
    const picked = pickScriptAsset(rows);
    expect(picked.row?.name).toBe('剧本');
    // import 路由据此构造 selector;两者必须是同一个对象来源
    expect(rows.find((r) => r.name === picked.row?.name)).toBe(picked.row);
  });

  it('明确要俄语时才给俄语稿', () => {
    expect(pickScriptAsset(rows, 'ru').row?.name).toBe('script-ru');
    expect(pickScriptAsset(rows, 'ru').fellBack).toBe(false);
  });
});
