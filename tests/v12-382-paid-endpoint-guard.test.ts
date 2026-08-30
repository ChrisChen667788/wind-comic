/**
 * v12.382:五个会花 owner 钱的端点,裸 curl 就能调。
 *
 * 一次全仓安全扫描找出来的:
 *   · /api/voice-sample        无鉴权,且 body.text **毫无长度上限** ——
 *                              传 5 万字进去照样合成,按字符计费全打在 owner 账上
 *   · /api/season/narrate      无鉴权,且 episodes **无数量上限** ——
 *                              一次请求就能触发几十集 TTS,外层集级并发最高到 8
 *   · /api/polish-script       basic 模式绕过 checkPlan(它只在 pro 模式才调,
 *                              而且注释明说「未登录当 free」—— 不 401、只降级)
 *   · /api/master-prompt/refine
 *   · /api/short-video/plan
 *
 * 同类端点(narration/synthesize、cameo/preview、character-traits/from-face)
 * 早就有 guardPaidEndpoint —— 又是「主路径修了旁路没修」。
 *
 * 危害不只是钱:**没有登录态就写不下 cost-log**,事后连「谁花的、花在哪」
 * 都查不到,只剩「余额怎么没了」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const GATE = path.join(process.cwd(), 'scripts/paid-endpoint-gate.mjs');
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
/** 判「有守卫」时必须剥掉 import —— 留着 import 删掉调用,是本版门禁自己踩过的坑 */
const bodyOf = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).filter((l) => !/^\s*import\s/.test(l)).join('\n');

const FIXED = [
  'app/api/voice-sample/route.ts',
  'app/api/season/narrate/route.ts',
  'app/api/polish-script/route.ts',
  'app/api/master-prompt/refine/route.ts',
  'app/api/short-video/plan/route.ts',
];

describe('五个裸奔的付费端点都补上了守卫', () => {
  it.each(FIXED)('%s 在函数体里真的调了守卫(不是只 import)', (p) => {
    const body = bodyOf(read(p));
    expect(body).toMatch(/guardPaidEndpoint\s*\(/);
    // 守卫的返回值必须被用来提前 return,否则等于没守
    expect(body).toMatch(/if\s*\(!_paid\.ok\)/);
  });

  it('守卫在调用付费能力**之前** —— 先扣钱再鉴权等于没鉴权', () => {
    for (const p of FIXED) {
      const body = bodyOf(read(p));
      const guardAt = body.indexOf('guardPaidEndpoint(');
      const paidAt = Math.min(
        ...[/dispatchTTSGenerate/, /callLLMWithFallback/, /synthesizeNarrationTrack/]
          .map((re) => { const m = re.exec(body); return m ? m.index : Infinity; }),
      );
      expect(guardAt, `${p} 找不到守卫调用`).toBeGreaterThan(0);
      if (Number.isFinite(paidAt)) {
        expect(guardAt, `${p} 的守卫排在付费调用之后`).toBeLessThan(paidAt);
      }
    }
  });

  it('voice-sample 的试听文本有长度上限 —— 试听不需要长文本,超出只是烧钱', () => {
    const body = bodyOf(read('app/api/voice-sample/route.ts'));
    expect(body).toMatch(/slice\(0,\s*SAMPLE_TEXT_MAX\)/);
    const m = read('app/api/voice-sample/route.ts').match(/SAMPLE_TEXT_MAX\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(1000);
  });

  it('season/narrate 有集数上限 —— 没有的话一次请求就能清零当天额度', () => {
    const src = read('app/api/season/narrate/route.ts');
    const m = src.match(/MAX_EPISODES_PER_CALL\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(50);
    expect(bodyOf(src)).toMatch(/episodes\.length\s*>\s*MAX_EPISODES_PER_CALL/);
  });

  it('预算随规模走 —— 整季按集数估,不是固定值', () => {
    const body = bodyOf(read('app/api/season/narrate/route.ts'));
    const i = body.indexOf('guardPaidEndpoint(');
    expect(body.slice(i, i + 160)).toMatch(/episodes\.length/);
  });
});

describe('付费端点门禁', () => {
  function gateIn(files: Record<string, string>) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-gate-'));
    try {
      for (const [rel, b] of Object.entries(files)) {
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, b);
      }
      try {
        return { code: 0, out: execFileSync('node', [GATE], { cwd: tmp, encoding: 'utf-8' }) };
      } catch (e: any) {
        return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('当前仓库无未守卫的付费路由,且确实识别出了付费路由', () => {
    const out = execFileSync('node', [GATE], { cwd: process.cwd(), encoding: 'utf-8' });
    expect(out).toContain('付费端点门禁通过');
    const m = out.match(/识别出 (\d+) 个付费路由/);
    expect(m, '门禁必须报出识别数 —— 识别 0 个的门禁比没有门禁更危险').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(5);
  });

  it('会花钱又没守卫 → 拦', () => {
    const r = gateIn({
      'app/api/x/route.ts': "export async function POST(req) {\n  const d = await dispatchTTSGenerate({ text: 'x' });\n  return Response.json(d);\n}\n",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('app/api/x/route.ts');
  });

  it('**只 import 守卫但不调用** → 仍然拦(第一版门禁就栽在这)', () => {
    const r = gateIn({
      'app/api/x/route.ts':
        "import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';\n" +
        "export async function POST(req) {\n  const d = await dispatchTTSGenerate({ text: 'x' });\n  return Response.json(d);\n}\n",
    });
    expect(r.code, 'import 不等于守卫 —— 和 indexOf 命中 import 是同一个坑').toBe(1);
  });

  it('注释里提到付费函数不算「会花钱」', () => {
    const r = gateIn({
      'app/api/x/route.ts': "// 这里将来可能要调 dispatchTTSGenerate\nexport async function GET() { return Response.json({ ok: 1 }); }\n",
    });
    // 没有任何付费路由 → 自检会失败,但不应是「未守卫」那种失败
    expect(r.out).not.toContain('会花钱但没有鉴权');
  });

  it('有守卫 → 放行', () => {
    const r = gateIn({
      'app/api/x/route.ts':
        "export async function POST(req) {\n  const g = await guardPaidEndpoint(req, {});\n  if (!g.ok) return g.response;\n  return Response.json(await dispatchTTSGenerate({ text: 'x' }));\n}\n",
    });
    expect(r.code).toBe(0);
  });

  it('豁免要写理由,不写不放行', () => {
    const mk = (c: string) => gateIn({
      'app/api/x/route.ts': `${c}\nexport async function POST(req) {\n  return Response.json(await dispatchTTSGenerate({ text: 'x' }));\n}\n`,
    }).code;
    expect(mk('// paid-gate: ok — 本地 mock,不走外部 API')).toBe(0);
    expect(mk('// paid-gate: ok')).toBe(1);
    expect(mk('// 随便一句注释')).toBe(1);
  });
});
