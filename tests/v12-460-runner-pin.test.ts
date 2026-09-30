/**
 * v12.460 · CI runner 锁版本。
 *
 * 每次 CI 都挂着一条告警:ubuntu-latest 2026-10-19 起切到 Ubuntu 26。那天起系统包、Playwright
 * 装的依赖、预装工具会一起变 —— 不锁的话,那之后的第一个红灯会和当次代码改动混在一起,分不清是谁的问题
 * (本仓已经吃过「CI 与本机 ffmpeg 构建不同 → 帧率不同」的亏)。
 *
 * 按 YAML **解析**取每个 job 真正生效的 runs-on(含矩阵展开),而不是 grep 原文:
 * 注释里提到 ubuntu-latest 不算违规,`runs-on: ${{ matrix.runner }}` 也得落到矩阵里的具体值才算数。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const DIR = '.github/workflows';
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

/** 每个 job 实际会用到的 runner 标签;矩阵引用展开成矩阵里的每个取值 */
function runnersOf(file: string): Array<{ job: string; runner: unknown }> {
  const wf = parse(fs.readFileSync(path.join(DIR, file), 'utf-8')) as { jobs?: Record<string, any> };
  const out: Array<{ job: string; runner: unknown }> = [];
  for (const [job, def] of Object.entries(wf.jobs ?? {})) {
    const ro = def?.['runs-on'];
    const m = typeof ro === 'string' ? ro.match(/^\$\{\{\s*matrix\.(\w+)\s*\}\}$/) : null;
    if (m) {
      const key = m[1];
      const include = (def.strategy?.matrix?.include ?? []) as Array<Record<string, unknown>>;
      const direct = def.strategy?.matrix?.[key];
      const vals = [...include.map((i) => i[key]), ...(Array.isArray(direct) ? direct : [])];
      expect(vals.length, `${file}:${job} 引用了 matrix.${key},却在矩阵里找不到取值`).toBeGreaterThan(0);
      for (const v of vals) out.push({ job, runner: v });
    } else {
      out.push({ job, runner: ro });
    }
  }
  return out;
}

describe('v12.460 · CI runner 锁版本', () => {
  it('窗口自证:三个 workflow 都在,且确实解析出了 job', () => {
    expect(files.sort()).toEqual(['ci.yml', 'docker-image.yml', 'star-history.yml']);
    for (const f of files) expect(runnersOf(f).length, f).toBeGreaterThan(0);
  });

  it('**没有任何 job 跑在 ubuntu-latest 上**,每个 runner 都是写死版本号的标签', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const { job, runner } of runnersOf(f)) {
        if (typeof runner !== 'string' || !/^ubuntu-\d{2}\.\d{2}(-arm)?$/.test(runner)) bad.push(`${f}:${job} → ${String(runner)}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('全部锁在同一个 Ubuntu 版本上(升级要一起升,别让 CI 和镜像构建跑在两套系统上)', () => {
    const versions = new Set(files.flatMap((f) => runnersOf(f).map(({ runner }) => String(runner).replace(/-arm$/, ''))));
    expect([...versions]).toEqual(['ubuntu-24.04']);
  });
});
