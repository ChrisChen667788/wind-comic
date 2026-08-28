/**
 * v12.345:两个「库」模块对真实用户都是空的 —— 各有各的病根。
 *
 * ① 素材库:页面调 `fetch('/api/assets')`(不带 projectId),而 v12.218 的安全修复
 *    把这个端点改成了「必须传 projectId」—— 于是一路 400,**整个素材库空白至今**。
 *    修接口没跟消费方,是本项目的老毛病(见 guard-consumer-gap)。
 *    正确解不是退回全表扫(那是真越权洞),而是补一条用户自己作用域的列表。
 *
 * ② 角色库:`/api/characters` 读 character_library,而这张表**只有测试夹具在写**。
 *    真实用户跑完整条管线产出 61 个角色资产,没有任何路径把它们提升进角色库。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const ASSETS_ROUTE = read('app/api/assets/route.ts');

describe('v12.345 素材库:无 projectId 时按用户列出', () => {
  it('不再对无 projectId 直接 400', () => {
    expect(ASSETS_ROUTE).not.toMatch(/if \(!projectId\) return NextResponse\.json\(\{ message: 'projectId required' \}/);
  });

  it('无 projectId 走「登录用户 + 自己的项目」分支', () => {
    const branch = ASSETS_ROUTE.slice(ASSETS_ROUTE.indexOf('if (!projectId) {'));
    expect(branch).toMatch(/getUserFromRequest\(request\)/);
    expect(branch).toMatch(/listProjectsByUser\(u\.sub\)/);
  });

  it('未登录必须 401 —— 不能退回匿名全表扫', () => {
    const branch = ASSETS_ROUTE.slice(ASSETS_ROUTE.indexOf('if (!projectId) {'));
    expect(branch).toMatch(/if \(!u\?\.sub\) return NextResponse\.json\(\{ message: 'Unauthorized' \}, \{ status: 401 \}\)/);
  });

  it('项目集合只来自登录用户,绝不接受外部传入的 id(否则洞又开了)', () => {
    const branch = ASSETS_ROUTE.slice(ASSETS_ROUTE.indexOf('if (!projectId) {'), ASSETS_ROUTE.indexOf('const g = await requireProjectAccess'));
    // ids 必须由 listProjectsByUser 的结果推导
    expect(branch).toMatch(/const ids = mine\.map\(\(p\) => p\.id\)/);
    // 不得出现从 query/body 取项目 id 的写法
    expect(branch).not.toMatch(/searchParams\.get\(['"]project/);
  });

  it('IN 子句用参数占位符,不做字符串拼接(SQL 注入)', () => {
    const branch = ASSETS_ROUTE.slice(ASSETS_ROUTE.indexOf('if (!projectId) {'));
    expect(branch).toMatch(/const ph = ids\.map\(\(\) => '\?'\)\.join\(','\)/);
    expect(branch).toMatch(/project_id IN \(\$\{ph\}\)/);
  });

  it('带 projectId 的老路径仍然要过 requireProjectAccess', () => {
    expect(ASSETS_ROUTE).toMatch(/const g = await requireProjectAccess\(request, projectId, 'view'\)/);
  });

  it('空项目用户返回空数组而不是报错', () => {
    expect(ASSETS_ROUTE).toMatch(/if \(mine\.length === 0\) return NextResponse\.json\(\[\]\)/);
  });
});

describe('v12.345 角色库回填', () => {
  const SCRIPT = read('scripts/backfill-character-library.mjs');

  it('人话描述取自剧本 characterArcs,而不是角色资产的图像 prompt', () => {
    expect(SCRIPT).toMatch(/characterArcs/);
    // 明确记下为什么不用资产自己的 description
    expect(SCRIPT).toMatch(/图像生成 prompt/);
  });

  it('幂等:已在库里的名字跳过,重复跑不产生副本', () => {
    expect(SCRIPT).toMatch(/const existing = new Set\(/);
    expect(SCRIPT).toMatch(/if \(existing\.has\(name\)\) \{ skipped\+\+; continue; \}/);
  });

  it('同名角色跨项目去重时,优先保留有图的那条', () => {
    expect(SCRIPT).toMatch(/if \(!prev \|\| \(!prev\.persistent_url && r\.persistent_url\)\)/);
  });

  it('图片优先取 persistent_url(外链会过期)', () => {
    expect(SCRIPT).toMatch(/r\.persistent_url \? \[r\.persistent_url\] :/);
  });

  it('支持 --dry 干跑,写库前能先看清要写什么', () => {
    expect(SCRIPT).toMatch(/const DRY = args\.includes\('--dry'\)/);
    expect(SCRIPT).toMatch(/if \(DRY\) \{/);
  });

  it('必须显式传 userId —— 不许回落「库里第一个用户」', () => {
    expect(SCRIPT).toMatch(/if \(!userId\) \{[\s\S]{0,140}process\.exit\(1\)/);
    expect(SCRIPT).not.toMatch(/LIMIT 1.*FROM users/);
  });
});
