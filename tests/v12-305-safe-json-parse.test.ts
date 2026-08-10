/**
 * v12.305 — 一个项目的字段损坏,让**整个仪表盘 500**。
 *
 * `GET /api/projects` 在 `rows.map()` 里裸 `JSON.parse(r.script_data)` ——
 * 任意一行的 JSON 不合法(管道写一半被中断后重启、直接改过 DB、旧版本写入格式变更),
 * 整个列表端点抛错 500,**该用户的所有项目一起看不见**。一行坏数据,全盘不可用。
 *
 * 取舍很明确:**坏数据降级成兜底值,而不是让整页崩掉**。
 * 一个项目的封面数组坏了,最坏是它没封面;不该连累另外九个项目打不开。
 *
 * 但降级必须**留痕** —— 静默吞掉就变成了本轮反复在修的「静默失败」(v12.299/300)。
 * 所以只记字段名与项目 id,**不打内容**(避免把脏数据/隐私刷进日志)。
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { safeJsonParse } from '@/lib/safe-json';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('v12.305 · safeJsonParse 行为', () => {
  it('合法 JSON 正常解析', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2]', [])).toEqual([1, 2]);
  });

  it('**非法 JSON 返回兜底值而不是抛错**(这就是整页 500 的根因)', () => {
    const truncated = '{"shots":[{"shotNumber":1,"desc';   // 写一半被中断
    expect(() => safeJsonParse(truncated, null)).not.toThrow();
    expect(safeJsonParse(truncated, null)).toBeNull();
    expect(safeJsonParse(truncated, [] as any[])).toEqual([]);
  });

  it('空值一律走兜底(null / undefined / 空串)', () => {
    for (const raw of [null, undefined, '']) {
      expect(safeJsonParse(raw, 'FB')).toBe('FB');
    }
  });

  it('JSON 里的 null 也算没有值,走兜底(避免 covers 变成 null 后前端 .map 崩)', () => {
    expect(safeJsonParse('null', [])).toEqual([]);
  });

  it('已经是对象时原样返回(调用方口径不一致时不炸)', () => {
    const o = { a: 1 };
    expect(safeJsonParse(o, null)).toBe(o);
  });

  it('**降级要留痕**,且日志里带定位上下文', () => {
    const onError = vi.fn();
    safeJsonParse('{bad', null, { context: 'projects.script_data#proj-abc', onError });
    expect(onError).toHaveBeenCalledOnce();
    const msg = String(onError.mock.calls[0][0]);
    expect(msg).toContain('projects.script_data#proj-abc');
    expect(msg).toContain('降级');
  });

  it('日志**不打内容**(脏数据/隐私不该被刷进日志)', () => {
    const onError = vi.fn();
    safeJsonParse('{"secret":"sk-live-abcdef', null, { context: 'x', onError });
    expect(String(onError.mock.calls[0][0])).not.toContain('sk-live-abcdef');
  });

  it('合法解析不产生告警噪声', () => {
    const onError = vi.fn();
    safeJsonParse('{"a":1}', null, { onError });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('v12.305 · 两个项目端点都不再裸 parse', () => {
  const SITES = ['app/api/projects/route.ts', 'app/api/projects/[id]/route.ts'];

  it('列表口与详情口都改用 safeJsonParse', () => {
    for (const f of SITES) {
      const s = strip(fs.readFileSync(f, 'utf-8'));
      expect(s, `${f} 未接`).toContain('safeJsonParse');
      expect(s).toMatch(/import \{ safeJsonParse \} from '@\/lib\/safe-json'/);
    }
  });

  it('**这三个会崩整页的字段不得再裸 parse**', () => {
    for (const f of SITES) {
      const s = strip(fs.readFileSync(f, 'utf-8'));
      for (const col of ['cover_urls', 'script_data', 'director_notes']) {
        expect(s, `${f} 的 ${col} 仍是裸 JSON.parse`).not.toMatch(
          new RegExp(`JSON\\.parse\\([a-z]+\\.${col}`),
        );
      }
    }
  });

  it('每处都带定位上下文(否则出问题不知道是哪个项目哪个字段)', () => {
    const s = strip(fs.readFileSync('app/api/projects/route.ts', 'utf-8'));
    expect((s.match(/context: `projects\./g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('共享工具是零依赖纯函数', () => {
    expect(fs.readFileSync('lib/safe-json.ts', 'utf-8')).not.toMatch(/^import /m);
  });
});

describe('v12.305 · 端到端:一行坏数据不再连累整批', () => {
  /** 复刻列表口的 map 形态 */
  const mapRows = (rows: any[], parse: (raw: any) => any) =>
    rows.map((r) => ({ id: r.id, scriptData: parse(r.script_data) }));

  const ROWS = [
    { id: 'p1', script_data: '{"shots":[1]}' },
    { id: 'p2', script_data: '{"shots":[{"shotNumber":1,"desc' },   // 损坏
    { id: 'p3', script_data: '{"shots":[3]}' },
  ];

  it('对照:裸 parse 会让整批抛错(一个都拿不到)', () => {
    expect(() => mapRows(ROWS, (raw) => (raw ? JSON.parse(raw) : null))).toThrow();
  });

  it('修复后:坏的那行降级,其余项目照常返回', () => {
    const out = mapRows(ROWS, (raw) => safeJsonParse<any>(raw, null, { onError: () => {} }));
    expect(out).toHaveLength(3);
    expect(out[0].scriptData).toEqual({ shots: [1] });
    expect(out[1].scriptData, '坏行降级为 null').toBeNull();
    expect(out[2].scriptData, '后面的项目不受连累').toEqual({ shots: [3] });
  });
});
