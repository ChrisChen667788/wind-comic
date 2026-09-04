/**
 * v12.423 — arm64 走 QEMU 模拟,实测 43 分钟。
 *
 * ── 由来 ──────────────────────────────────────────────────────────────
 * v12.421 用 `platforms: linux/amd64,linux/arm64` 一次出双架构,arm64 走 QEMU。
 * 最近一次完整构建 **43 分钟**(另一次 13 分钟是命中缓存)。慢的是 `npm ci` +
 * `next build` 在模拟层上跑,缓存救不了那一段。当时如实记着「还没改」,这一版改。
 *
 * ── 这条测试锁的三件事,都是「不报错但出错」的形态 ──────────────────────
 * ① **矩阵 job 不能用 job-level `outputs` 传 digest**。每个矩阵实例都写同一组 output,
 *    后完成的覆盖先完成的 —— 永远只拿得到一个架构的 digest。这是 Actions 的既有行为,
 *    不是配置写错,而且**不会报错**:你会合出一个只有单架构的 manifest。
 * ② **两个 job 不能各自打同一个 tag**。后推的覆盖先推的,tag 最终只指向一个架构,
 *    同样不报错 —— 另一半架构的人拉下来才发现跑不了。所以按 digest 推、tag 只在合成时落一次。
 * ③ **合成成功 ≠ 合对了**。必须回头 inspect 一次,确认 manifest 里真有两种架构。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const RAW = fs.readFileSync('.github/workflows/docker-image.yml', 'utf-8');
/** 剥 YAML 注释 —— 断言「某写法不存在」时,注释里的说明会假命中 */
const WF = RAW.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n');

describe('v12.423 · 原生 arm64 构建', () => {
  it('两个架构各自跑在原生 runner 上,不再经 QEMU', () => {
    expect(WF, '窗口自证:这不是那个 workflow?').toContain('docker/build-push-action');
    expect(WF).toContain('ubuntu-24.04-arm');
    expect(WF).toContain('ubuntu-latest');
    // QEMU 是这一版要去掉的东西
    expect(WF.includes('setup-qemu-action'), 'QEMU 还在 —— 那 43 分钟就没省下来').toBe(false);
    // 也不该再有「一次出两个架构」的写法
    expect(WF.includes('linux/amd64,linux/arm64'), '还在一个 job 里出双架构').toBe(false);
  });

  it('**digest 不能靠矩阵 job 的 outputs 传** —— 那会静默丢掉一个架构', () => {
    // 每个矩阵实例都写同一组 output,后完成的覆盖先完成的。不报错,只是少一个架构。
    expect(WF.includes('needs.build.outputs.digest'), '又用回矩阵 outputs 传 digest 了').toBe(false);
    // 官方做法:artifact
    expect(WF).toContain('actions/upload-artifact');
    expect(WF).toContain('actions/download-artifact');
    // 传不上去要立刻失败,而不是让 merge 拿着空 digest 往下走
    expect(WF).toContain('if-no-files-found: error');
  });

  it('按 digest 推,tag 只在合成那一步落一次', () => {
    expect(WF, 'build job 应按 digest 推').toContain('push-by-digest=true');
    // build job 里不能有 tags —— 两个 job 打同一个 tag 会互相覆盖
    const buildStart = WF.indexOf('  build:');
    const mergeStart = WF.indexOf('  merge:');
    expect(buildStart).toBeGreaterThan(0);
    expect(mergeStart).toBeGreaterThan(buildStart);
    const buildJob = WF.slice(buildStart, mergeStart);
    expect(buildJob.includes('tags:'), 'build job 里出现了 tags —— 两个架构会互相覆盖').toBe(false);
    // tag 在 merge job 里由 metadata-action 生成
    expect(WF.slice(mergeStart)).toContain('metadata-action');
  });

  it('digest 不齐时必须拒绝合成 —— 单架构 manifest 不报错,拉的人才发现', () => {
    const i = WF.indexOf('Create manifest list');
    expect(i, '找不到合成步骤').toBeGreaterThan(0);
    const block = WF.slice(i, i + 900);
    expect(block).toMatch(/-z "\$AMD"|-z "\$ARM"/);
    expect(block, '缺 digest 时要 exit 1,不能只打印一句就往下走').toContain('exit 1');
  });

  it('**合成成功 ≠ 合对了** —— 必须回头确认两种架构都在 manifest 里', () => {
    const i = WF.indexOf('Verify the manifest');
    expect(i, '没有合成后的校验步骤').toBeGreaterThan(0);
    const block = WF.slice(i);
    expect(block).toContain('imagetools inspect');
    expect(block).toContain('amd64');
    expect(block).toContain('arm64');
    expect(block, '校验不通过要 exit 1').toContain('exit 1');
  });

  it('架构校验必须解析 JSON,不能 grep 字符串 —— 否则是个会误报的门禁', () => {
    // 第一版写的是 `grep -q '"architecture":"arm64"'`,而 `imagetools inspect --raw`
    // 输出的是**带空格的 pretty JSON**(`"architecture": "arm64"`)—— 永远匹配不上。
    // 结果:manifest 明明合对了(两个架构都在),校验却报红。
    // 已用真实 manifest 实证:jq 版识别出 `amd64 arm64`,grep 版不命中。
    //
    // 这比「少了个架构」更糟:**一个会误报的门禁只会训练人忽略门禁**,
    // 而它守的正是「别把单架构镜像发出去」这种拉的人才发现的问题。
    const i = WF.indexOf('Verify the manifest');
    expect(i, '找不到校验步骤').toBeGreaterThan(0);
    const block = WF.slice(i);
    expect(block, '校验没用 jq 解析').toContain('jq -r');
    expect(
      /grep -q .*architecture/.test(block),
      '又退回 grep 字符串了 —— JSON 排版一变就误报',
    ).toBe(false);
    // buildx 会在 manifest 里放 attestation(platform 是 unknown/unknown),必须排除掉
    expect(block, '没排除 attestation 的 unknown 平台').toContain('unknown');
  });

  it('缓存按架构分开 —— 否则两个架构互相污染对方的层', () => {
    expect(WF).toMatch(/cache-from:\s*type=gha,scope=/);
    expect(WF).toMatch(/cache-to:\s*type=gha,mode=max,scope=/);
  });

  it('每个架构都在**自己的原生机器上**冒烟,而不是只测 amd64', () => {
    const buildJob = WF.slice(WF.indexOf('  build:'), WF.indexOf('  merge:'));
    expect(buildJob, '冒烟步骤不在 build job 里').toContain('docker run');
    expect(buildJob, 'arm64 的镜像要在 arm64 机器上验,不经模拟层才作数').toContain('fc-match');
  });

  it('镜像名全小写 —— v12.421 在这上面栽过一次(exit 125)', () => {
    expect(WF).toContain("tr '[:upper:]' '[:lower:]'");
    for (const m of RAW.matchAll(/ghcr\.io\/[a-zA-Z0-9._\/-]+/g)) {
      expect(m[0], `硬编的镜像引用有大写:${m[0]}`).toBe(m[0].toLowerCase());
    }
  });

  it('paths 过滤里不留已删目录 —— drizzle v12.421 已确认根本不存在', () => {
    expect(WF.includes("- 'drizzle/**'"), 'paths 里还留着不存在的 drizzle').toBe(false);
    // 而 docker/(字体别名配置)必须在 —— 改它要重建镜像
    expect(WF).toContain("- 'docker/**'");
  });
});
