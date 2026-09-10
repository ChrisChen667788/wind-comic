/**
 * v12.430 —— 「不是真产物」只能有一套判据。
 *
 * ## 病象:言之凿凿的漏报
 *
 * v12.427 建了图像侧的 `provenance`,v12.429 让四条导出路径接上它。但视频侧一直走
 * 另一套 —— `data.isAnimatic`(引擎全挂时回落的 Ken Burns 占位片),两套互不相认。
 * 实测构造一部四镜全是占位片的成片:`countPlaceholders` 返回 **0**、导出说明为空,
 * 用户导出交付时一个字都不会被提醒。**说「没有问题」比什么都不说更糟。**
 *
 * 真库实测更难看:宿命之柱 12 条视频里 **9 条是占位片**,而它是被判为「有真作品」
 * 而保留下来的项目之一。
 *
 * ## 措辞为什么没合并成一个词
 *
 * 视频侧回落的是 Ken Burns 占位片 —— 它用的是**真的分镜画面**,假的是那段运镜。
 * 管它叫「示意图」是错的:那不是一张假图,是一段假运镜。所以是同一族两个词:
 * 图像「示意图」/ 视频「示意片」,一眼看出是一回事,又各自说得准。
 *
 * ## 判据为什么是这两条(实测 data/qfmj.db 定的)
 *
 *   · `data.isAnimatic === true` —— 26 条;全仓只有 hybrid-orchestrator 两处写它,
 *     都在「所有引擎失败」分支,**合法的 Ken Burns 运镜走不到那里**;
 *   · 路径含 `qf-animatic-<时间戳>` —— 另 2 条没有上面那个标记,只能靠它认。
 *   两者实测不重合,少哪条都会漏(28 = 26 + 2)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isPlaceholderVideo, isPlaceholderAsset, countPlaceholders,
  PLACEHOLDER_LABEL, PLACEHOLDER_LABEL_VIDEO, placeholderLabelFor,
} from '../lib/placeholder-provenance';
import { auditAssetsForExport, exportAuditNote } from '../lib/export-audit';

const REAL_VIDEO = '/api/serve-file?key=83340b9ada0cae1408a46b3f8ef44434';
/** 实测形态:回落文件落在我们自己的 qf-animatic-<ts>/ 目录下。 */
const ANIMATIC_URL = '/api/serve-file?path=%2Fvar%2Ffolders%2FT%2Fqf-animatic-1783628843357%2Fanimatic-1783628846805.mp4';

describe('v12.430 视频侧占位片的识别', () => {
  it('显式标记认得出', () => {
    expect(isPlaceholderVideo({ data: { isAnimatic: true }, mediaUrls: [REAL_VIDEO] })).toBe(true);
  });

  it('没有标记时靠我们自己的回落路径认出(实测有 2 条只能这么认)', () => {
    expect(isPlaceholderVideo({ data: {}, mediaUrls: [ANIMATIC_URL] })).toBe(true);
  });

  it('**合法的 Ken Burns 不能被误伤** —— 它是一种运镜手法,不是只有降级才用', () => {
    // 用户自己上传/命名的 animatic-1.mp4:没有我们的 qf- 前缀,不该被判成占位片。
    // 用宽正则 /animatic-\d+\.mp4/ 就会在这里翻车 —— 那是反过来的谎。
    expect(isPlaceholderVideo({ data: {}, mediaUrls: ['/uploads/animatic-1.mp4'] })).toBe(false);
    expect(isPlaceholderVideo({ data: { isAnimatic: false }, mediaUrls: [REAL_VIDEO] })).toBe(false);
    expect(isPlaceholderVideo({ data: {}, mediaUrls: [REAL_VIDEO] })).toBe(false);
  });

  it('**JSON 字符串态的 data 也要认** —— 导出路径审计的是原始库行', () => {
    // 第一版给视频判据写了个直接强转,于是对象态认得出、字符串态认不出,
    // 恰好把最该认出来的那条路径(交付)漏掉了。
    const raw = { data: JSON.stringify({ isAnimatic: true }), media_urls: JSON.stringify([REAL_VIDEO]) };
    expect(isPlaceholderVideo(raw)).toBe(true);
    expect(isPlaceholderAsset(raw)).toBe(true);
  });

  it('坏 JSON 不该让判断整个崩掉', () => {
    expect(() => isPlaceholderVideo({ data: '{不是JSON' })).not.toThrow();
    expect(isPlaceholderVideo({ data: '{不是JSON' })).toBe(false);
  });
});

describe('v12.430 统一入口不再漏报', () => {
  const fourAnimatic = [1, 2, 3, 4].map((n) => ({
    type: 'video', shotNumber: n, data: { isAnimatic: true }, mediaUrls: [`/v${n}.mp4`],
  }));

  it('四镜全占位的成片:计数不能是 0', () => {
    expect(countPlaceholders(fourAnimatic)).toBe(4);
  });

  it('导出审计点得出是哪几镜', () => {
    const a = auditAssetsForExport(fourAnimatic as any);
    expect(a.placeholders).toBe(4);
    expect(a.shots).toEqual([1, 2, 3, 4]);
  });

  it('导出说明必须出现 —— 交付时一个字都不提醒是最糟的情况', () => {
    const note = exportAuditNote(auditAssetsForExport(fourAnimatic as any));
    expect(note).toBeTruthy();
    expect(note).toContain('4');
  });
});

describe('v12.430 措辞按类型说准', () => {
  it('图像叫示意图,视频叫示意片,两个词不同', () => {
    expect(PLACEHOLDER_LABEL).toBe('示意图');
    expect(PLACEHOLDER_LABEL_VIDEO).toBe('示意片');
    expect(PLACEHOLDER_LABEL).not.toBe(PLACEHOLDER_LABEL_VIDEO);
  });

  it('按资产类型取词,调用方不用各写各的', () => {
    expect(placeholderLabelFor('video')).toBe(PLACEHOLDER_LABEL_VIDEO);
    expect(placeholderLabelFor('final_video')).toBe(PLACEHOLDER_LABEL_VIDEO);
    expect(placeholderLabelFor('storyboard')).toBe(PLACEHOLDER_LABEL);
    expect(placeholderLabelFor(undefined)).toBe(PLACEHOLDER_LABEL);
  });

  it('全是视频时说「示意片」,不说「示意图」', () => {
    const note = exportAuditNote(auditAssetsForExport(
      [{ type: 'video', shotNumber: 1, data: { isAnimatic: true } }] as any));
    expect(note).toContain(PLACEHOLDER_LABEL_VIDEO);
    expect(note).not.toContain(`处${PLACEHOLDER_LABEL}(`);
  });

  it('图文混合时两种都点名,别只说一半', () => {
    const note = exportAuditNote(auditAssetsForExport([
      { type: 'storyboard', shotNumber: 1, data: { provenance: 'placeholder' } },
      { type: 'video', shotNumber: 2, data: { isAnimatic: true } },
    ] as any));
    expect(note).toContain(PLACEHOLDER_LABEL);
    expect(note).toContain(PLACEHOLDER_LABEL_VIDEO);
  });
});

describe('v12.430 散落的判据已收敛', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')).join('\n');

  it('film-health 不再自带一份 animatic 正则', () => {
    const code = strip(read('lib/film-health-io.ts'));
    expect(code).toContain('isPlaceholderVideo');
    expect(code, '仍自带一份判据').not.toMatch(/animatic-\\d\+\\\.mp4|isAnimatic === true/);
  });

  it('项目页委托判据,但**保留「根本没出视频」那一条**', () => {
    const code = strip(read('app/projects/[id]/page.tsx'));
    expect(code).toContain('isPlaceholderVideo(v)');
    // 「要补渲的镜」比「占位片」更宽:一个视频都没有的镜也要在名单里。
    // 把这条一起并掉会让它们从补渲名单里静默消失。
    expect(code, '「没有视频」的镜不能从补渲名单消失').toContain('!v?.mediaUrls?.[0]');
  });

  it('补渲路由同样委托,且**同样保留「一个视频都没有」**', () => {
    const code = strip(read('app/api/regenerate-shot/route.ts'));
    expect(code).toContain('isPlaceholderVideo(');
    // 这条第一版漏了:只给项目页写了断言,补渲路由把它删掉照样绿(变异实测)。
    expect(code, '「没有视频」的镜不能从补渲名单消失').toContain('candidates.every((x) => !x)');
  });

  it('全仓造判据的地方只有 placeholder-provenance 一处', () => {
    const files = require('node:child_process')
      .execSync('git ls-files "*.ts" "*.tsx"', { cwd: process.cwd(), encoding: 'utf-8' })
      .split('\n').filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      if (f === 'lib/placeholder-provenance.ts' || f.startsWith('tests/')) continue;
      // 豁免一处,带理由:这里读的是**编排器刚返回的结果对象**(把降级标记带过 API 边界),
      // 不是在判存量资产是不是占位片 —— 是另一件事,不属于「又造了一份判据」。
      if (f === 'app/api/projects/[id]/regenerate-shot/route.ts') continue;
      const code = strip(read(f));
      // 「自己判 isAnimatic 是不是 true」= 又造了一份判据
      if (/isAnimatic\s*===\s*true/.test(code)) offenders.push(f);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
