/**
 * v12.431 —— 列表页也要看得出「这部片还有几处不是真出图的」。
 *
 * v12.427 让导演台知道,v12.429/430 让导出与发布知道 —— 但**列表页一片祥和**:
 * 得逐个点进项目才发现哪部还没真出完。实测本机 30 个项目里有 4 个含示意内容
 * (绿皮书 16 处、赤马斩龙 9、宿命之柱 9、门槛 2),在卡片上一点痕迹都没有。
 *
 * ## 设计上最容易出事的地方:SQL 预筛
 *
 * 判据是 JS(三种形态 + 要读 JSON 字段),SQL 表达不了;但列表要一次算几十个项目,
 * 把全部资产捞进内存不可持续(本机 30 个项目已有 1052 条)。所以 SQL **只收窄行数**,
 * 判断仍走 `isPlaceholderAsset`。
 *
 * **预筛漏一种形态 = 少算 = 漏报** —— 而漏报正是这一族 bug 里最难发现的形态
 * (v12.430 刚被这个坑过:视频判据没并进来,四镜全占位的成片导出提示为空)。
 * 所以这里用一张「已知形态表」把两者绑住:每种形态都要**同时**满足
 * 「JS 判为真」和「预筛能命中」。少绑一条,下次加形态时就会悄悄漏。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isPlaceholderAsset, PLACEHOLDER_SQL_LIKE_PATTERNS, placeholderPrefilterSql,
} from '../lib/placeholder-provenance';

/** 一行资产在库里的原始形态(data / media_urls 都是字符串)。 */
type Row = { data?: string; media_urls?: string; persistent_url?: string };

/** 已知的占位形态 —— 每加一种新形态,这里必须同步加一行。 */
const KNOWN_SHAPES: Array<{ name: string; row: Row }> = [
  { name: '图像:显式 provenance 标记', row: { data: JSON.stringify({ provenance: 'placeholder' }), media_urls: '["/api/serve-file?key=x"]' } },
  { name: '图像:mock 引擎产物服务', row: { data: '{}', media_urls: '["http://localhost:3000/api/mock-assets/image/ab.svg"]' } },
  { name: '图像:内联 SVG 占位', row: { data: '{}', media_urls: '["data:image/svg+xml,%3Csvg%3E%3C/svg%3E"]' } },
  { name: '视频:isAnimatic 显式标记', row: { data: JSON.stringify({ isAnimatic: true }), media_urls: '["/api/serve-file?key=y"]' } },
  { name: '视频:Ken Burns 回落路径', row: { data: '{}', media_urls: '["/api/serve-file?path=%2FT%2Fqf-animatic-1783628843357%2Fanimatic-1.mp4"]' } },
];

/** 用 JS 模拟 SQL 的 LIKE '%x%' —— 判据只关心「含不含」。 */
function prefilterMatches(row: Row): boolean {
  return PLACEHOLDER_SQL_LIKE_PATTERNS.some((p) => {
    const v = (row as Record<string, string | undefined>)[p.col] ?? '';
    return v.includes(p.like.replace(/%/g, ''));
  });
}

describe('v12.431 预筛必须是判据的超集', () => {
  it.each(KNOWN_SHAPES)('$name:JS 判为真', ({ row }) => {
    expect(isPlaceholderAsset(row)).toBe(true);
  });

  it.each(KNOWN_SHAPES)('$name:预筛也命中(漏了就等于漏报)', ({ row }) => {
    expect(prefilterMatches(row)).toBe(true);
  });

  it('真视频既不被判为占位,也不该被预筛捞进来(白捞是浪费,不是错)', () => {
    const real: Row = { data: '{"cameoScore":88}', media_urls: '["/api/serve-file?key=real"]' };
    expect(isPlaceholderAsset(real)).toBe(false);
    expect(prefilterMatches(real)).toBe(false);
  });

  it('预筛 SQL 拼得出来,且带上表别名', () => {
    const sql = placeholderPrefilterSql('a');
    expect(sql.startsWith('(')).toBe(true);
    expect(sql).toContain("a.data LIKE '%placeholder%'");
    expect(sql).toContain("a.media_urls LIKE '%qf-animatic%'");
    expect(sql.split(' OR ')).toHaveLength(PLACEHOLDER_SQL_LIKE_PATTERNS.length);
  });

  it('形态表和预筛模式数量对得上 —— 加了形态忘了加模式会在这里露出来', () => {
    // 六个模式覆盖五种形态(mock-assets 在 media_urls 与 persistent_url 各一条)
    expect(PLACEHOLDER_SQL_LIKE_PATTERNS.length).toBeGreaterThanOrEqual(KNOWN_SHAPES.length);
  });
});

describe('v12.431 列表接口', () => {
  const src = () => fs.readFileSync(path.join(process.cwd(), 'app/api/projects/route.ts'), 'utf-8');

  it('返回 placeholderCount', () => {
    expect(src()).toContain('placeholderCount:');
  });

  it('判断走唯一出处,不在这里重新写一遍判据', () => {
    const code = src().replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, '')).join('\n');
    expect(code).toContain('isPlaceholderAsset(');
    // 自己判 provenance / isAnimatic = 又造了一份判据
    expect(code).not.toMatch(/provenance\s*===|isAnimatic\s*===/);
  });

  it('是两次查询不是 N+1 —— 每个项目查一次,项目一多就拖垮列表页', () => {
    const code = src();
    // 预筛那条按 user_id 一次捞全部,而不是在 map 里逐项目查
    expect(code).toContain('WHERE p.user_id = ? AND');
    const mapBody = code.slice(code.indexOf('rows.map((r) =>'));
    // 窗口自证:否定断言在切歪的窗口上必然通过(空串/错段),先证明确实切到了 map 体。
    expect(mapBody, 'map 体没切到').toContain('resolveProjectCovers(');
    expect(mapBody, 'map 体没切到返回值').toContain('placeholderCount:');
    expect(mapBody, 'map 里不该再有 db.prepare').not.toContain('db.prepare');
  });
});

describe('v12.431 卡片显示', () => {
  const ui = () => fs.readFileSync(path.join(process.cwd(), 'app/dashboard/projects/page.tsx'), 'utf-8');

  it('有示意内容才渲染徽章,0 不渲染', () => {
    // 不能只断言出现过 'placeholderCount > 0' —— 容器条件里也有这串,
    // 把徽章自己的条件改成 {true && …} 那条断言照样绿(变异实测)。
    // 锁徽章**自己**那个条件表达式。
    expect(ui()).toMatch(/\{placeholderCount > 0 && \(/);
  });

  it('和「N 镜」共用一个绝对定位容器 —— 两个各自定位会撞版', () => {
    // 前两版实拍撞过:第一版压住 SCORE(「SC⚠9处示意」),第二版压住「N 镜」。
    const code = ui();
    const i = code.indexOf('shotCount > 0 || placeholderCount > 0');
    expect(i, '两个徽章没有共用容器').toBeGreaterThan(0);
    // 不按字符数截窗口(改个注释就会飘,第一版就这么假失败了一次),
    // 改成语义判据:两个徽章都要出现在**下一个绝对定位元素之前**,
    // 也就是确实待在同一个容器里,而不是各自定位。
    // 先定位容器**自己**那个 absolute,再找它之后的下一个 —— 直接从条件往后找
    // 会命中容器自身(第一版就是这么错的:offset 60 不够跳过它)。
    // 容器必须是条件后**紧接着那个** <div,且它自己带 absolute ——
    // 只找「后面某个 absolute」不够:把容器的 absolute 去掉后,
    // 断言会命中更后面那个元素,照样绿(变异实测)。
    const firstDiv = code.indexOf('<div className="', i);
    const firstDivEnd = code.indexOf('"', firstDiv + '<div className="'.length);
    const containerCls = code.slice(firstDiv + '<div className="'.length, firstDivEnd);
    expect(containerCls, '容器自己必须是绝对定位,否则会被页脚流式内容挤开').toContain('absolute');
    const containerAt = firstDiv;
    const nextAbsolute = code.indexOf('className="absolute', containerAt + 20);
    const shotAt = code.indexOf('{shotCount} 镜', i);
    const phAt = code.indexOf('处示意', i);
    expect(shotAt, '容器里没有「N 镜」').toBeGreaterThan(i);
    expect(phAt, '容器里没有示意徽章').toBeGreaterThan(i);
    expect(shotAt, '「N 镜」跑到别的绝对定位块里去了').toBeLessThan(nextAbsolute);
    expect(phAt, '示意徽章跑到别的绝对定位块里去了').toBeLessThan(nextAbsolute);
  });

  it('如实告知,不挡路 —— 不置灰、不拦点击', () => {
    const code = ui();
    expect(code).not.toMatch(/placeholderCount[^\n]*(disabled|pointer-events-none|cursor-not-allowed)/);
  });
});
