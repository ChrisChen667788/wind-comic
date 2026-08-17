/**
 * v12.290 — 变更日志的**提交溯源列**修复:247/498 条哈希在历史中根本不存在。
 *
 * 病根是**结构性**的:一个提交不可能包含自己的哈希。
 * 而发版约定是「先 commit → 把短哈希 sed 进 VERSIONS.md → `git commit --amend`」——
 * amend 会生成**新的**提交对象,于是记进表里的永远是那个**被丢弃的、游离的**旧哈希。
 *
 * 在我本机因为有 reflog,`git show <hash>` 还查得到,所以这个错**一直没被发现**;
 * 换台机器 / 新 clone 一律 `unknown revision` —— 近半数溯源记录名存实亡。
 *
 * 这条测试是**门禁**:表里每个哈希都必须在当前历史中可达。
 * 浅克隆(CI 默认 fetch-depth:1)拿不到历史 → 自动跳过,不误报。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { normVersion, versionsFromSubject } from '../scripts/sync-version-hashes.mjs';

const VERSIONS = fs.readFileSync('VERSIONS.md', 'utf-8');
/** | **v12.289.0** | 2026-08-08 | `effc88d` | ... */
const ROW_RE = /^\| \*\*v([0-9][0-9.]*)\*\* \| ([0-9-]+) \| `([a-f0-9]{6,}|待填)`/gm;
const rows = [...VERSIONS.matchAll(ROW_RE)].map(([, version, date, hash]) => ({ version, date, hash }));

const shallow = (() => {
  try { return execSync('git rev-parse --is-shallow-repository', { encoding: 'utf-8' }).trim() === 'true'; }
  catch { return true; }
})();

/**
 * 一次 git log 把整段历史读进内存 —— 逐行 spawn `git merge-base` 会开近千个子进程(实测跑到超时)。
 * fullHash → subject,外加「短哈希前缀 → 全哈希」索引。
 */
const history: Array<{ hash: string; subject: string }> = shallow ? [] : (() => {
  const raw = execSync('git log --format=%H%x09%s HEAD', { encoding: 'utf-8', maxBuffer: 1 << 28 });
  return raw.split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf('\t');
    return { hash: line.slice(0, i), subject: line.slice(i + 1) };
  });
})();

/** 记录的短哈希 → 历史中的那条提交;找不到即「不可达」 */
function lookup(short: string) {
  return history.find((c) => c.hash.startsWith(short));
}

describe('v12.290 · 版本号解析(区间写法是当初漏网的那 4 条)', () => {
  it('三种真实存在过的提交信息写法都认得', () => {
    expect(versionsFromSubject('v12.289: 成片实际转场回写 timeline')).toEqual(['12.289.0']);
    expect(versionsFromSubject('v12.288.0 出片链路音色按角色定')).toEqual(['12.288.0']);
    // 两版并作一次提交发的 —— 旧正则要求版本号后跟 `:` 或空格,`-` 没覆盖到,这 4 行始终修不上
    expect(versionsFromSubject('v12.179-180 — Batch C①② 口型语种诚实降级')).toEqual(['12.179.0', '12.180.0']);
    expect(versionsFromSubject('v12.164-165 — 遗留双修')).toEqual(['12.164.0', '12.165.0']);
    // 并列写法,且标题正文里**还有一个 `+`** —— 解析只能吃开头那段
    expect(versionsFromSubject('v9.4.3 + v9.4.4 · 可灵能力融合 — 多参 Elements + 一键成片闭环'))
      .toEqual(['9.4.3', '9.4.4']);
  });

  it('非版本提交不误认', () => {
    for (const s of ['docs: 徽章 3035→3040 + intro 重生(v12.216)', 'fix: 修个 bug', 'chore(deps): bump', '', 'version 1.2.3']) {
      expect(versionsFromSubject(s)).toEqual([]);
    }
  });

  it('区间不炸:倒序 / 超长区间一律不认(防把 v12.1-999 展开出 999 条)', () => {
    expect(versionsFromSubject('v12.180-179 — 倒着写')).toEqual([]);
    expect(versionsFromSubject('v12.1-999 — 荒谬区间')).toEqual([]);
  });

  it('版本号规范化成三段', () => {
    expect(normVersion('12.289')).toBe('12.289.0');
    expect(normVersion('12.289.0')).toBe('12.289.0');
    expect(normVersion('2.12.0')).toBe('2.12.0');
  });
});

describe('v12.290 · VERSIONS.md 溯源列门禁', () => {
  it('表里有足够多的版本行(正则没写死/没被改坏)', () => {
    expect(rows.length).toBeGreaterThan(400);
  });

  it.skipIf(shallow)('**每个记录的哈希都必须在当前历史中可达**(修复前 247 条不可达)', () => {
    const dangling: string[] = [];
    for (const r of rows) {
      if (r.hash === '待填') continue; // 新版发布当次留空,下版回填
      if (!lookup(r.hash)) dangling.push(`v${r.version} → ${r.hash}`);
    }
    expect(dangling, `游离哈希(换台机器就查不到):\n  ${dangling.slice(0, 15).join('\n  ')}`).toEqual([]);
  });

  it.skipIf(shallow)('哈希与提交信息里的版本号自洽(不是随便填一个可达的哈希)', () => {
    const mismatched: string[] = [];
    for (const r of rows) {
      if (r.hash === '待填') continue;
      const subject = lookup(r.hash)?.subject;
      if (!subject) continue;
      const claimed = versionsFromSubject(subject);
      if (claimed.length === 0) continue; // 早期提交无版本前缀 —— 无从校验,不苛求
      if (!claimed.includes(normVersion(r.version))) mismatched.push(`v${r.version} → ${r.hash} 实为「${subject.slice(0, 40)}」`);
    }
    expect(mismatched, `哈希指向了别的版本:\n  ${mismatched.slice(0, 10).join('\n  ')}`).toEqual([]);
  });

  it('最新版那行要么已回填真哈希、要么明确写着待填(不能是别的占位)', () => {
    const latest = rows[0];
    expect(latest.hash === '待填' || /^[a-f0-9]{6,}$/.test(latest.hash)).toBe(true);
  });

  it('文件头写明了 commit 列的语义与回填流程(防后人再走 amend 老路)', () => {
    const head = VERSIONS.slice(0, 2000);
    expect(head).toContain('sync-version-hashes');
    expect(head).toMatch(/amend/);
    expect(head).toContain('待填');
  });
});

describe('v12.290 · 修复脚本本身', () => {
  it('提供了修复与只读核对两个入口', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['sync-version-hashes']).toBeTruthy();
    expect(pkg.scripts['check:version-hashes']).toContain('--check');
  });

  // v12.333 改写:原断言逐字比对**正则源码字符串**(要求它含 `[0-9-]+`),于是把日期段收紧成
  // `[0-9]{4}-[0-9]{2}-[0-9]{2}`(严格更好)也会判红 —— 锁的是写法而不是行为。
  // 现在按行为锁它真正要保证的那件事:**只动表格行的哈希格,不误伤正文里的反引号短串**。
  it('只改哈希列 —— 正文里的反引号短串不受影响', () => {
    const table = [
      '| 版本 | 日期 | commit | 说明 |', '| --- | --- | --- | --- |',
      // 错误哈希须是合法十六进制,否则 ROW_RE 根本不匹配、这条用例等于没测(第一版就踩了)
      '| **v12.288.0** | 2026-08-09 | `ffffff` | 改了 `bbbbbb` 这个函数,另见 `cccccc` |',
    ].join('\n');
    const r = auditVersionRows(table, new Map([['12.288.0', 'aaaaaa']]), '12.999.0');
    expect(r.out).toContain('| `aaaaaa` |');           // 哈希格被修正
    expect(r.out).not.toContain('ffffff');             // 原错误哈希已消失
    expect(r.out).toContain('改了 `bbbbbb` 这个函数');  // 正文原样
    expect(r.out).toContain('另见 `cccccc`');           // 正文里的另一个短串也没被动
    expect(r.fixed).toBe(1);
  });

  it('日期段仍在锚里(缺了它会误伤正文的反引号短串)', () => {
    const src = fs.readFileSync('scripts/sync-version-hashes.mjs', 'utf-8');
    const m = src.match(/const ROW_RE = (.+)/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('\\*\\*v');
    expect(m![1], '日期段必须参与锚定').toMatch(/\[0-9\]\{4\}|\[0-9-\]\+/);
  });

  it.skipIf(shallow)('--check 真跑一遍:计数覆盖全部行,且「本版待填」与「无法解析」分开报', () => {
    const out = execSync('node scripts/sync-version-hashes.mjs --check', { encoding: 'utf-8' });
    // 发版当次本版行是 `待填`(其提交尚未存在),不能被算进「无法解析」里含糊过去
    expect(out).toContain('本版待填');
    expect(out).toContain('无法解析');
    const m = out.match(/核对 (\d+) 行:.*正确 (\d+).*错误 (\d+).*可回填 (\d+).*本版待填 (\d+).*无法解析 (\d+)/);
    expect(m, `输出格式变了:${out}`).toBeTruthy();
    const [total, ok, bad, fill, pend, unres] = m!.slice(1).map(Number);
    expect(ok + bad + fill + pend + unres, '分桶必须刚好覆盖总数').toBe(total);
    expect(total, '与文件里的版本行数对得上').toBe(rows.length);
    expect(bad, '不该有错误哈希(有就说明门禁没跑)').toBe(0);
  });

  it('浅克隆下跳过而不是误报', () => {
    const src = fs.readFileSync('scripts/sync-version-hashes.mjs', 'utf-8');
    expect(src).toContain('is-shallow-repository');
    const i = src.indexOf('if (isShallow())'); // 锚到**调用点**,不是函数定义
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 300)).toContain('process.exit(0)');
  });
});

// ═══════════════════════════════════════════════════════════════
// v12.290 复核补强 —— 对抗式复核指出:上面三条实质断言全带 skipIf(shallow),
// 而 CI 的 actions/checkout 默认浅克隆 → 它们在 CI 里**一条都没跑**,
// 剩下能跑的全是格式断言,「门禁」名存实亡。而且 check:version-hashes
// 当时**没有任何消费方**(CI 与 release.sh 都没调它)—— 又是「护栏造好没接线」。
// 两处都已修:CI 加 fetch-depth: 0 + 新增 version-hashes 步骤;
// 判定逻辑抽成纯函数,下面这些测试不依赖 git、不依赖克隆深度,CI 里跑的是真行为。
// ═══════════════════════════════════════════════════════════════
import { auditVersionRows, buildVersionMapFromLog } from '../scripts/sync-version-hashes.mjs';

const CI_YML = fs.readFileSync('.github/workflows/ci.yml', 'utf-8');

/** 造一张最小 VERSIONS 表 */
const mkTable = (rows: Array<[string, string]>) =>
  ['| 版本 | 日期 | commit | 说明 |', '| --- | --- | --- | --- |',
    ...rows.map(([v, h]) => `| **v${v}** | 2026-08-09 | \`${h}\` | 某某改动 |`)].join('\n');

describe('v12.290 复核补强 · 待填的三种状态必须被分开对待', () => {
  const map = new Map([['12.288.0', 'aaaaaa'], ['12.289.0', 'bbbbbb']]);

  it('本版待填 = 正常(它的提交此刻还不存在,下版回填)', () => {
    const r = auditVersionRows(mkTable([['12.290', '待填']]), map, '12.290.0');
    expect(r.pending).toBe(1);
    expect(r.stale).toHaveLength(0);
    expect(r.fixed + r.filled).toBe(0);
  });

  it('**非本版待填、历史里也找不到 → 拦**(修复前被归进 pending 后静默 exit 0)', () => {
    const r = auditVersionRows(mkTable([['12.290', '待填'], ['12.291', '待填']]), map, '12.291.0');
    expect(r.pending, 'v12.291 是本版').toBe(1);
    expect(r.stale, 'v12.290 漏回填,必须报出来').toHaveLength(1);
    expect(r.stale[0]).toContain('12.290');
  });

  it('非本版待填、历史里找得到 → 既回填也计为待修(说明发版漏跑了脚本)', () => {
    const r = auditVersionRows(mkTable([['12.289', '待填']]), map, '12.290.0');
    expect(r.filled).toBe(1);
    expect(r.stale).toHaveLength(1);
    expect(r.out).toContain('`bbbbbb`');
  });

  it('提交信息格式不合(v 不在开头)→ 该版永远解析不出 → 下一版发版时被拦住', () => {
    // 复现复核给的失败场景:`feat: v12.291 …` 认不出版本号
    const m2 = buildVersionMapFromLog("cccccc\tfeat: v12.291 new EDL export");
    expect(m2.has('12.291.0'), 'v 不在开头,认不出 —— 这是既有行为').toBe(false);
    const r = auditVersionRows(mkTable([['12.291', '待填']]), m2, '12.292.0');
    expect(r.stale, '认不出 + 非本版 → 必须拦,不能静默通过').toHaveLength(1);
  });
});

describe('v12.290 复核补强 · 回填只动哈希列', () => {
  const map = new Map([['12.289.0', 'bbbbbb']]);

  it('哈希错 → 改正,且日期与说明一字不动', () => {
    const src = mkTable([['12.289', 'deadbe']]);
    const r = auditVersionRows(src, map, '12.290.0');
    expect(r.fixed).toBe(1);
    expect(r.out).toContain('`bbbbbb`');
    expect(r.out).toContain('| 2026-08-09 |');
    expect(r.out).toContain('某某改动');
    // 除哈希外逐字符相同
    expect(r.out.replace('bbbbbb', 'deadbe')).toBe(src);
  });

  it('哈希已对 → 一个字节都不改(幂等)', () => {
    const src = mkTable([['12.289', 'bbbbbb']]);
    const r = auditVersionRows(src, map, '12.290.0');
    expect(r.alreadyOk).toBe(1);
    expect(r.out).toBe(src);
  });

  it('短哈希与长哈希互为前缀时算相符,不来回改写', () => {
    const long = new Map([['12.289.0', 'bbbbbbccc']]);
    const r = auditVersionRows(mkTable([['12.289', 'bbbbbb']]), long, '12.290.0');
    expect(r.alreadyOk).toBe(1);
  });

  it('正文里长得像表格行的内容不会被误伤(正则锚定四列结构)', () => {
    const src = '正文提到 | **v12.1** | 之类的片段,以及 `abc123` 这样的哈希。\n';
    const r = auditVersionRows(src, new Map([['12.1.0', 'zzzzzz']]), '12.290.0');
    expect(r.out).toBe(src);
    expect(r.fixed + r.filled).toBe(0);
  });
});

describe('v12.290 复核补强 · 同版本多次提交取最早那次', () => {
  it('git log 倒序下,留下的是发版提交而非后续 hotfix', () => {
    // git log 是新→旧
    const raw = ['hotfix\tv12.290: 补个文档', 'relcom\tv12.290: 变更日志溯源'].join('\n');
    expect(buildVersionMapFromLog(raw).get('12.290.0')).toBe('relcom');
  });

  it('区间与并列写法都能展开(真实提交里的两种写法)', () => {
    const m = buildVersionMapFromLog('abc123\tv12.179-180 — Batch C①② 口型语种诚实降级');
    expect(m.get('12.179.0')).toBe('abc123');
    expect(m.get('12.180.0')).toBe('abc123');
    const m2 = buildVersionMapFromLog('def456\tv9.4.3 + v9.4.4 · 可灵能力融合');
    expect(m2.get('9.4.3')).toBe('def456');
    expect(m2.get('9.4.4')).toBe('def456');
  });
});

describe('v12.290 复核补强 · 门禁真的接上了消费方', () => {
  it('CI 里有 version-hashes 步骤(此前脚本零消费方 —— 又是「护栏造好没接线」)', () => {
    expect(CI_YML).toContain('npm run check:version-hashes');
  });

  it('跑该步骤的 job 必须拉全量历史,否则 isShallow() 直接跳过 = 白装', () => {
    const i = CI_YML.indexOf('npm run check:version-hashes');
    expect(i).toBeGreaterThan(0);
    // 该步骤所在 job 的 checkout 必须带 fetch-depth: 0
    const jobStart = CI_YML.lastIndexOf('    steps:', i);
    expect(CI_YML.slice(jobStart, i)).toMatch(/checkout@v\d+\s*\n\s*with:\s*\n\s*fetch-depth:\s*0/);
  });

  it('跑 vitest 的 job 也要全量历史,否则 skipIf(shallow) 那几条永远跳过', () => {
    const i = CI_YML.indexOf('Setup Node.js');
    const jobStart = CI_YML.lastIndexOf('    steps:', i);
    expect(CI_YML.slice(jobStart, i)).toMatch(/fetch-depth:\s*0/);
  });
});
