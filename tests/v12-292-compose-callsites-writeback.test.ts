/**
 * v12.292 — 每一条「能产出成片」的路径都必须回写转场,新增第五条也别想漏掉。
 *
 * **这一条打脸 v12.289 本身。** 那版修的就是「支路修好、主路没接」,结果它自己只接了
 * 四条 composeVideo 调用路径里的**一条**。补跑上次死掉的复核维度时被完整揪出来
 *(这次 workflow 7/7 跑完、零 error,所以结论可信):
 *
 *  - `services/agents/editor-agent.ts` 主路径 —— v12.289 接了 ✅
 *  - `services/agents/editor-agent.ts` **降级路径**(composeVideoRetry)—— 没接 ❌
 *    主合成抛异常时控制流直接跳进 catch,回写那几行在 try 里永远不执行;
 *    降级成片是**全硬切**,而 timeline 里留着设计值(溶解)→ 导出的剪辑线凭空多出几条
 *    实际不存在的溶解,剪辑师拉进 Premiere 会发现素材里根本没有过渡帧。
 *  - `app/api/projects/[id]/recompose/route.ts` —— 没接 ❌
 *    它连 timeline 资产都不落,只 upsert final_video;而 EDL/AAF 一律以 timeline 资产为准。
 *    重合成时 selectTransitions 会按张力重新挑,于是成片越新、剪辑线越旧。
 *  - `app/api/mv/compose/route.ts` —— **合法豁免**(见下方 EXEMPT 的 why)
 *
 * 所以本版不只是补两处调用 —— 补调用只能修掉这三条,第五条路径照样会漏。
 * 下面这条测试**枚举全仓的 composeVideo 调用点**,要求每一处要么回写、要么在 EXEMPT 里写明理由。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** 递归收集生产代码(不含测试) */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const PROD_DIRS = ['app', 'services', 'lib'];
const SRC_FILES = PROD_DIRS.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));

/** 剥掉注释 —— 否则「解释病根」的注释会把门禁弄红(v12.240 的教训) */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 真正的调用点:`composeVideo(` 或 `composeVideoXxx(`,排除实现本体与 import */
const CALL_RE = /\bcomposeVideo[A-Za-z]*\s*\(/;

/**
 * 豁免名单 —— 每条必须写 why。新增豁免等于主动声明「这条路径产出的片子不进剪辑线导出」。
 */
const EXEMPT: Array<{ file: string; why: string }> = [
  {
    file: 'services/video-composer.ts',
    why: 'composeVideo 的实现本体,不是调用方',
  },
  {
    file: 'app/api/mv/compose/route.ts',
    why: 'MV 卡点合成:全程硬切、不写任何 project_asset(无 timeline 资产),EDL/AAF 也不认 MV 产物 —— 没有会读到过期转场的消费方',
  },
];

describe('v12.292 · composeVideo 的每个调用点都必须回写转场', () => {
  const callers = SRC_FILES
    .map((f) => ({ file: f, src: stripComments(fs.readFileSync(f, 'utf-8')) }))
    .filter(({ src }) => CALL_RE.test(src))
    .map(({ file, src }) => ({ file: file.replace(/\\/g, '/'), src }));

  it('哨兵:确实扫到了调用点(walk 坏掉时不能空跑变假绿)', () => {
    expect(SRC_FILES.length, '生产文件数下限').toBeGreaterThan(200);
    expect(callers.length, '至少应有实现本体 + editor-agent + recompose + mv').toBeGreaterThanOrEqual(4);
  });

  it('**每个调用点要么回写 applyRenderedTransitions,要么在 EXEMPT 里写明理由**', () => {
    const exemptFiles = new Set(EXEMPT.map((e) => e.file));
    const missing = callers
      .filter(({ file }) => !exemptFiles.has(file))
      .filter(({ src }) => !src.includes('applyRenderedTransitions'))
      .map(({ file }) => file);
    expect(missing, `这些路径能产出成片却不回写转场,导出的剪辑线会与成片不符:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('EXEMPT 里的每条都必须写 why,且文件真实存在(防豁免名单腐烂)', () => {
    for (const e of EXEMPT) {
      expect(fs.existsSync(e.file), `豁免了不存在的文件 ${e.file}`).toBe(true);
      expect(e.why.length, `${e.file} 的豁免理由太短`).toBeGreaterThan(20);
    }
  });

  it('豁免名单不得包含真正需要回写的路径(EXEMPT 本身也要能被证伪)', () => {
    for (const e of EXEMPT) {
      if (e.file === 'services/video-composer.ts') continue;
      const src = fs.readFileSync(e.file, 'utf-8');
      // 豁免的前提是「没有会读到过期转场的消费方」→ 它不该去写 timeline 资产
      expect(src, `${e.file} 写了 timeline 资产,就不该被豁免`).not.toMatch(/type:\s*['"]timeline['"]/);
    }
  });
});

describe('v12.292 · 三条路径逐一验明', () => {
  const EDITOR = stripComments(fs.readFileSync('services/agents/editor-agent.ts', 'utf-8'));
  const RECOMPOSE = stripComments(fs.readFileSync('app/api/projects/[id]/recompose/route.ts', 'utf-8'));

  it('主路径:回写传的是 result.renderedTransitions', () => {
    expect(EDITOR).toContain('applyRenderedTransitions(timeline as any[], result.renderedTransitions)');
  });

  it('降级路径:回写传的是 simpleResult.renderedTransitions(不是主路径那个 result)', () => {
    expect(EDITOR).toContain('applyRenderedTransitions(timeline as any[], simpleResult.renderedTransitions)');
  });

  it('降级路径的回写必须在 composeVideoRetry 之后、且在它自己的 try 里', () => {
    const iRetry = EDITOR.indexOf('composeVideoRetry({');
    const iApply = EDITOR.indexOf('simpleResult.renderedTransitions');
    expect(iRetry).toBeGreaterThan(0);
    expect(iApply).toBeGreaterThan(iRetry);
    expect(EDITOR.slice(iRetry, iApply + 200)).toContain('catch');
  });

  it('recompose:回写后必须把 timeline 资产写回去(只改内存没用)', () => {
    expect(RECOMPOSE).toContain('applyRenderedTransitions(tl.timeline, result.renderedTransitions)');
    const i = RECOMPOSE.indexOf('applyRenderedTransitions(tl.timeline');
    const after = RECOMPOSE.slice(i, i + 600);
    expect(after).toMatch(/upsertAsset\(\{[\s\S]*type:\s*'timeline'/);
  });

  it('recompose 的 upsert 必须沿用原资产 name,否则会插出重复行', () => {
    const i = RECOMPOSE.indexOf("type: 'timeline'");
    expect(RECOMPOSE.slice(i, i + 220)).toMatch(/timelineAssets\[0\]\?\.name/);
  });
});
