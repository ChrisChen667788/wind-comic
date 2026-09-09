/**
 * v12.427 示意图的来源标记 —— 让整条链路知道「这镜没真出图」。
 *
 * 起因:所有图像引擎失败时,orchestrator 返回一张渐变图,**只打一条 console.warn
 * 就当成功返回**。这张假图一路流下去:落库、被抄成项目封面、进分镜页、进成片,
 * 没有一环知道它是假的。v12.426 修的项目封面只是它的一个下游 ——
 * 实测 30 个项目里 12 个的封面就是这种图,其中 3 个明明各有 11~12 张真分镜还活着。
 *
 * 措辞用「示意图」:不用「降级产物」(难听),也不用「试拍」——
 * 本产品里 `试拍 1 镜` 已指「真出一镜给你先看 vibe」,借词会把
 * 「真出了一镜」和「一镜都没出成」混成一件事。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  PLACEHOLDER_PROVENANCE, PLACEHOLDER_LABEL,
  makePlaceholderImage, isPlaceholderUrl, isPlaceholderAsset,
  countPlaceholders, applyProvenance,
} from '../lib/placeholder-provenance';

const REAL = '/api/serve-file?key=9ff8299a6a82c4236029cebd106af478';
/** 实测样本:本机 8 条 mock 分镜的 media_urls 就是这个形态。 */
const MOCK_ROUTE = 'http://localhost:3000/api/mock-assets/image/2cf3b3d1.svg?ar=9%3A16&label=Shot%201';
const LEGACY_SVG = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E';

describe('v12.427 示意图的识别', () => {
  it('自己造的示意图,URL 自带可识别的标记', () => {
    const u = makePlaceholderImage({ width: 1024, height: 576, label: 'Shot 1' });
    expect(isPlaceholderUrl(u)).toBe(true);
    expect(decodeURIComponent(u.split(',')[1])).toContain('data-qfmj-placeholder');
  });

  it('三种形态都认:自述标记 / 历史裸 SVG / mock 路由', () => {
    expect(isPlaceholderUrl(makePlaceholderImage({ width: 8, height: 8, label: 'x' }))).toBe(true);
    expect(isPlaceholderUrl(LEGACY_SVG), '历史数据没有自述标记').toBe(true);
    expect(isPlaceholderUrl(MOCK_ROUTE), 'mock 引擎产物服务').toBe(true);
  });

  it('真图不误判,空值不算示意图', () => {
    expect(isPlaceholderUrl(REAL)).toBe(false);
    expect(isPlaceholderUrl('https://cdn.example.com/a.jpg')).toBe(false);
    expect(isPlaceholderUrl(null)).toBe(false);
    expect(isPlaceholderUrl('')).toBe(false);
  });

  it('显式标记优先于 URL 形态 —— 标记是事实,形态是推断', () => {
    // URL 看着是真图,但生成端明确记了这是示意图 → 以标记为准
    expect(isPlaceholderAsset({ data: { provenance: PLACEHOLDER_PROVENANCE }, mediaUrls: [REAL] })).toBe(true);
  });

  it('历史数据靠 media_urls 兜底 —— persistent_url 已被本地化,看不出来', () => {
    // 实测:persistFirstValid 把 mock SVG 下载到了本地,persistent_url 变成 serve-file 链
    const legacy = { data: {}, media_urls: JSON.stringify([MOCK_ROUTE]), persistent_url: REAL };
    expect(isPlaceholderAsset(legacy), '只看 persistent_url 会漏判').toBe(true);
  });

  it('坏 JSON 不该让判断整个崩掉', () => {
    expect(() => isPlaceholderAsset({ media_urls: '[不是JSON' })).not.toThrow();
    expect(isPlaceholderAsset({ media_urls: '[不是JSON' })).toBe(false);
  });

  it('计数用同一套判据,不各算各的', () => {
    expect(countPlaceholders([
      { mediaUrls: [REAL] },
      { mediaUrls: [MOCK_ROUTE] },
      { data: { provenance: PLACEHOLDER_PROVENANCE } },
      null,
    ])).toBe(2);
  });
});

describe('v12.427 写入时怎么定标记', () => {
  it('调用方显式写了就照用,不覆盖生成端的判断', () => {
    const out = applyProvenance({ provenance: 'human-upload' }, { mediaUrls: [MOCK_ROUTE] }) as any;
    expect(out.provenance).toBe('human-upload');
  });

  it('带了新内容 → 按新 URL 判', () => {
    expect((applyProvenance({ a: 1 }, { mediaUrls: [MOCK_ROUTE] }) as any).provenance).toBe(PLACEHOLDER_PROVENANCE);
    expect((applyProvenance({ a: 1 }, { mediaUrls: [REAL] }) as any).provenance).toBeUndefined();
  });

  it('真重生成功后标记必须洗掉 —— 否则这镜永远背着示意图标签', () => {
    const out = applyProvenance({ a: 1 }, {
      mediaUrls: [REAL],
      previousProvenance: PLACEHOLDER_PROVENANCE,   // 旧行是示意图
    }) as any;
    expect(out.provenance, '带了新真图就不该继承旧标记').toBeUndefined();
  });

  it('只改 data、没带内容 → 继承旧标记(data 是整体覆盖写,不继承就被擦掉)', () => {
    const out = applyProvenance({ cameoScore: 88 }, {
      previousProvenance: PLACEHOLDER_PROVENANCE,
    }) as any;
    expect(out.provenance).toBe(PLACEHOLDER_PROVENANCE);
    expect(out.cameoScore, '原有字段不能丢').toBe(88);
  });

  it('非对象 data 原样返回,不硬塞字段', () => {
    expect(applyProvenance(null, { mediaUrls: [MOCK_ROUTE] })).toBeNull();
    expect(applyProvenance('str' as any, { mediaUrls: [MOCK_ROUTE] })).toBe('str');
  });
});

describe('v12.427 全仓只有一处实现', () => {
  const files = () => execSync('git ls-files "*.ts" "*.tsx"', { cwd: process.cwd(), encoding: 'utf-8' })
    .split('\n').filter(Boolean);

  it('mockSvg 已从两个 orchestrator 里消失 —— 曾各有一份逐字相同的实现', () => {
    for (const f of ['services/hybrid-orchestrator.ts', 'services/demo-orchestrator.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      expect(src, `${f} 仍有本地 mockSvg`).not.toContain('function mockSvg(');
      expect(src, `${f} 没接上共享实现`).toContain('makePlaceholderImage');
    }
  });

  it('造示意图的地方只有 placeholder-provenance 一处', () => {
    const offenders: string[] = [];
    for (const f of files()) {
      if (f === 'lib/placeholder-provenance.ts') continue;
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
        .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      if (/function\s+mockSvg\s*\(/.test(code)) offenders.push(f);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('写入咽喉处接了推导 —— 不靠调用点逐个打标', () => {
    const repo = fs.readFileSync(path.join(process.cwd(), 'lib/repos/asset-repo.ts'), 'utf-8');
    expect(repo).toContain('applyProvenance');
    // 两个咽喉都要接:createAsset(插入)与 upsertAsset(更新)
    // 右界带括号才唯一:同文件还有 updateAssetDataInProject / updateAssetBySelector,
    // 不带括号 indexOf 会命中三者中的第一个(锚点门禁抓到过)
    const created = repo.slice(
      repo.indexOf('export async function createAsset'),
      repo.indexOf('export async function updateAsset('),
    );
    expect(created, 'createAsset 段没截到').toContain('INSERT INTO project_assets');
    expect(created).toContain('applyProvenance');
    const upserted = repo.slice(repo.indexOf('export async function upsertAsset'));
    expect(upserted, 'upsertAsset 段没截到').toContain('transaction');
    expect(upserted).toContain('applyProvenance');
  });

  it('用户可见措辞不叫「降级」,也不借用「试拍」', () => {
    expect(PLACEHOLDER_LABEL).toBe('示意图');
    expect(PLACEHOLDER_LABEL).not.toContain('降级');
    expect(PLACEHOLDER_LABEL).not.toContain('试拍');
  });
});

describe('v12.427 服务端必须在原始行上判 —— 出接口后证据就没了', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

  it('normalizeAssetRow 会用 persistentUrl 顶掉 mediaUrls[0](这就是证据丢失的原因)', () => {
    const src = read('lib/asset-storage.ts');
    const win = src.slice(src.indexOf('export function normalizeAssetRow'));
    expect(win, '没截到 normalizeAssetRow').toContain('persistentUrl');
    expect(win).toContain('mediaUrls = [persistentUrl, ...mediaUrls.slice(1)]');
  });

  it('详情接口在 normalize 之前判,并把结论带出去', () => {
    const src = read('app/api/projects/[id]/route.ts');
    expect(src).toContain('isPlaceholderAsset');
    expect(src).toContain('isPlaceholder,');
    // 顺序自证:判定必须在 normalizeAssetRow 之后同一轮取到**原始行 a**,
    // 而不是拿 normalize 出来的 mediaUrls 去判
    const i = src.indexOf('isPlaceholderAsset(');
    expect(i, '没找到判定调用').toBeGreaterThan(0);
    expect(src.slice(i, i + 40), '必须传原始行').toContain('(a');
  });

  it('服务端结论优先级最高 —— 客户端拿到的 URL 已被换成本地链', () => {
    // 原始行是 mock,normalize 后 mediaUrls 变成 serve-file:光看 URL 认不出
    const afterNormalize = { mediaUrls: [REAL], persistentUrl: REAL };
    expect(isPlaceholderAsset(afterNormalize), '失真后确实认不出来').toBe(false);
    // 服务端带上结论后就认得出
    expect(isPlaceholderAsset({ ...afterNormalize, isPlaceholder: true })).toBe(true);
  });
});

describe('v12.427 就绪判定:如实告知,但不挡路', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

  it('示意图不把环节翻成「未就绪」—— 那会连累导出', async () => {
    const { derivePipelineStages } = await import('../lib/pipeline-stages');
    const stages = derivePipelineStages([
      { type: 'script', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', isPlaceholder: true },
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', isPlaceholder: true },
    ]);
    const sb = stages.find((s) => s.assetTypes.includes('storyboard'))!;
    expect(sb.status, '状态照旧就绪').toBe('ready');
    expect(sb.placeholders, '但要如实报数').toBe(2);
  });

  it('全真产物时示意图数为 0,不无中生有', async () => {
    const { derivePipelineStages } = await import('../lib/pipeline-stages');
    const stages = derivePipelineStages([
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', mediaUrls: [REAL] },
    ]);
    expect(stages.find((s) => s.assetTypes.includes('storyboard'))!.placeholders).toBe(0);
  });

  it('横幅文案:有示意图就不说「可导出成片」(锁行为,不是找字样)', async () => {
    const { derivePipelineStages, pipelineHint } = await import('../lib/pipeline-stages');
    const withPh = derivePipelineStages([
      { type: 'script', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'character', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'scene', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', isPlaceholder: true },
      { type: 'video', updatedAt: '2026-01-03T00:00:00Z' },
    ]);
    const hint = pipelineHint(withPh, PLACEHOLDER_LABEL);
    expect(hint, '不能再无条件说可导出成片').not.toContain('可导出成片');
    expect(hint).toContain('1 张示意图');
  });

  it('全真产物时仍说「可导出成片」—— 别把话说反', async () => {
    const { derivePipelineStages, pipelineHint } = await import('../lib/pipeline-stages');
    const allReal = derivePipelineStages([
      { type: 'script', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'character', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'scene', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', mediaUrls: [REAL] },
      { type: 'video', updatedAt: '2026-01-03T00:00:00Z', mediaUrls: [REAL] },
    ]);
    expect(pipelineHint(allReal, PLACEHOLDER_LABEL)).toContain('可导出成片');
  });

  it('还有环节没做完时,优先提示下一步而不是示意图', async () => {
    const { derivePipelineStages, pipelineHint } = await import('../lib/pipeline-stages');
    const partial = derivePipelineStages([
      { type: 'script', updatedAt: '2026-01-01T00:00:00Z' },
      { type: 'storyboard', updatedAt: '2026-01-02T00:00:00Z', isPlaceholder: true },
    ]);
    expect(pipelineHint(partial, PLACEHOLDER_LABEL)).toContain('下一步');
  });

  it('组件确实走这个纯函数,没有另写一份', () => {
    const src = read('components/director-console.tsx');
    expect(src).toContain('pipelineHint(stages');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(code, '组件里不该再内联一份文案').not.toContain('全链路就绪 · 可导出成片');
  });
});
