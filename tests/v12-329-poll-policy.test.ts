/**
 * v12.329 — 审计透镜③:重试与循环。
 *
 * ── 先说两处**没有**问题(查证过才敢说)────────────────────────────
 * · 四处 `while(true)` / `for(;;)`(season-orchestrator、event-bus-redis、
 *   drift-check、asset-storage)都有明确出口:游标耗尽 / 解析失败 / 队列空 /
 *   流结束且有字节上限。**不是无界循环。**
 * · 引擎轮询也都有次数上限 —— 我第一遍 grep `maxAttempts` 报「HappyHorse 0 次上限」,
 *   是**我的正则漏了**(它叫 `maxTries`)。先纠正自己的误判,再往下找。
 *
 * ── 真问题:同一语义七套实现,两种**相反**的错法 ──────────────────
 * 各引擎轮询「任务好了没」,对**非 200 响应**的处理彼此矛盾:
 *
 *   · **Keling / Vidu** —— 任何非 200 直接 `throw`。轮询中来一次瞬时 429/502,
 *     就把**上游其实还在跑、马上要出片**的任务整个丢掉:**钱已经花了,结果扔了**。
 *   · **HappyHorse** —— 任何非 200 一律 `continue`(注释写着「瞬时错误不打断轮询」)。
 *     于是 401(key 失效)、404(任务不存在)这类**永远不会好**的情况,也要把整个
 *     超时白等满 —— 本可立刻给出的报错,拖到十分钟后才说。
 *
 * 两种都错在同一处:**没区分「等一下会好」和「等到天荒地老也不会好」**。
 * 修法是一个共用判定,而不是各改各的 —— 否则第八个引擎接进来还会挑一种错法。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { classifyPollStatus, terminalPollMessage } from '@/lib/poll-policy';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// v12.405:keling.service.ts 已删(Kling 的第二份实现,残缺)。断言迁到幸存的 kling.service.ts ——
// 它此前**完全没接 poll-policy**,任何一次 5xx 都会把已在生成、已计费的任务直接判死。
const KELING = strip(fs.readFileSync('services/kling.service.ts', 'utf-8'));
const VIDU = strip(fs.readFileSync('services/vidu.service.ts', 'utf-8'));
const HH = strip(fs.readFileSync('services/happyhorse.service.ts', 'utf-8'));

describe('v12.329 · 判定本身', () => {
  it('永久错误:再轮一万次也是同一个答案', () => {
    for (const s of [400, 401, 403, 404, 410]) {
      expect(classifyPollStatus(s), `HTTP ${s} 应判为 terminal`).toBe('terminal');
    }
  });

  it('瞬时错误:上游忙或抖了一下,任务多半还在跑', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504, 599]) {
      expect(classifyPollStatus(s), `HTTP ${s} 应判为 transient`).toBe('transient');
    }
  });

  it('2xx 是 ok', () => {
    for (const s of [200, 201, 204, 299]) expect(classifyPollStatus(s)).toBe('ok');
  });

  it('**没列到的按可重试处理** —— 宁可多等,不可错杀已经付过钱的任务', () => {
    for (const s of [402, 409, 418, 451]) expect(classifyPollStatus(s)).toBe('transient');
  });

  it('永久错误给的是人话,能看出该去改什么', () => {
    expect(terminalPollMessage('Keling', 401)).toMatch(/key 无效|权限/);
    expect(terminalPollMessage('Vidu', 404)).toMatch(/任务不存在|过期/);
    expect(terminalPollMessage('X', 400)).toMatch(/查询请求本身有问题/);
    for (const s of [401, 404, 400]) {
      expect(terminalPollMessage('E', s), '要说明继续轮没用').toMatch(/不会变好/);
    }
  });
});

describe('v12.329 · Keling / Vidu:瞬时抖动不再丢掉已在跑的任务', () => {
  for (const [name, src] of [['Keling', KELING], ['Vidu', VIDU]] as const) {
    it(`${name} 非 200 时先判定,再决定 throw 还是继续`, () => {
      // v12.405:此前这里写死 `classifyPollStatus(response.status)`,锁的是**变量名**。
      // Kling 的轮询有两个端点(image2video 失败要回落 text2video),失败的是 `response2`,
      // 于是行为完全正确、断言却红了 —— 和 v12.122 那条是同一个毛病。改成锁行为:
      // 判定函数被调用过,且它周围既有「瞬时继续」也有「终局抛错」。
      const m = /classifyPollStatus\((\w+)\.status\)/.exec(src);
      expect(m, `${name} 里没有任何 classifyPollStatus 调用`).not.toBeNull();
      const i = src.indexOf(m![0]);
      const block = src.slice(Math.max(0, i - 200), i + 400);
      expect(block, '瞬时应继续轮询').toMatch(/continue/);
      expect(block, '永久应立刻抛').toMatch(/terminalPollMessage/);
    });

    it(`${name} 不再「任何非 200 一律 throw」`, () => {
      expect(src).not.toMatch(new RegExp(`throw new Error\\(\`${name} query error: \\$\\{response\\.statusText\\}`));
    });
  }
});

describe('v12.329 · HappyHorse:永久错误不再白等满超时', () => {
  it('非 200 时区分处理,而不是一律 continue', () => {
    expect(HH).toContain('classifyPollStatus(res.status)');
    expect(HH).toContain('terminalPollMessage');
  });

  it('瞬时错误仍然继续轮(原有正确行为保留)', () => {
    const i = HH.indexOf('classifyPollStatus(res.status)');
    expect(HH.slice(i, i + 260)).toMatch(/continue/);
  });
});

describe('v12.329 · 判定只有一处(第八个引擎接进来不会再挑错法)', () => {
  it('三个引擎都从同一个模块导入,没有各写一份', () => {
    for (const src of [KELING, VIDU, HH]) {
      expect(src).toMatch(/from '@\/lib\/poll-policy'/);
    }
  });

  it('引擎里不得再出现自己判状态码的写法', () => {
    for (const [name, src] of [['Keling', KELING], ['Vidu', VIDU], ['HappyHorse', HH]] as const) {
      expect(src, `${name} 又自己判状态码了`).not.toMatch(/status === 401|status === 404|status >= 500/);
    }
  });

  it('取舍写在模块里(后人才知道为什么 402 算可重试)', () => {
    const raw = fs.readFileSync('lib/poll-policy.ts', 'utf-8');
    expect(raw).toMatch(/宁可多等,不可错杀/);
    expect(raw).toMatch(/钱已经花了/);
  });
});
