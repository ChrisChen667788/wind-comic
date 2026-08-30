/**
 * v12.400:同一个病这一轮犯了至少八次 —— 做一把能提前看见它的尺子。
 *
 * v12.375 主管线按角色名选音色,recompose 硬编码一个不存在的 id;
 * v12.381 localize 过滤多语稿,pull-sheet / recompose 直接取 [0];
 * v12.383 上一版立了唯一入口,却只手工接了 3 个消费方 —— 实际有 11 个;
 * v12.385 项目级 regenerate-shot 落盘 + 标降级,顶层那个两样都没跟上;
 * v12.387 shot-audio 读手动音色覆盖,recompose 不读;
 * v12.388 付费门禁只认直接调用,漏掉编排器这条间接路径;
 * v12.393 refCount 被算了三遍,三种口径;
 * v12.399 sweepDir 有「一个都没被引用就停手」的自检,asset-storage 那条没有。
 *
 * 每一次都是「主路径修好了、旁路没跟上」,**每一次都等到出事才发现**。
 * `consumer-gate` 能拦「绕过唯一入口」,却拦不了「还没有唯一入口、两处各写各的」——
 * 那正是上面八条的共同形态。
 *
 * `scripts/twin-path-scan.mjs` 不下结论,只把结构性风险摆出来:
 * 某个下游能力被多处调用、而各调用点传的参数集合不一样。
 * 那不一定是 bug(不同入口本来就可能需要不同参数),但它是
 * 「其中一处改了、别处忘了」的**必要条件**。
 *
 * **它当场就找出了第九次**:`dispatchTTSGenerate` 有 8 处调用、7 种传参形态,
 * 而 `shot-audio` 与 `voice-retake` 都传 `speed`/`pitch`(按情绪推导的韵律,
 * v2.9 起、v12.274 逐档配过),只有 `recompose` 的配音重生一个都不传 ——
 * 同一句台词走重合成出来就是**平读**:该急的地方不急,该沉的地方不沉。
 *
 * 刻意做成**只报告不阻断**(不进 preflight):它的产出是一份供人过目的清单,
 * 不是能自动判对错的规则。一个会误报的门禁只会训练人忽略门禁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { deriveProsody } from '@/lib/tts-prosody';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const codeOf = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('recompose 的配音重生带上韵律', () => {
  const code = codeOf(read('app/api/projects/[id]/recompose/route.ts'));

  it('调 deriveProsody 并把 speed / pitch 传给 TTS', () => {
    const i = code.indexOf('dispatchTTSGenerate({');
    expect(i, '找不到 TTS 调用点').toBeGreaterThan(0);
    const win = code.slice(Math.max(0, i - 300), i + 260);
    expect(win, '窗口自证').toContain('dispatchTTSGenerate');
    expect(win).toContain('deriveProsody');
    expect(win).toMatch(/speed:\s*prosody\.speed/);
    expect(win).toMatch(/pitch:\s*prosody\.pitch/);
  });

  it('情绪一路从剧本带到 clip —— 不带过来就只能推出中性韵律', () => {
    expect(code, 'dlg 映射要收 emotion').toMatch(/emotion:\s*s\.emotion/);
    expect(code, 'clip 要带 emotion').toMatch(/emotion:\s*sc\.emotion/);
    expect(code).toMatch(/emotionTemperature/);
  });

  it('与主路径 shot-audio 同一口径', () => {
    const main = codeOf(read('app/api/projects/[id]/shot-audio/route.ts'));
    expect(main).toContain('deriveProsody');
    expect(main).toMatch(/speed:\s*prosody\.speed/);
  });

  it('韵律确实随情绪变 —— 否则传了也等于没传', () => {
    const angry = deriveProsody({ emotion: '愤怒', emotionTemperature: 0.6 });
    const sad = deriveProsody({ emotion: '悲伤', emotionTemperature: 0.6 });
    const neutral = deriveProsody({});
    expect(angry.speed, '愤怒该比中性快').toBeGreaterThan(neutral.speed);
    expect(sad.speed, '悲伤该比中性慢').toBeLessThan(neutral.speed);
    expect(angry.pitch).not.toBe(sad.pitch);
  });
});

describe('twin-path-scan', () => {
  const out = execFileSync('node', [path.join(ROOT, 'scripts/twin-path-scan.mjs')], { cwd: ROOT, encoding: 'utf-8' });

  it('能跑通,并报出扫了多少文件', () => {
    expect(out).toMatch(/扫描 \d+ 个文件/);
  });

  it('明确声明自己是报告而非门禁 —— 会误报的门禁只会训练人忽略门禁', () => {
    const src = read('scripts/twin-path-scan.mjs');
    expect(src).toMatch(/只报告不阻断|报告不是门禁/);
    // 不阻断:即使有发现也不能非零退出
    expect(out.length).toBeGreaterThan(0);
  });

  it('不进 preflight(它的产出要人过目,不能自动判对错)', () => {
    expect(read('scripts/preflight.mjs')).not.toContain('twin-path-scan');
  });

  it('关注列表里的能力都对应真实事故,不是凭空列的', () => {
    const src = read('scripts/twin-path-scan.mjs');
    // 每个 WATCH 项都该在本仓库真实存在
    for (const fn of ['dispatchTTSGenerate', 'pickScriptAsset', 'shouldRefuseSweep', 'guardPaidEndpoint']) {
      expect(src).toContain(fn);
    }
    expect(src, '注释里要写清每条对应哪一版事故').toMatch(/v12\.3\d\d/);
  });

  it('剥掉 import 与注释再统计 —— 否则 import 行会被当成一处调用', () => {
    const src = read('scripts/twin-path-scan.mjs');
    expect(src).toMatch(/\^\\s\*import\\s/);
  });
});
