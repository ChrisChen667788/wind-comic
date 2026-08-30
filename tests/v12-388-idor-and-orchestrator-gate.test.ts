/**
 * v12.388:一条只认「直接调用」的付费门禁,漏掉了最贵的那个入口。
 *
 * 两条 high,都是上一轮多智能体扫描找出来并经对抗验证的:
 *
 * ① **`vision-audit/run` 只验登录、不验归属**(IDOR)。文件抬头写的是
 *    「Auth: 登录用户」—— 说明是写码时就漏的,不是后来被删的。任意登录用户拿着
 *    别人的 projectId POST 这里,服务端就对**受害者项目**的每张分镜图调 GPT-4o
 *    Vision,并在响应里原样返回对方的画面描述、台词、情绪标注:既烧 owner 的额度,
 *    又把他的私有创作内容读走。而本文件自己的注释还写着「vision 调用**按镜烧钱**」,
 *    却连付费守卫都没有。
 *
 * ② **`/api/create` 完全没有鉴权**。裸 curl 一个 { idea } 就能在生产模式下跑通
 *    整条 AI 制片管线(脚本 LLM → 分镜出图 → 视频生成),单次至少 ¥5–30。
 *    它还是条遗留死路:前端零调用者(真入口是 /api/create-stream)——
 *    也就是说它只对外部攻击者可见。
 *
 * 而 ② 最该被追问的是:**v12.382 的付费门禁为什么没抓到它?**
 * 因为那版的特征全是「直接调付费 SDK」(dispatchTTSGenerate / callLLMWithFallback /
 * new MinimaxService …),而 /api/create 走的是 `new AgentOrchestrator()` +
 * `startProduction(idea)` —— 一条都不命中。一个只认直接调用的付费门禁,
 * 会漏掉所有把花钱包了一层的入口,而那恰恰是最贵的那类:编排器一跑就是整条管线。
 * 扩展特征后识别数 22 → 30。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const GATE = path.join(process.cwd(), 'scripts/paid-endpoint-gate.mjs');
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const bodyOf = (s: string) =>
  s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).filter((l) => !/^\s*import\s/.test(l)).join('\n');

describe('vision-audit/run:先问「是不是你的」,再问「有没有额度」', () => {
  const src = read('app/api/projects/[id]/vision-audit/run/route.ts');
  const body = bodyOf(src);

  it('补上归属校验 —— 光验登录挡不住 IDOR', () => {
    expect(body).toMatch(/requireProjectAccess\(request,\s*id/);
  });

  it('归属校验排在读数据之前 —— 先查库再鉴权等于已经泄露了', () => {
    const authAt = body.indexOf('requireProjectAccess(');
    const readAt = body.indexOf("type = 'storyboard'");
    expect(authAt).toBeGreaterThan(0);
    expect(readAt).toBeGreaterThan(0);
    expect(authAt).toBeLessThan(readAt);
  });

  it('按镜烧钱的路由必须有付费守卫(它自己的注释就是这么写的)', () => {
    expect(src).toMatch(/按镜烧钱/);
    expect(body).toMatch(/guardPaidEndpoint\(/);
  });
});

describe('/api/create:遗留死路也得上锁', () => {
  const body = bodyOf(read('app/api/create/route.ts'));

  it('守卫在解析请求体之前 —— 先干活再鉴权,钱已经花了', () => {
    const guardAt = body.indexOf('guardPaidEndpoint(');
    const workAt = body.indexOf('startProduction(');
    expect(guardAt).toBeGreaterThan(0);
    expect(workAt).toBeGreaterThan(guardAt);
  });

  it('预算按整条管线估,不是象征性的一点', () => {
    const i = body.indexOf('guardPaidEndpoint(');
    const m = body.slice(i, i + 120).match(/pendingCostCny:\s*([\d.]+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1]), '整条制片管线单次至少 ¥5').toBeGreaterThanOrEqual(5);
  });
});

describe('付费门禁:补上「间接烧钱」这一半', () => {
  function gateIn(files: Record<string, string>) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-gate2-'));
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

  it('通过编排器间接烧钱 → 现在拦得住(v12.382 那版漏了)', () => {
    const r = gateIn({
      'app/api/x/route.ts':
        "export async function POST(req) {\n" +
        "  const { AgentOrchestrator } = await import('@/services/agent-orchestrator');\n" +
        "  const o = new AgentOrchestrator();\n" +
        "  return Response.json(await o.startProduction('idea'));\n}\n",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('app/api/x/route.ts');
  });

  it('识别数只增不减 —— 扩特征不该把已认出的漏掉', () => {
    const out = execFileSync('node', [GATE], { cwd: process.cwd(), encoding: 'utf-8' });
    const m = out.match(/识别出 (\d+) 个付费路由/);
    expect(m).toBeTruthy();
    // v12.382 认出 22 个;本版补了间接路径
    expect(Number(m![1])).toBeGreaterThanOrEqual(30);
    expect(out).toContain('均有守卫');
  });

  it('纯本地端点不因扩特征被误伤', () => {
    const r = gateIn({
      'app/api/x/route.ts': "export async function GET() {\n  return Response.json({ ok: 1 });\n}\n",
    });
    // 没有付费路由 → 自检会说识别 0 个,但不该报「未守卫」
    expect(r.out).not.toContain('会花钱但没有鉴权');
  });
});
