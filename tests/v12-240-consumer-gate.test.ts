/**
 * v12.240 — 「消费方门禁」自身的测试。
 *
 * 门禁是用来防别的代码退化的,但**它自己退化了谁来管**?这个文件就是管这个的:
 * 锁住剥注释、指纹稳定性、基线分区、以及「新违规必被拦」这几件事。
 *
 * 特别锁两条我自己踩过的坑:
 *   · **剥注释**:v12.234/239 各有一次,我在注释里解释病根时引用了违规写法本身,
 *     源码锁扫全文就把自己的解释判成违规。把问题讲清楚不该让门禁报警。
 *   · **指纹不含行号**:上面插一行注释就让老债变「新违规」的话,CI 会无故变红,
 *     人被无故的红弄烦之后就会关掉门禁 —— 假红对门禁的杀伤力不亚于假绿。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { stripComments, runConsumerGate, type Violation } from '@/lib/consumer-gate/scan';
import { fingerprint, normalizeSnippet, partition, loadBaseline, BASELINE_PATH } from '@/lib/consumer-gate/baseline';
import { CONTRACTS, RUNTIME_ONLY_GAPS, DANGEROUS_ENV_SWITCHES } from '@/lib/consumer-gate/contracts';

const ROOT = path.join(__dirname, '..');

describe('v12.240 剥注释(踩过两次的坑)', () => {
  it('行注释与块注释里的违规写法不算数', () => {
    const src = [
      "// 此处原为 fetch(url) —— 解释病根",
      '/* 块注释里也提到 fetch(url) */',
      'const a = 1;',
    ].join('\n');
    const out = stripComments(src);
    expect(/fetch\(url\)/.test(out)).toBe(false);
    expect(out.includes('const a = 1;')).toBe(true);
  });

  it('剥注释后行号不漂移(报错要能指到正确的行)', () => {
    const src = '// c1\n/* c2 */\nconst x = 1;\n';
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
    expect(stripComments(src).split('\n')[2]).toContain('const x = 1;');
  });

  it('字符串字面量要保留 —— 有的契约就是查字面量(硬编码字体路径)', () => {
    const src = `const f = '/System/Library/Fonts/PingFang.ttc';`;
    expect(stripComments(src)).toContain('/System/Library/Fonts/PingFang.ttc');
  });

  it('字符串里的 // 不能被当成注释起点', () => {
    const src = `const u = 'https://example.com/a'; const b = 2;`;
    const out = stripComments(src);
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('const b = 2;');
  });
});

describe('v12.240 指纹稳定性(防假红)', () => {
  const v: Violation = {
    contractId: 'c1', file: 'lib/x.ts', line: 10, snippet: 'const r = await fetch(url, {});',
    rule: 'r', entry: 'e', incident: 'i',
  };

  it('行号变化不改变指纹 —— 上面插一行注释不该让老债变新违规', () => {
    expect(fingerprint({ ...v, line: 999 })).toBe(fingerprint(v));
  });

  it('空白/尾逗号差异不改变指纹(格式化不该触发假红)', () => {
    expect(fingerprint({ ...v, snippet: 'const   r =  await fetch(url, {})' })).toBe(fingerprint(v));
  });

  it('换了文件或换了代码内容,指纹必须变(否则新违规会被老债掩护)', () => {
    expect(fingerprint({ ...v, file: 'lib/y.ts' })).not.toBe(fingerprint(v));
    expect(fingerprint({ ...v, snippet: 'const r = await fetch(evil, {});' })).not.toBe(fingerprint(v));
  });

  it('normalizeSnippet 压空白但不改语义', () => {
    expect(normalizeSnippet('  a   b ,')).toBe('a b');
  });
});

describe('v12.240 基线分区:只拦新增', () => {
  /**
   * v12.421:此前这两条各自跑一遍 `runConsumerGate(ROOT)` —— 那是**全仓扫描**,
   * 本机高负载下单次就要几十秒,于是两条都撞上 vitest 默认的 5s 超时,
   * 报出来是「Test timed out」。而门禁 CLI 本身是通过的(0 违规)——
   * 也就是说这红灯与代码无关,纯粹是测试自己太慢。
   *
   * 那不是「负载抖动,重跑就好」:扫描本来就贵,而这里白扫了两遍。
   * 提到 beforeAll 只扫一次,并给足超时 —— 一条会因为机器忙就红的测试,
   * 迟早会被人当成噪音忽略,而它守的是「有人绕过唯一入口」这种真问题。
   */
  let scanned: ReturnType<typeof runConsumerGate>;
  beforeAll(() => { scanned = runConsumerGate(ROOT); }, 180_000);

  it('当前仓库没有「新增违规」—— 否则说明有人绕过唯一入口且没登记', () => {
    const { fresh } = partition(ROOT, scanned);
    const detail = fresh.map((f) => `${f.contractId} @ ${f.file}:${f.line} ${f.snippet}`).join('\n');
    expect(fresh, `新增违规:\n${detail}`).toEqual([]);
  });

  it('基线里的条目都还能对上(还清的债应及时移除)', () => {
    const { stale } = partition(ROOT, scanned);
    // 只提示不失败:清理债的过程中会短暂出现 stale,不该因此阻断
    if (stale.length) console.warn(`[gate] 基线有 ${stale.length} 条已还清,建议 --update 收敛`);
    expect(Array.isArray(stale)).toBe(true);
  });

  it('基线文件带 _readme,防止被误读成「批准的写法白名单」', () => {
    const base = loadBaseline(ROOT);
    expect(base._readme.length).toBeGreaterThan(0);
    expect(base._readme.join(' ')).toContain('不是被批准的写法白名单');
  });
});

describe('v12.240 契约表自身的质量约束', () => {
  it('每条契约都必须写明对应的真实事故(没事故就不该有契约)', () => {
    for (const c of CONTRACTS) {
      expect(c.incident.length, `${c.id} 缺少事故记录`).toBeGreaterThan(20);
      expect(c.entry.length, `${c.id} 没说清应该走哪个唯一入口`).toBeGreaterThan(4);
    }
  });

  it('白名单每条都必须有理由 —— 无理由的白名单会让门禁腐化', () => {
    for (const c of CONTRACTS) {
      for (const a of c.allow) {
        expect(a.why?.trim().length, `${c.id} 的白名单 ${a.file} 缺理由`).toBeGreaterThan(7);
      }
    }
  });

  it('契约 id 唯一', () => {
    const ids = CONTRACTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('如实登记静态查不到的盲区,不假装门禁全覆盖', () => {
    expect(RUNTIME_ONLY_GAPS.length).toBeGreaterThanOrEqual(3);
    for (const g of RUNTIME_ONLY_GAPS) {
      expect(g.guardedBy.length, `${g.gap} 没说清由谁来守`).toBeGreaterThan(10);
    }
  });

  it('危险 env 开关清单里的文件都真实存在(清单不能烂掉)', () => {
    for (const sw of DANGEROUS_ENV_SWITCHES) {
      expect(fs.existsSync(path.join(ROOT, sw.file)), `${sw.file} 不存在`).toBe(true);
    }
  });
});

describe('v12.240 门禁已接入 CI 与 npm script', () => {
  it('CI 里有门禁步骤', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci.includes('consumer-gate.mjs')).toBe(true);
  });

  it('package.json 暴露 gate:consumer', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts['gate:consumer']).toContain('consumer-gate.mjs');
  });

  it('基线文件已提交(否则 CI 上每条存量债都会变成新增违规)', () => {
    expect(fs.existsSync(path.join(ROOT, BASELINE_PATH))).toBe(true);
  });
});

describe('v12.241 存量债已清零', () => {
  it('baseline 为空 —— 门禁进入零容忍状态,任何绕过都会当场变红', () => {
    const base = loadBaseline(ROOT);
    const n = Object.keys(base.entries).length;
    expect(n, `基线还剩 ${n} 条债:${Object.values(base.entries).slice(0, 5).join(' | ')}`).toBe(0);
  });

  it('serve-file ?path= 的解析方全部走验签(v12.237 CRITICAL 的同源点已清完)', () => {
    // v12.237 只修了 persistAsset / serveFileToLocalPath 两条;
    // v12.241 把其余 11 处(bgm/cameo-vision/character-traits/editor-score/last-frame/
    // bg-removal/create-pipeline/hybrid-orchestrator/export/export-platform/publish-preflight)一并改造。
    const files = [
      'lib/bgm-multi-act.ts', 'lib/cameo-vision.ts', 'lib/character-traits.ts',
      'lib/editor-score.ts', 'lib/last-frame-extractor.ts', 'lib/image-tools/bg-removal.ts',
      'lib/create-pipeline.ts', 'services/hybrid-orchestrator.ts',
      'app/api/projects/[id]/export/route.ts',
      'app/api/projects/[id]/export-platform/route.ts',
      'app/api/projects/[id]/publish-preflight/route.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(src.includes('resolveVerifiedServeFilePath'), `${rel} 未走验签解析`).toBe(true);
    }
  });

  it('拉取外部媒体的出站已走 safeFetch', () => {
    const files = [
      'lib/lipsync-providers/local-2d.ts', 'lib/publish-adapters/douyin.ts',
      'lib/publish-adapters/youtube.ts', 'lib/editor-score.ts', 'lib/last-frame-extractor.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(src.includes('safeFetch('), `${rel} 未走 safeFetch`).toBe(true);
    }
  });

  it('sentinel 契约只作用于写 handler(只读 GET 用哨兵查空是安全默认)', () => {
    const c = CONTRACTS.find((x) => x.id === 'sentinel-must-not-pass-writes');
    expect(c?.handlerScope).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
  });
});
