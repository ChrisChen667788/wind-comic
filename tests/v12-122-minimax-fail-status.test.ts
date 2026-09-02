/**
 * v12.122 — MiniMax 状态终止判定:网关实返 'Fail'(无 -ed),旧 `=== 'Failed'` 永不命中
 * → 白轮询 120 次到 10min 超时(e2e 实测抓获)。
 *
 * ── v12.402 重写这条测试的原因(两处它自己的毛病)──────────────────────
 * ① **它测的是测试文件里自己抄的一份正则**,不是生产代码里的那份。
 *    生产的正则改坏了,这条照样绿 —— 典型的假绿:断言看着很像在验行为,
 *    其实在验一个只存在于测试文件里的常量。
 * ② **它数的是「某个文件里出现几次」**(期望 4)。v12.402 把视频轮询的解析
 *    提到 `lib/minimax-video-api.ts` 后,行为一个字没变,数字从 4 变 3,测试就红了。
 *    锁写法而不是锁行为,重构一次红一次 —— 久了就会有人去改期望值而不是看行为。
 *
 * 现在:直接拿**生产函数**过状态字面量,并且守住真正的病灶
 * ——「用严格等号比 'Failed'」这种写法在全仓不得复活。
 */
import { describe, it, expect } from 'vitest';
import { parsePollResponse } from '@/lib/minimax-video-api';
import fs from 'node:fs';

describe('v12.122 · MiniMax Fail 状态匹配', () => {
  it('视频轮询:Fail/Failed/failed/FAILED 都立即终止(走生产函数,不是测试里抄的正则)', () => {
    for (const s of ['Fail', 'Failed', 'failed', 'FAILED', 'fail']) {
      expect(parsePollResponse('v1', { status: s }).state, `状态 ${s} 应判失败`).toBe('failed');
    }
    for (const s of ['Processing', 'Queueing', '']) {
      expect(parsePollResponse('v1', { status: s }).state, `状态 ${s} 应继续等待`).toBe('pending');
    }
    expect(parsePollResponse('v1', { status: 'Success', video_url: 'u' }).state).toBe('success');
  });

  it('V2 的失败字面量不同(failed / cancelled),同样必须立即终止', () => {
    expect(parsePollResponse('v2', { task: { status: 'failed' } }).state).toBe('failed');
    expect(parsePollResponse('v2', { task: { status: 'cancelled' } }).state).toBe('failed');
    expect(parsePollResponse('v2', { task: { status: 'running' } }).state).toBe('pending');
  });

  it('全仓不得复活「严格等号比 Failed」—— 那正是当初白轮询 10 分钟的写法', () => {
    const files = ['services/minimax.service.ts', 'lib/minimax-video-api.ts'];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      // 窗口自证:先确认文件真的读到了、且确实含轮询逻辑
      expect(src.length, `${f} 读出来是空的`).toBeGreaterThan(500);
      expect(src, `${f} 里没有任何状态判定?那这条测试在锁空气`).toMatch(/status/i);
      expect(src.includes("=== 'Failed'"), `${f} 里出现了严格等号比 'Failed'`).toBe(false);
      expect(src.includes('=== "Failed"'), `${f} 里出现了严格等号比 "Failed"`).toBe(false);
    }
  });

  it('service 里每一处轮询终止点都用宽松匹配(数量不写死,逐处检查)', () => {
    const src = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    // 找出所有「判失败并抛错」的终止点,逐个确认用的是宽松匹配而非严格等号
    const terminations = src.split('\n').filter((l) => /if \(.*status.*\)/.test(l) && /fail/i.test(l));
    expect(terminations.length, '一处轮询终止点都没找到 —— 结构变了就得同步这条').toBeGreaterThan(0);
    for (const line of terminations) {
      expect(line, `这处没用宽松匹配:${line.trim()}`).toMatch(/\^fail\(ed\)\?\$/);
    }
  });
});
