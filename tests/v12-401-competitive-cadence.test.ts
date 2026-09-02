/**
 * v12.401 — 「每 2 周一次竞品分析」这个承诺,靠什么保证?
 *
 * ── 第一版做错了什么 ──────────────────────────────────────────────────
 * 我先写了 `competitive-scan.mjs`(到期检查)+ 一个每周一跑它的 launchd 任务,
 * 然后就认为「自动化已设置」。但那一版有两处让它**名存实亡**:
 *
 * ① **告警通向不了人**:launchd 把输出重定向进 `~/Library/Logs/wind-comic-competitive.log`,
 *    超期时 `exit 1` 落进那个文件 —— 而**那个日志没有人会去打开**。
 *    一道通向不了人的告警,和没有告警是一回事。这就是本项目一直在消灭的假绿:
 *    机制存在、能跑、退出码也对,唯独**没有任何一条路径把结论送到人眼前**。
 *
 * ② **不超期也发东西**:那一版无条件生成 `TASK-<日期>.md`,每周一都往工作区掉一个。
 *    每周都出现的东西第三周就成了噪音,到真超期那次反而没人看 ——
 *    **一个总在响的告警等于没有告警**,和「一个会误报的门禁只会训练人忽略门禁」是同一条。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 不锁写法,锁**行为**:超期必须红、未超期必须静默、读不到台账必须失败而不是放行,
 * 以及 —— 最要紧的 —— **定时任务的实际命令里必须带上那条通向人的路径**。
 * 前三条锁脚本,第四条锁「脚本和调用它的定时任务没有脱节」。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCAN = path.resolve('scripts/competitive-scan.mjs');
const INSTALLER = path.resolve('scripts/install-competitive-schedule.sh');

/** 造一个只含 claims.json 的临时仓库,lastReviewedOn 设在 `daysAgo` 天前 */
function fixture(daysAgo: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-scan-'));
  fs.mkdirSync(path.join(dir, 'docs/competitive'), { recursive: true });
  const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(dir, 'docs/competitive/claims.json'),
    JSON.stringify({
      lastReviewedOn: d,
      claims: [
        { id: 'C-alpha', statement: '断言甲', kind: '护城河边界', assertedOn: d, falsifyBy: '出现反例' },
        { id: 'C-beta', statement: '断言乙', kind: '能力代差', assertedOn: d, falsifyBy: '数值被推翻' },
      ],
      watchlist: [{ area: '视频模型', targets: ['Veo', 'Kling'] }],
    }),
  );
  return dir;
}

/** 在临时仓库里跑脚本,返回退出码与合并输出(脚本靠 cwd 定位 claims.json) */
function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCAN, ...args], { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('v12.401 竞品分析节奏保障', () => {
  it('超期时 --check 必须以非零码退出(否则定时任务永远发现不了超期)', () => {
    const dir = fixture(20); // 约定 14 天,已超 6 天
    try {
      const { code, out } = run(dir, ['--check']);
      expect(out, '窗口自证:输出里得能看到它确实算出了天数').toContain('20 天前');
      expect(code, '超期却退出 0 —— 那这道检查就是摆设').toBe(1);
      expect(out).toContain('已超期');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('未超期时 --check 退出 0', () => {
    const dir = fixture(3);
    try {
      const { code, out } = run(dir, ['--check']);
      expect(out).toContain('3 天前');
      expect(code).toBe(0);
      expect(out).toContain('未超期');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--if-due 在未超期时不落任何文件 —— 每周都出现的告警会变成噪音', () => {
    const dir = fixture(3);
    try {
      const { code } = run(dir, ['--if-due']);
      expect(code).toBe(0);
      const files = fs.readdirSync(path.join(dir, 'docs/competitive'));
      // 窗口自证:先确认这个目录本来就读得到东西,再断言没有多出来的
      expect(files).toContain('claims.json');
      expect(files.filter((f) => f.startsWith('TASK-'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--if-due 在超期时生成任务书并报错退出', () => {
    const dir = fixture(30);
    try {
      const { code } = run(dir, ['--if-due']);
      expect(code).toBe(1);
      const tasks = fs.readdirSync(path.join(dir, 'docs/competitive')).filter((f) => f.startsWith('TASK-'));
      expect(tasks).toHaveLength(1);

      const book = fs.readFileSync(path.join(dir, 'docs/competitive', tasks[0]), 'utf-8');
      // 任务书必须把「执行标准」带给下一轮 —— 否则下一轮的水准会悄悄退化
      expect(book).toContain('必须联网');
      expect(book).toContain('独立二次检索复核');
      expect(book).toContain('我们用了多少');
      // 上一轮每一条结论都要被摊成待验假设,一条都不能漏
      expect(book).toContain('C-alpha');
      expect(book).toContain('C-beta');
      expect(book).toContain('出现反例');
      expect(book).toContain('数值被推翻');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('台账读不到时必须失败,而不是当作「没超期」放行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-scan-empty-'));
    try {
      expect(run(dir, ['--check']).code, '缺台账 → 静默放行,就等于永远不会超期').toBe(1);

      // 台账损坏同理:解析不出来不能变成「一切正常」
      fs.mkdirSync(path.join(dir, 'docs/competitive'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs/competitive/claims.json'), '{ 这不是 JSON');
      expect(run(dir, ['--check']).code).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('定时任务的实际命令里必须带 --notify —— 告警要通向人,不是通向日志文件', () => {
    const plist = execFileSync('bash', [INSTALLER, '--print'], { encoding: 'utf-8' });
    // 窗口自证:先确认取到的确实是那条 ProgramArguments,再看它带了什么参数
    expect(plist).toContain('competitive-scan.mjs');
    const cmd = plist.split('\n').find((l) => l.includes('competitive-scan.mjs'))!;
    expect(cmd, '第一版就是漏了它:超期只写进没人读的日志').toContain('--notify');
    expect(cmd, '漏了 --if-due 就会每周往工作区掉一个文件,很快被当噪音').toContain('--if-due');
  });

  it('两份 README 的竞品对照表必须同形 —— 同一个事实两处各写各的,迟早对不上', () => {
    // 本轮实测的漂移:中文表停在 `Seedance 2.0` 且把 Runway 原生音频标成受限,
    // 而英文表早已是 `Seedance 2.5` + `MiniMax H3` —— 两份 README 各维护一张,
    // 谁也不知道对方更新了。已合并到同一套列与行,这条负责它不再分家。
    const tableAfter = (file: string, headStart: string): string[] => {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      const i = lines.findIndex((l) => l.startsWith(headStart));
      expect(i, `${file} 里找不到以 ${headStart} 开头的表头 —— 表格改结构了就得同步这条`).toBeGreaterThan(0);
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].startsWith('|')) j++;
      return lines.slice(i, j + 1);
    };
    const competitors = (header: string) =>
      header.split('|').slice(2, -2).map((c) => c.trim());

    const en = tableAfter('README.md', '| Capability | Veo 3.1 |');
    const zh = tableAfter('README.zh-CN.md', '| 能力 | Veo 3.1 |');

    // 窗口自证:两张表都得真有内容,别在两个空数组之间比出「一致」
    expect(en.length, '英文表只有表头?').toBeGreaterThan(5);
    expect(competitors(en[0]).length, '一个竞品列都没解析出来').toBeGreaterThan(3);

    expect(zh.length, `行数不一致:英文 ${en.length} 行 / 中文 ${zh.length} 行 —— 有一边加了行没同步`)
      .toBe(en.length);
    expect(competitors(zh[0]), '竞品列头不一致 —— 一边换了模型版本另一边没跟上').toEqual(competitors(en[0]));
  });

  it('VERSIONS.md 只增不减 —— 一条版本历史被悄悄删掉,没有任何现有检查会发现', () => {
    // 这条是本版自己撞出来的:我给 v12.401 插行时把 `s[j:]` 从行尾取,
    // 于是**整条 v12.400 被覆盖掉了**。而 `sync-version-hashes` 照样报「本就正确 491 条」——
    // 它逐行核对哈希,却从不问「行数是不是少了」。差一点就把一份缺了一版的历史推上去。
    // 版本历史天然只增不减,这是能被机器判定的不变量,不该靠人眼。
    const rowsOf = (text: string) =>
      text.split('\n').map((l) => /^\| \*\*(v[\d.]+)\*\* \|/.exec(l)?.[1]).filter(Boolean) as string[];

    const head = execFileSync('git', ['show', 'HEAD:VERSIONS.md'], { encoding: 'utf-8', maxBuffer: 64 << 20 });
    const before = rowsOf(head);
    const after = rowsOf(fs.readFileSync('VERSIONS.md', 'utf-8'));

    // 窗口自证:先确认两边都真的解析出了大量行,再谈增减
    expect(before.length, 'HEAD 里一行都没解析出来?那正则和表格格式对不上了').toBeGreaterThan(100);
    expect(after.length).toBeGreaterThan(100);

    const lost = before.filter((v) => !after.includes(v));
    expect(lost, `这些版本行在工作区里消失了:${lost.join(', ')}`).toEqual([]);
  });

  it('历史轮次的分析都必须指向最新一轮 —— 指路牌不能随新一轮的到来而失效', () => {
    // 加过期标记本身是对的,但它埋了下一轮的雷:再出一份新分析,
    // 这些牌子全指错,而没有人会记得回来改。把「记得改」变成「不改就红」。
    const rounds = fs.readdirSync('docs')
      .filter((f) => /^COMPETITIVE-GAP-.+\.md$/.test(f))
      .sort(); // 文件名带年月,字典序即时间序
    expect(rounds.length, '一份都没有?那这条测试在锁空气').toBeGreaterThanOrEqual(2);

    const latest = rounds[rounds.length - 1];
    const historical = [...rounds.slice(0, -1), 'competitive-analysis-and-upgrade-plan.md'];

    for (const f of historical) {
      const body = fs.readFileSync(path.join('docs', f), 'utf-8');
      // 窗口自证:先确认读到的确实是份分析文档,再断言它带了指向最新轮的牌子
      expect(body, `${f} 读出来是空的?`).toContain('#');
      expect(body, `${f} 没指向最新一轮 ${latest} —— 直接点进去的人会把旧数字当现状`)
        .toContain(latest);
    }

    // 最新一轮不该指向自己
    expect(fs.readFileSync(path.join('docs', latest), 'utf-8'))
      .not.toContain('这是一份历史轮次的分析');
  });

  it('脚本真的实现了 --notify(不是 plist 单方面传了个没人认的参数)', () => {
    const src = fs.readFileSync(SCAN, 'utf-8').split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(src).toContain("process.argv.includes('--notify')");
    expect(src).toContain("process.argv.includes('--if-due')");
    // 通知走 osascript;失败不能反过来让检查本身挂掉
    expect(src).toContain('osascript');
  });
});
