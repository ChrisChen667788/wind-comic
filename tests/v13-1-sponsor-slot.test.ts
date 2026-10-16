/**
 * v13.1 · README 赞助位能下架、也能原样再上架。
 *
 * 秘塔科技的赞助位 2026-10-16 下架,原文存档在 docs/sponsors/metaso/。「随时能再上架」要靠测试守住,
 * 否则几个月后 README 结构一变,存档就放不回去了,或者放回去时 ?s=wind-comic 分成参数、logo 已经丢了。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  SLOT_START, SLOT_END, READMES, readSlot, writeSlot, listSponsors, loadSnippet, whoIsOn,
} from '../scripts/sponsor-slot.mjs';
import { collectRefs, auditBudget } from '../scripts/optimize-media.mjs';

const read = (f: string) => fs.readFileSync(f, 'utf-8');

describe('v13.1 · 赞助位锚点', () => {
  it('两份 README 的锚点成对且唯一;挂着的内容只能是空位或某份存档原文(手改过就红)', () => {
    for (const r of READMES) {
      const s = read(r);
      expect(s.split(SLOT_START).length - 1, `${r} 开始锚点`).toBe(1);
      expect(s.split(SLOT_END).length - 1, `${r} 结束锚点`).toBe(1);
      expect(whoIsOn(s, r), `${r} 的赞助位内容与任何存档都对不上`).not.toBe('unknown');
    }
  });

  it('锚点缺失 / 重复 / 倒序 → 报错而不是猜位置', () => {
    expect(() => readSlot('# x\n')).toThrow(/锚点/);
    expect(() => readSlot(`${SLOT_START}\n${SLOT_START}\n${SLOT_END}\n`)).toThrow(/锚点/);
    expect(() => readSlot(`${SLOT_END}\n${SLOT_START}\n`)).toThrow(/锚点/);
  });
});

describe('v13.1 · 存档能原样上架、再原样下架', () => {
  it('存档里至少有秘塔;每份存档中英两份都在', () => {
    const ids = listSponsors();
    expect(ids).toContain('metaso');
    for (const id of ids) for (const r of READMES) expect(() => loadSnippet(id, r)).not.toThrow();
  });

  it('**上架后再下架 = 原文;下架后再上架 = 上架态**(两份 README、每个存档)', () => {
    for (const id of listSponsors()) {
      for (const r of READMES) {
        const now = read(r);
        const on = writeSlot(now, loadSnippet(id, r));
        expect(readSlot(on)).toBe(loadSnippet(id, r));
        expect(whoIsOn(on, r)).toBe(id);
        const off = writeSlot(on, '');
        expect(whoIsOn(off, r)).toBe('');
        expect(writeSlot(off, loadSnippet(id, r))).toBe(on);
        // 锚点外的内容一个字都不动
        expect(off.replace(readSlot(off), '')).toBe(now.replace(readSlot(now), ''));
      }
    }
  });

  it('秘塔上架后:落地页都带 ?s=wind-comic 分成参数,logo 指向仓库里真实存在的文件', () => {
    for (const r of READMES) {
      const block = loadSnippet('metaso', r);
      const links = [...block.matchAll(/href="(https:\/\/metaso\.cn[^"]*)"/g)].map((m) => m[1]);
      expect(links.length, `${r} 存档里没有落地页链接`).toBeGreaterThan(0);
      for (const l of links) expect(l, `${r} 的落地页丢了分成参数`).toContain('?s=wind-comic');
      expect(block).toContain('src="assets/sponsors/metaso.png"');
    }
    expect(fs.existsSync('assets/sponsors/metaso.png'), 'logo 不能随下架一起删掉').toBe(true);
  });

  it('任一存档上架后,README 媒体总量仍在预算内(上架不能把 tests/v12-335 顶红)', () => {
    for (const id of listSponsors()) {
      const refs = collectRefs((f: string) => (READMES.includes(f) ? writeSlot(read(f), loadSnippet(id, f)) : read(f)));
      const r = auditBudget(refs.filter((f) => fs.existsSync(f)).map((f) => ({ file: f, size: fs.statSync(f).size })));
      expect(r.overTotal, `${id} 上架后超出媒体总预算`).toBe(false);
      expect(r.oversized).toEqual([]);
    }
  });
});
