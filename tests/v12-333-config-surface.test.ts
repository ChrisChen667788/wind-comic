/**
 * v12.333 — 配置面防呆:key 与 host 必须成对 + 每个配置项都得有记录。
 *
 * ── 为什么这一版是「配置」而不是功能 ────────────────────────────────
 * 排查 MiniMax 时连踩两颗同类地雷:
 *   ① 我的探测脚本少拼了 `/v1` → 404 → 我把「路径拼错」误判成「端点不存在」;
 *   ② `lib/shot-quality-gate.ts` 把 MiniMax 地址**硬编码**成官方 host,
 *      于是 `MINIMAX_BASE_URL` 指向聚合网关的人,视觉兜底会拿网关 key 去敲官方门。
 * 两颗都属于同一类:**key 与 host 走散了**,而报错(404/401)永远指不到真因。
 *
 * HappyHorse 是这类问题最严重的一处 —— key 可来自两个变量、host 可来自两个变量、
 * 路径前缀还随 host 变,而 `.env.example` 里**一个 HAPPYHORSE_ 变量都没有**。
 * 也就是说:买了百炼直连 key 的人不知道该填哪儿;填对了 key 却没填 host,
 * 请求会带着百炼的 key 去打网关的地址加网关的前缀 —— 必然失败。
 *
 * ── 为什么加通用门禁 ──────────────────────────────────────────────
 * `tests/v12-171-security.test.ts` 里那条「.env.example 覆盖关键新 env」是**6 个变量的
 * 硬编码白名单** —— 它结构上不可能抓到新增的未记录变量,所以 HAPPYHORSE_* 漏了 61 个版本
 * 都没人红。门禁得按**规则**扫,不能按名单扫。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeBaseURL } from '@/lib/base-url';
import { resolveVisionFallbacks } from '@/lib/shot-quality-gate';
import {
  happyHorseChannel,
  hasHappyHorse,
  HAPPYHORSE_DIRECT_BASE,
} from '@/services/happyhorse.service';

describe('v12.333 · normalizeBaseURL:剪版本段必须是显式开关', () => {
  it('默认只剪尾斜杠,**不**碰版本段(OpenRouter 这类 base 自带 /v1,剪了就全坏)', () => {
    expect(normalizeBaseURL('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
    expect(normalizeBaseURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('开了 stripApiVersion 才剪 —— 给「调用点自己拼 /v1」的供应商用', () => {
    expect(normalizeBaseURL('https://api.minimaxi.com/v1', { stripApiVersion: true })).toBe('https://api.minimaxi.com');
    expect(normalizeBaseURL('https://api.minimaxi.com/v1/', { stripApiVersion: true })).toBe('https://api.minimaxi.com');
    expect(normalizeBaseURL('https://api.minimaxi.com//', { stripApiVersion: true })).toBe('https://api.minimaxi.com');
  });

  it('只剪**末尾**的版本段,不动路径中间的(网关常把版本放在中段)', () => {
    expect(normalizeBaseURL('https://gw.example.com/v1/minimax', { stripApiVersion: true }))
      .toBe('https://gw.example.com/v1/minimax');
  });

  it('空输入返回空串(缺省值由调用方在传入前决定,不在这里替它猜)', () => {
    expect(normalizeBaseURL(undefined)).toBe('');
    expect(normalizeBaseURL('  ')).toBe('');
  });
});

describe('v12.333 · MiniMax:base 带 /v1 不再导致全线 /v1/v1', () => {
  const orig = process.env.MINIMAX_BASE_URL;
  afterEach(() => {
    if (orig === undefined) delete process.env.MINIMAX_BASE_URL;
    else process.env.MINIMAX_BASE_URL = orig;
    vi.resetModules();
  });

  it('lib/config.ts 归一化了 MINIMAX_BASE_URL', async () => {
    process.env.MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1/';
    vi.resetModules();
    const { API_CONFIG } = await import('@/lib/config');
    expect(API_CONFIG.minimax.baseURL).toBe('https://api.minimaxi.com');
  });

  it('视觉兜底跟着 MINIMAX_BASE_URL 走,不再硬编码官方 host', () => {
    const gw = resolveVisionFallbacks({ MINIMAX_API_KEY: 'sk-x', MINIMAX_BASE_URL: 'https://api.gw.example/v1' } as any);
    expect(gw.map((f) => f.baseURL)).toContain('https://api.gw.example/v1');
  });

  it('没配 MINIMAX_BASE_URL 时仍是官方 host(零回归)', () => {
    const def = resolveVisionFallbacks({ MINIMAX_API_KEY: 'sk-x' } as any);
    expect(def.map((f) => f.baseURL)).toContain('https://api.minimaxi.com/v1');
  });
});

describe('v12.333 · HappyHorse 两条通道', () => {
  const KEYS = ['HAPPYHORSE_API_KEY', 'HAPPYHORSE_BASE_URL', 'VECTORENGINE_API_KEY', 'VECTORENGINE_BASE_URL', 'HAPPYHORSE_DISABLE'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } vi.resetModules(); });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
    vi.restoreAllMocks();
  });

  it('没 key → none,引擎链跳过', () => {
    expect(happyHorseChannel({}).channel).toBe('none');
    expect(hasHappyHorse({})).toBe(false);
  });

  it('只有 VECTORENGINE_API_KEY → gateway,带 /alibailian 前缀(零回归)', () => {
    const ch = happyHorseChannel({ VECTORENGINE_API_KEY: 'sk-real' });
    expect(ch.channel).toBe('gateway');
    expect(ch.baseURL).toBe('https://api.vectorengine.ai');
    expect(ch.pathPrefix).toBe('/alibailian');
    expect(ch.keyVar).toBe('VECTORENGINE_API_KEY');
  });

  it('百炼直连(key + host 成对)→ direct,**无**网关前缀', () => {
    const ch = happyHorseChannel({ HAPPYHORSE_API_KEY: 'sk-bailian', HAPPYHORSE_BASE_URL: HAPPYHORSE_DIRECT_BASE });
    expect(ch.channel).toBe('direct');
    expect(ch.pathPrefix).toBe('');
    expect(ch.warning).toBeUndefined();
  });

  it('**前缀由 host 决定,不由 key 放在哪个变量决定** —— 否则同一 host 换个变量名就走到不存在的路径', () => {
    const viaHH = happyHorseChannel({ HAPPYHORSE_API_KEY: 'k', HAPPYHORSE_BASE_URL: 'https://api.vectorengine.ai' });
    const viaVE = happyHorseChannel({ VECTORENGINE_API_KEY: 'k', VECTORENGINE_BASE_URL: 'https://api.vectorengine.ai' });
    expect(viaHH.pathPrefix).toBe(viaVE.pathPrefix);
    expect(viaHH.pathPrefix).toBe('/alibailian');
  });

  it('只配 key 不配 host → 行为不变(仍打继承来的 host)但**必须把这份含糊说出来**', () => {
    const ch = happyHorseChannel({ HAPPYHORSE_API_KEY: 'sk-bailian' });
    expect(ch.baseURL).toBe('https://api.vectorengine.ai'); // 与 v12.332 一致,不偷偷改行为
    expect(ch.warning, '静默继承别家 host 是本版要消灭的那类问题').toMatch(/HAPPYHORSE_BASE_URL/);
    expect(ch.warning).toContain(HAPPYHORSE_DIRECT_BASE);
  });

  it('占位符 key 不算已配(此前 isAvailable 说不可用、submitTask 却照发 your_xxx)', () => {
    expect(happyHorseChannel({ HAPPYHORSE_API_KEY: 'your_key_here' }).channel).toBe('none');
    expect(happyHorseChannel({ VECTORENGINE_API_KEY: 'your_key_here' }).channel).toBe('none');
  });

  it('HAPPYHORSE_DISABLE=1 仍然一刀切关掉(零回归)', () => {
    expect(hasHappyHorse({ VECTORENGINE_API_KEY: 'sk-real', HAPPYHORSE_DISABLE: '1' })).toBe(false);
  });

  it('行为:direct 通道打的是百炼原生路径,URL 里不含 /alibailian', async () => {
    process.env.HAPPYHORSE_API_KEY = 'sk-bailian';
    process.env.HAPPYHORSE_BASE_URL = HAPPYHORSE_DIRECT_BASE;
    const calls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify({ output: { task_id: 't-9' } }) } as any;
    }) as any;
    try {
      const { HappyHorseService } = await import('@/services/happyhorse.service');
      await new HappyHorseService().submitTask('测试');
      expect(calls[0]).toBe(`${HAPPYHORSE_DIRECT_BASE}/api/v1/services/aigc/video-generation/video-synthesis`);
      expect(calls[0], '直连百炼不该带网关前缀 —— 带了就是 404').not.toContain('/alibailian');
    } finally { globalThis.fetch = origFetch; }
  });

  it('行为:占位符 key 直接拒发请求(不把 your_xxx 送出门)', async () => {
    process.env.HAPPYHORSE_API_KEY = 'your_key_here';
    const origFetch = globalThis.fetch;
    const spy = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' } as any));
    globalThis.fetch = spy as any;
    try {
      const { HappyHorseService } = await import('@/services/happyhorse.service');
      await expect(new HappyHorseService().submitTask('x')).rejects.toThrow(/未配置/);
      expect(spy).not.toHaveBeenCalled();
    } finally { globalThis.fetch = origFetch; }
  });
});

describe('v12.333 · 巡检脚本与服务同口径(重复实现必须比对,否则会漂)', () => {
  // scripts/api-health-audit.mjs 是 .mjs,读不了 TS,只能重写一遍通道判定。
  // 重复实现就得有门禁盯着 —— 这是 preflight 与 ci.yml 命令清单比对(v12.325)的同一手法。
  const AUDIT = fs.readFileSync('scripts/api-health-audit.mjs', 'utf-8');

  it('巡检覆盖 HappyHorse', () => {
    expect(AUDIT).toContain('HAPPYHORSE_API_KEY');
    expect(AUDIT).toContain('HappyHorse');
  });

  it('前缀 / 网关缺省 / 直连判据三处常量与服务一致', () => {
    const gw = happyHorseChannel({ VECTORENGINE_API_KEY: 'k' });
    expect(AUDIT).toContain(`'${gw.pathPrefix}'`);      // '/alibailian'
    expect(AUDIT).toContain(gw.baseURL);                 // https://api.vectorengine.ai
    expect(AUDIT).toMatch(/dashscope\[-\.\]/);           // 与服务同一条 direct 判据
  });

  it('探针只查任务、不建任务 —— 巡检绝不触发计费生成', () => {
    expect(AUDIT).toContain('/api/v1/tasks/');
    expect(AUDIT).not.toContain('video-synthesis');
  });

  it('「任务不存在」按措辞判、不押注状态码 —— 网关实测回 HTTP 400 + task_not_exist', () => {
    // 首版只认 404 与 /not.*found/,把完全健康的通道误报成「异常」。
    // 这里直接拿脚本里的正则来判,免得正则改窄了测试还绿。
    // 断言窗口必须按**语义**界定:文件里有两条同形状的判据(⑥ 可灵在前、⑧ HappyHorse 在后),
    // 不切窗口的话 match 取到的是可灵那条 —— 于是测的根本不是本版改的东西。
    const from = AUDIT.indexOf(`const NAME = 'HappyHorse`);
    expect(from, '找不到 HappyHorse 探针').toBeGreaterThan(0);
    const src = AUDIT.slice(from).match(/if \(r\.status === 404 \|\| (\/[^\n]+?\/i)\.test\(r\.text\)\)/);
    expect(src, '找不到 HappyHorse 的「任务不存在」判据').toBeTruthy();
    const re = new RegExp(src![1].slice(1, -2), 'i');
    expect(re.test('{"code":"task_not_exist","message":"task_not_exist"}')).toBe(true);
    expect(re.test('{"message":"Not Found"}')).toBe(true);
    expect(re.test('{"message":"invalid api key"}'), '别把鉴权失败也吞成 OK').toBe(false);
  });
});

describe('v12.333 · VERSIONS.md 日期列也纳入自动回填', () => {
  // 日期原先全靠手抄上一行 —— 于是 v12.321~332 这 12 行全写成 2026-08-12,
  // 而提交日是 2026-08-17。哈希列早就自动化了,日期列被漏在外面。
  const mk = (ver: string, date: string, hash: string) =>
    ['| 版本 | 日期 | commit | 说明 |', '| --- | --- | --- | --- |',
      `| **v${ver}** | ${date} | \`${hash}\` | 某某改动 |`].join('\n');

  it('回填哈希时顺手把日期改对', async () => {
    const { auditVersionRows } = await import('../scripts/sync-version-hashes.mjs');
    const r = auditVersionRows(
      mk('12.332.0', '2026-08-12', '待填'),
      new Map([['12.332.0', 'c254627']]),
      '12.333.0',                                   // 当前版本是下一版 → 上一版进入回填
      new Map([['12.332.0', '2026-08-17']]),
    );
    expect(r.out).toContain('2026-08-17');
    expect(r.out).toContain('c254627');
    expect(r.dateFixed).toBe(1);
  });

  it('不传 dateMap 时行为与从前一致(既有调用点不受影响)', async () => {
    const { auditVersionRows } = await import('../scripts/sync-version-hashes.mjs');
    const r = auditVersionRows(mk('12.332.0', '2026-08-12', '待填'), new Map([['12.332.0', 'c254627']]), '12.333.0');
    expect(r.out).toContain('2026-08-12'); // 日期没被动
    expect(r.dateFixed).toBe(0);
  });

  it('历史行差 >1 天:只提示,不改、不判红', async () => {
    const { auditVersionRows } = await import('../scripts/sync-version-hashes.mjs');
    const r = auditVersionRows(
      mk('12.247.0', '2026-07-24', 'abc123'),
      new Map([['12.247.0', 'abc123']]),
      '12.333.0',
      new Map([['12.247.0', '2026-07-26']]),
    );
    expect(r.out, '历史日期不该被我的猜测覆写').toContain('2026-07-24');
    expect(r.dateFixed).toBe(0);
    expect(r.dateNotes).toHaveLength(1);
  });

  it('差 1 天不算问题 —— 深夜提交跨日界属正常', async () => {
    const { auditVersionRows } = await import('../scripts/sync-version-hashes.mjs');
    const r = auditVersionRows(
      mk('12.247.0', '2026-07-25', 'abc123'),
      new Map([['12.247.0', 'abc123']]),
      '12.333.0',
      new Map([['12.247.0', '2026-07-26']]),
    );
    expect(r.dateNotes).toHaveLength(0);
  });
});

describe('v12.333 · .env.example 必须覆盖整个配置面(通用规则,不是白名单)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'tests', 'e2e', '.claude', 'coverage', 'public', 'videos', 'renders']);
  /** 扫代码里读到的 env 名 */
  function envNamesInCode(root = process.cwd()): Set<string> {
    const found = new Set<string>();
    (function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js)$/.test(ent.name) && !/\.test\./.test(ent.name)) {
          const t = fs.readFileSync(p, 'utf-8');
          for (const m of t.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1]);
          for (const m of t.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1]);
        }
      }
    })(root);
    return found;
  }

  const EXAMPLE = fs.readFileSync('.env.example', 'utf-8');
  /** 必须是**声明行**(`VAR=` 或 `# VAR=`),正文里被提到一嘴不算记录 */
  const declared = (v: string) => new RegExp(`^#?\\s*${v}=`, 'm').test(EXAMPLE);

  it('凡是 key / 端点 / 模型名类变量,一个都不许缺记录', () => {
    // 只管**配置面**:填错就静默出不了片的那些。其余上百个行为微调开关不在此门禁内 ——
    // 把 241 个 env 全逼进 .env.example 只会让它变成噪音墙,反而没人读。
    const surface = [...envNamesInCode()].filter((v) => /_(API_KEY|BASE_URL|MODEL|SECRET|TOKEN|KEY)$/.test(v));
    expect(surface.length, '扫描没扫到东西 —— 门禁本身坏了(别把 0 当通过)').toBeGreaterThan(50);
    expect(surface.filter((v) => !declared(v))).toEqual([]);
  });

  it('HappyHorse 的每个变量都有记录(它此前一个都没有,正是本版起因)', () => {
    for (const v of ['HAPPYHORSE_API_KEY', 'HAPPYHORSE_BASE_URL', 'HAPPYHORSE_MODEL', 'HAPPYHORSE_DISABLE', 'HAPPYHORSE_RESOLUTION', 'HAPPYHORSE_WATERMARK', 'HAPPYHORSE_SEED']) {
      expect(declared(v), `${v} 未在 .env.example 声明`).toBe(true);
    }
  });

  it('两条通道都写进了 .env.example,且直连地址与代码一致', () => {
    expect(EXAMPLE).toContain(HAPPYHORSE_DIRECT_BASE);
    expect(EXAMPLE).toMatch(/alibailian/);
  });

  it('没有残缺变量名 —— v12.171 那批被数字截断的名字不许回来', () => {
    // `# S=` / `# KELING_=` / `# LTX_MODEL_I=` 都是正则遇数字断掉的产物,
    // 看着像记录了、实际上任何真变量都对不上号。
    const bad = EXAMPLE.split('\n')
      .map((l) => l.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((v): v is string => !!v && (v.endsWith('_') || v.length <= 2));
    expect(bad).toEqual([]);
  });
});
