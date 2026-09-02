/**
 * v12.405 — 只有 `/api/create` 这条路上的用户,一直在拿 Kling v1 标准档出片。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * 同一个供应商有**两份 service**:
 *   · `services/kling.service.ts`(528 行)—— kling-v3、Elements 多主体、首尾帧、
 *     4K 提档、运镜、prompt 长度裁断、横竖屏。provider 注册表用它,17 处调用。
 *   · `services/keling.service.ts`(123 行)—— 写死 `model_name: 'kling-v1'` +
 *     `mode: 'std'`,不传 aspect_ratio,不裁 prompt,没有以上任何一项。
 *
 * 而**主管线 `agent-orchestrator`(服务 `/api/create`)用的是后者** ——
 * 两处调用点。README 竞品对照表写着「Kling 3.0」,仓库别处配的是 v3,
 * 只有从 `/api/create` 进来的用户拿到 v1 标准档。
 * 「主路径修好了、旁路没跟上」的又一次,而且旧的那条恰恰是用户撞到的。
 *
 * ── 删之前先做的事 ────────────────────────────────────────────────────
 * 幸存者反而缺两项加固:它**自带一份** `fetchWithTimeout`(v12.304 要消灭的正是
 * 「各自定义」),且**完全没接 poll-policy**(v12.329),任何一次 5xx 都会把
 * 已在生成、已计费的任务直接判死。所以顺序是:**先给幸存者补齐加固 →
 * 再迁移那两条测试的断言对象 → 最后才删文件**。反过来就等于静默丢掉保障。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/(?<!:)\/\/.*$/, '')).join('\n');

describe('v12.405 · Kling 只剩一份实现', () => {
  it('第二份实现已删除,且不会被重新创建', () => {
    expect(fs.existsSync('services/keling.service.ts'), 'Kling 的第二份实现又回来了').toBe(false);
    expect(fs.existsSync('services/kling.service.ts'), '幸存者不见了?').toBe(true);
  });

  it('主管线不再引用已删的那份', () => {
    const orch = stripComments(fs.readFileSync('services/agent-orchestrator.ts', 'utf-8'));
    // 窗口自证:确认读到的确实是那个 orchestrator
    expect(orch).toContain('generateVideo');
    expect(orch).toContain("from './kling.service'");
    expect(orch.includes("from './keling.service'"), '又引回残缺的那份了').toBe(false);
    expect(orch.includes('KelingService'), 'KelingService 复活了').toBe(false);
  });

  it('全仓没有任何生产代码再写死 kling-v1 / mode std —— 模型与档位必须可配', () => {
    const files = ['services/kling.service.ts', 'services/agent-orchestrator.ts'];
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, 'utf-8'));
      expect(src.length, `${f} 读出来是空的`).toBeGreaterThan(300);
      expect(src.includes("model_name: 'kling-v1'"), `${f} 写死了最老的模型`).toBe(false);
    }
  });

  it('幸存者用共享的 fetchWithTimeout,不再自带一份', () => {
    const src = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(src).toMatch(/import \{ fetchWithTimeout \} from '@\/lib\/fetch-timeout'/);
    expect(stripComments(src).includes('function fetchWithTimeout'), '又自带一份了').toBe(false);
  });

  it('幸存者接上了 poll-policy —— 5xx 不该把已计费的任务判死', () => {
    const src = stripComments(fs.readFileSync('services/kling.service.ts', 'utf-8'));
    expect(src).toMatch(/from '@\/lib\/poll-policy'/);
    const m = /classifyPollStatus\((\w+)\.status\)/.exec(src);
    expect(m, '没有任何状态判定').not.toBeNull();
    const block = src.slice(Math.max(0, src.indexOf(m![0]) - 200), src.indexOf(m![0]) + 400);
    expect(block, '瞬时抖动应继续轮询').toMatch(/continue/);
    expect(block, '终局错误应立刻抛').toMatch(/terminalPollMessage/);
  });

  it('那两条老测试的断言已迁到幸存者,不是被删掉了事', () => {
    for (const f of ['tests/v12-304-fetch-timeout.test.ts', 'tests/v12-329-poll-policy.test.ts']) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src, `${f} 应改为断言幸存者`).toContain("services/kling.service.ts");
      // 断言对象不能指向一个已经不存在的文件 —— 那样 readFileSync 会直接炸,
      // 但更糟的情况是有人为了让它绿而把整条断言删掉。
      expect(src.includes("'services/keling.service.ts'"), `${f} 仍指向已删文件`).toBe(false);
    }
  });
});
