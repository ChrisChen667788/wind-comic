/**
 * v12.458 · 会原地改真实源文件的测试,必须和主套件分组、最后单独跑。
 *
 * `tests/v12-396-mutation-probe.test.ts` 让 scripts/mutation-probe.mjs 把 lib/genre-vocab.ts 的 isSad
 * 改成恒 false 再还原;那几秒里并行 worker 上加载 genre-vocab 的测试(v12-362 的 isSad 正例、
 * prompt-templates 的「悲情基调」)会拿到变异版而变红。v12.456/457 发版期间 6 次全量撞了 3 次。
 * vitest.config.ts 用 projects + sequence.groupOrder 把它放进第 1 组;这里锁住三件事:
 * 隔离清单真的生效、主套件真的排除了它们、以后新增的「探针类」测试也必须进清单。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import config, { SOURCE_MUTATING_TESTS } from '../vitest.config';

type Project = { extends?: boolean; test?: { name?: string; include?: string[]; exclude?: string[]; sequence?: { groupOrder?: number } } };
const projects = ((config as any).test?.projects ?? []) as Project[];
const byName = (n: string) => projects.find((p) => p.test?.name === n);

describe('v12.458 · 改源文件的测试与主套件隔离', () => {
  it('变异探针测试在隔离清单里', () => {
    expect(SOURCE_MUTATING_TESTS).toContain('tests/v12-396-mutation-probe.test.ts');
    for (const f of SOURCE_MUTATING_TESTS) expect(fs.existsSync(f), `清单里的 ${f} 不存在`).toBe(true);
  });

  it('主套件(第 0 组)排除了清单里的每一个文件', () => {
    const main = byName('main');
    expect(main, '找不到 main 项目').toBeTruthy();
    expect(main!.extends, 'main 要继承根配置(setupFiles / alias / jsdom)').toBe(true);
    for (const f of SOURCE_MUTATING_TESTS) expect(main!.test!.exclude).toContain(f);
    expect(main!.test!.exclude, 'e2e 仍然排除').toContain('e2e/**');
    expect(main!.test!.exclude, '.claude 技能包仍然排除(v12.321)').toContain('.claude/**');
    expect(main!.test!.sequence?.groupOrder ?? 0).toBe(0);
  });

  it('隔离组只含清单里的文件,且排在主套件之后', () => {
    const iso = byName('source-mutating');
    expect(iso, '找不到 source-mutating 项目').toBeTruthy();
    expect(iso!.extends).toBe(true);
    expect(iso!.test!.include).toEqual(SOURCE_MUTATING_TESTS);
    expect(iso!.test!.sequence?.groupOrder ?? 0).toBeGreaterThan(byName('main')!.test!.sequence?.groupOrder ?? 0);
  });

  it('凡是调用变异探针的测试都在清单里(以后新增的也跑不掉)', () => {
    const files = fs.readdirSync('tests').filter((f) => /\.test\.(t|j)sx?$/.test(f)).map((f) => path.join('tests', f));
    expect(files.length, '测试目录是空的,这条断言没意义').toBeGreaterThan(300);
    const callers = files.filter((f) => f !== 'tests/v12-458-source-mutating-isolation.test.ts'
      && fs.readFileSync(f, 'utf-8').includes('scripts/mutation-probe.mjs'));
    expect(callers.length, '一个调用方都没找到,扫描本身坏了').toBeGreaterThan(0);
    for (const f of callers) expect(SOURCE_MUTATING_TESTS, `${f} 会改真实源文件,必须进隔离清单`).toContain(f);
  });
});
