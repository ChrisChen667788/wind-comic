/**
 * v12.433 —— 流水线不许把失败标成完成。
 *
 * 起因(后台对抗复检,带真库证据):`create-pipeline` 收尾**无条件**写
 * `status: 'completed'`。视频那一段整个包在 try/catch 里,catch 只发一条会滚走的
 * `status` 进度消息 —— 那不是失败信号。于是「8 镜一条视频都没出」和「顺利完片」
 * 在库里写的是同一个词。
 *
 * 真库活样本 proj-1786416520904:completed、0 条 video、8 行 media_urls 为空的
 * storyboard;它自己的 timeline 质检写着「❌ 0 个有效视频片段, 成片无法合成」、
 * healthScore=20 —— 而全仓没有任何 UI 读那句话。10 个 completed 里 1 个是这样。
 *
 * 还有第三层谎:`failed` 这个状态从 v12.21.0 起 pipeline-worker 就会写,但列表页
 * 的词表里根本没有它,`|| statusConfig.draft` 把失败的项目贴成了「草稿」;
 * 项目详情页则是 `completed ? '已完成' : '制作中'`,失败的片子写着「制作中」,
 * 而它永远不会再动。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { judgePipelineOutcome, isFalselyCompleted, countUsableAssets } from '@/lib/pipeline-outcome';
import { projectStatusMeta, isProjectFailed } from '@/lib/project-status';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
/** 「不存在」类断言必须先去注释 —— 讲历史的注释里就写着旧代码 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('v12.433 · 判据:一条片都没出就不叫完成', () => {
  it('8 镜、0 片、0 图 → 失败,并说清断在生图那一段', () => {
    const v = judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 0, videoCount: 0 });
    expect(v.status).toBe('failed');
    expect((v as { reason: string }).reason).toContain('8 镜');
    expect((v as { reason: string }).reason).toContain('分镜图也全是空');
  });

  it('8 镜、0 片、但有 8 张图 → 失败,并说清断在出片那一段(重跑的着手点不同)', () => {
    const v = judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 8, videoCount: 0 });
    expect(v.status).toBe('failed');
    expect((v as { reason: string }).reason).toContain('断在出片');
    expect((v as { reason: string }).reason).not.toContain('分镜图也全是空');
  });

  it('剧本连分镜都没有 → 失败,理由指向剧本', () => {
    const v = judgePipelineOutcome({ shotCount: 0, storyboardsWithImage: 0, videoCount: 0 });
    expect(v.status).toBe('failed');
    expect((v as { reason: string }).reason).toContain('剧本');
  });

  it('出了片就算完成 —— 部分失败不归这里管,免得把真失败淹掉', () => {
    expect(judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 8, videoCount: 3 }).status).toBe('completed');
    expect(judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 8, videoCount: 8 }).status).toBe('completed');
  });

  it('undefined / NaN / 负数一律当 0,不许悄悄变成「有产出」', () => {
    for (const bad of [undefined, null, NaN, -1, '3', [], {}] as unknown[]) {
      const v = judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 8, videoCount: bad as number });
      expect(v.status).toBe('failed');
    }
    // 正向自证:上面是被判掉的,不是这个函数永远返回 failed
    expect(judgePipelineOutcome({ shotCount: 8, storyboardsWithImage: 8, videoCount: 1 }).status).toBe('completed');
  });
});

describe('v12.433 · 库里那些已经写坏的行', () => {
  it('completed + 0 片 + 有分镜 → 就是它', () => {
    expect(isFalselyCompleted({ status: 'completed', videoCount: 0, storyboardCount: 8 })).toBe(true);
  });

  it('有一条片就不算(哪怕只有一条)', () => {
    expect(isFalselyCompleted({ status: 'completed', videoCount: 1, storyboardCount: 8 })).toBe(false);
  });

  it('已经诚实标了 failed 的不再动', () => {
    expect(isFalselyCompleted({ status: 'failed', videoCount: 0, storyboardCount: 8 })).toBe(false);
  });

  it('一个分镜都没有的不管 —— 那可能是纯剧本草稿,不是「摆开架势零产出」', () => {
    expect(isFalselyCompleted({ status: 'completed', videoCount: 0, storyboardCount: 0 })).toBe(false);
  });
});

describe('v12.433 · 「有没有产出」按取得出 URL 算,不按行数', () => {
  it('行在、URL 空,一律不算 —— 真库那 8 行 storyboard 正是这样', () => {
    expect(countUsableAssets([
      { media_urls: '[]', persistent_url: null },
      { media_urls: '[""]', persistent_url: null },
      { media_urls: '["   "]', persistent_url: null },
      { media_urls: null, persistent_url: null },
      { media_urls: '{坏 JSON', persistent_url: null },
      { media_urls: undefined, persistent_url: '' },
    ])).toBe(0);
  });

  it('持久化副本或 media_urls 里有非空串就算', () => {
    expect(countUsableAssets([
      { media_urls: '["https://cdn/a.mp4"]', persistent_url: null },
      { media_urls: '[]', persistent_url: '/local/b.mp4' },
      { media_urls: '["", "https://cdn/c.mp4"]', persistent_url: null },
    ])).toBe(3);
  });
});

describe('v12.433 · 收尾这一步真的改判了(造好没接线等于没修)', () => {
  const src = read('lib/create-pipeline.ts');
  const code = stripComments(src);

  it('状态写的是判据的结论,不是硬写的 completed', () => {
    expect(code).toContain('judgePipelineOutcome(');
    expect(code).toContain('status: verdict.status');
    // 全仓这一处不许再出现字面量 completed
    expect(code).not.toContain("status: 'completed'");
  });

  it('判为失败时发 error 而不是 complete —— 队列路径正是靠 error 判失败的', () => {
    const at = code.indexOf("verdict.status === 'failed'");
    expect(at).toBeGreaterThan(0);
    // 窗口切到这个分支自己的 return 为止 —— 开宽了会切进后面的正常路径,
    // 那里本来就有 send('complete'),断言就永远红(第一版就是这么红的)。
    const end = code.indexOf('return;', at);
    expect(end).toBeGreaterThan(at);
    const seg = code.slice(at, end + 'return;'.length);
    // 正向自证:窗口切对了
    expect(seg).toContain('PIPELINE_NO_OUTPUT');
    expect(seg).toContain("send('error'");
    expect(seg).toContain('return;');
    // 失败分支里不许还发 complete
    expect(seg).not.toContain("send('complete'");
  });

  it('判据取的是「真有 URL 的」而不是数组长度', () => {
    const at = code.indexOf('judgePipelineOutcome({');
    const seg = code.slice(at, at + 400);
    expect(seg).toContain('imageUrl');
    expect(seg).toContain('videoUrl');
  });
});

describe('v12.433 · 状态词表:失败不许显示成草稿', () => {
  it('failed 有自己的说法', () => {
    expect(projectStatusMeta('failed').label).toBe('生成失败');
    expect(projectStatusMeta('failed').tone).toBe('bad');
    expect(projectStatusMeta('failed').inProgress).toBe(false);
    expect(isProjectFailed('failed')).toBe(true);
  });

  it('不认识的状态说「不认识」,绝不拿草稿冒充', () => {
    const m = projectStatusMeta('weird-new-status');
    expect(m.label).toContain('状态未知');
    expect(m.label).not.toContain('草稿');
    expect(projectStatusMeta('').label).toBe('状态未知');
    expect(projectStatusMeta(undefined).label).toBe('状态未知');
  });

  it('脏值要截短 —— 整条印上去会撑破卡片(实测溢出过)', () => {
    const m = projectStatusMeta('x'.repeat(200));
    expect(m.label.length).toBeLessThan(30);
    expect(m.label).toContain('…');
  });

  it('已有状态一个都没丢', () => {
    for (const [k, label] of [['completed', '已完成'], ['active', '创作中'], ['draft', '草稿'], ['archived', '已下架']]) {
      expect(projectStatusMeta(k).label).toBe(label);
    }
  });
});

describe('v12.433 · 两个页面都用同一份词表,不再各写各的', () => {
  it('列表页:词表来自 lib/project-status,且不再拿 draft 兜底', () => {
    const src = read('app/dashboard/projects/page.tsx');
    const code = stripComments(src);
    expect(code).toContain("from '@/lib/project-status'");
    expect(code).toContain('projectStatusMeta(');
    expect(code).not.toContain('statusConfig[p.status] || statusConfig.draft');
    expect(code).not.toMatch(/const statusConfig[^=]*=\s*\{[\s\S]{0,80}completed:\s*\{\s*label:/);
  });

  it('列表页筛选栏里有「生成失败」—— 否则失败的项目哪个筛选都进不去', () => {
    const code = stripComments(read('app/dashboard/projects/page.tsx'));
    expect(code).toContain("{ key: 'failed', label: '生成失败' }");
    expect(code).toContain("'failed'");
  });

  it('详情页:不再是 completed / 其余一律「制作中」的二选一', () => {
    const src = read('app/projects/[id]/page.tsx');
    const code = stripComments(src);
    expect(code).toContain("from '@/lib/project-status'");
    expect(code).toContain('projectStatusMeta(project.status)');
    expect(code).not.toContain("project.status === 'completed' ? '已完成' : '制作中'");
    expect(code).not.toContain("project.status === 'completed' ? 'COMPLETED' : 'IN PRODUCTION'");
  });
});

describe('v12.433 · 修复脚本:判据必须跟线上同一份', () => {
  const src = read('scripts/repair-false-completed.mjs');

  it('判据从 lib/pipeline-outcome 引,不许自己写一套', () => {
    expect(src).toContain("from '../lib/pipeline-outcome.ts'");
    expect(src).toContain('isFalselyCompleted');
    expect(src).toContain('countUsableAssets');
    const code = stripComments(src);
    // 不许在脚本里另起炉灶判「算不算完成」
    expect(code).not.toMatch(/videoCount\s*===\s*0\s*&&/);
  });

  it('默认只预览,改判可还原', () => {
    expect(src).toContain("includes('--apply')");
    expect(src).toContain("includes('--restore')");
    expect(src).toContain('LEDGER');
    // 账本要记原状态,否则还原时只能猜
    expect(src).toContain('was: b.status');
  });

  it('package.json 里挂了口子,不是一个没人跑得到的脚本', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['repair:status']).toContain('repair-false-completed');
  });
});
