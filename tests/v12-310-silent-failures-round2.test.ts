/**
 * v12.310 — 补跑审计揪出的三条静默失败(第 15 项交付的一半)。
 *
 * 这批的可信度值得先说一句:上一轮同一个 workflow 撞限额死掉,而我用 `.then()` 包了一层,
 * **死掉的 agent 返回 null 被转成「完成但零发现」** —— 于是报了个假的「6/6 维度完成」。
 * 这次脚本直接判 `raw[i] != null`,结果是 `complete: true / dead: [] / 10 agents 零 error`,
 * 8 条提出、6 条确认、2 条被正确证伪。**这批才是可信的。**
 *
 * ── ① 门禁自己静默通过(high,最要命)──────────────────────────────
 * `scripts/license-check.mjs` 里 `if (!raw.trim()) return []` 与 `catch { return [] }`:
 * npm ls 输出被截断/畸形时(node_modules 装了一半、磁盘满、peer 冲突输出超 maxBuffer),
 * 扫描包数变 **0**,然后打印「✅ 未发现 copyleft 依赖」并 **exit 0**。
 * 一个新引入的 GPL 依赖可以**带着一个假的 CI 绿灯**进主干。
 * 空扫描现在是硬失败(exit 2),并加了「解析出 0 个生产依赖即失败」的哨兵。
 *
 * ── ② 成片少一整场戏,却报「合成完成」(medium)────────────────────
 * 下载失败/视频损坏的镜被静默丢掉,而 `clipCount` 回的是**成功数**,
 * 调用方直接拿它报「合成完成!5个片段」。用户看到成功,拿到的是少一场戏的片子。
 * 取舍:**不改成抛错** —— 已下好的部分仍值得出片(与 v12.294「只报不拦」同一取舍),
 * 但把丢掉的镜号带出去(`skippedShots`,**必填**),由调用方显式告警。
 *
 * ── ③ 失败标成 completed 且不发错误事件(medium)───────────────────
 * orchestrator 外层 catch 只写空 URL,**不 emit pipelineError** —— 与 legacyVideoGen 的
 * all-engines-failed 分支不对称。进度条照常前进,UI 在重试扫描启动前二十多秒看不到异常;
 * 若重试也落到这条路径就一直静默下去,最后还打印「视频全部生成完毕」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const LIC = strip(fs.readFileSync('scripts/license-check.mjs', 'utf-8'));
const COMP = strip(fs.readFileSync('services/video-composer.ts', 'utf-8'));
const ORCH = strip(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));
const EDITOR = strip(fs.readFileSync('services/agents/editor-agent.ts', 'utf-8'));

describe('v12.310 · ① 门禁不许再静默通过', () => {
  it('**空输出与解析失败都必须是硬失败**,不是 return []', () => {
    expect(LIC, 'npm ls 无输出仍 return [] —— 门禁会扫 0 个包然后说通过')
      .not.toMatch(/if \(!raw\.trim\(\)\) return \[\];/);
    expect(LIC, 'JSON 解析失败仍 return []').not.toMatch(/catch \{ return \[\]; \}/);
    expect((LIC.match(/process\.exit\(2\)/g) || []).length, '三条失败路径各一个硬退出')
      .toBeGreaterThanOrEqual(3);
  });

  it('**扫到 0 个生产依赖即失败**(哨兵:解析没抛错也可能拿到空树)', () => {
    expect(LIC).toMatch(/names\.size === 0/);
    const i = LIC.indexOf('names.size === 0');
    expect(LIC.slice(i, i + 260)).toContain('process.exit(2)');
  });

  it('失败时给出可排查的原因,不是干退出', () => {
    expect(LIC).toMatch(/FATAL/);
    expect(LIC).toMatch(/node_modules|依赖树/);
  });

  it('正常路径仍以 exit 0 收场(没有把门禁改成永远红)', () => {
    expect(LIC).toContain('process.exit(0)');
  });
});

describe('v12.310 · ② 少了镜头必须说出来', () => {
  it('composeVideo 回传 skippedShots,且是**必填**', () => {
    const i = COMP.indexOf('export interface ComposeResult');
    const block = COMP.slice(i, i + 1500);
    expect(block).toMatch(/skippedShots: number\[\];/);
    expect(block, '设成可选就会有人忘了看').not.toMatch(/skippedShots\?:/);
  });

  it('按「哪些下标没拿到结果」算,而不是靠计数相减', () => {
    const i = COMP.indexOf('const skippedShots: number[]');
    expect(i).toBeGreaterThan(0);
    const block = COMP.slice(i, i + 320);
    expect(block).toContain('probed[i]');
    expect(block, '要报镜号而不是下标').toContain('shotNumber');
  });

  it('**不改成抛错** —— 已下好的部分仍值得出片(与 v12.294 同一取舍)', () => {
    const i = COMP.indexOf('const skippedShots: number[]');
    // 窗口要在 `if (localClips.length === 0)` **之前**收住 —— 那之后是「全失败才抛」的老行为,
    // 框进来会让断言误红(第一次写就栽在这)。
    const block = COMP.slice(i, COMP.indexOf('if (localClips.length === 0)', i));
    expect(block).not.toMatch(/throw new Error/);
  });

  it('全部失败仍然抛错(这条老行为不能被顺手改掉)', () => {
    expect(COMP).toContain("throw new Error('No valid video clips to compose')");
  });

  it('调用方真的把它说出来了(回传了没人看等于没回传)', () => {
    expect(EDITOR).toContain('result.skippedShots');
    const i = EDITOR.indexOf('result.skippedShots');
    const block = EDITOR.slice(i, i + 500);
    expect(block).toContain('audioWarnings.push');
    expect(block).toContain("ctx.emit('agentTalk'");
    expect(block, '要说清后果').toMatch(/少这几场|未能进入成片/);
  });

  it('告警排在「合成完成」之前(否则被成功提示盖过去)', () => {
    const iWarn = EDITOR.indexOf('result.skippedShots');
    const iOk = EDITOR.indexOf('FFmpeg 合成完成');
    expect(iWarn).toBeGreaterThan(0);
    expect(iWarn).toBeLessThan(iOk);
  });
});

describe('v12.310 · ③ 失败要发错误事件,不能只写个空 URL', () => {
  it('外层 catch 里 emit pipelineError', () => {
    const i = ORCH.indexOf("videos[i] = { shotNumber: board.shotNumber, videoUrl: ''");
    expect(i, '未找到异常路径').toBeGreaterThan(0);
    const block = ORCH.slice(Math.max(0, i - 700), i);
    expect(block).toContain("this.emit('pipelineError'");
    expect(block, '要带镜号,否则 UI 不知道是哪一镜').toContain('shotNumber: board.shotNumber');
    expect(block, '标记可重试,与 legacyVideoGen 口径一致').toMatch(/retryable: true/);
  });

  it('事件发送失败不该反过来拖垮生成循环', () => {
    // 必须锚**本版新加的那处**;直接 indexOf 会命中 legacyVideoGen 里的旧 emit
    // (那处不在 try 里),断言就误红了 —— 这轮第四次栽在锚点上。
    const iAssign = ORCH.indexOf("videos[i] = { shotNumber: board.shotNumber, videoUrl: ''");
    const block = ORCH.slice(Math.max(0, iAssign - 700), iAssign);
    expect(block).toContain("this.emit('pipelineError'");
    expect(block, 'emit 要包在 try 里').toContain('catch');
  });

  it('与既有 all-engines-failed 分支口径一致(不是新造一种错误)', () => {
    expect((ORCH.match(/emit\('pipelineError'/g) || []).length, '现在至少两处')
      .toBeGreaterThanOrEqual(2);
  });
});
