/**
 * v12.68 — karaoke 扫光对齐 TTS 真实时长(sweepSec):扫光按配音走,显示仍到镜末。
 */
import { describe, it, expect } from 'vitest';
import { buildKaraokeAss } from '@/lib/ass-karaoke';

const OPTS = { w: 720, h: 1280, fontName: 'F', vertical: true };
const kfSum = (line: string): number => [...line.matchAll(/\\kf(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);

describe('v12.68 · karaoke sweepSec', () => {
  it('sweepSec 缺省 = durSec(旧行为零回归):扫光总厘秒 = 镜长', () => {
    const ass = buildKaraokeAss([{ text: '你好世界', startSec: 0, durSec: 4 }], OPTS);
    const dlg = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!;
    expect(kfSum(dlg)).toBe(400);
  });

  it('sweepSec=2 而镜长 4:扫光 200cs,Dialogue 显示仍到 4s', () => {
    const ass = buildKaraokeAss([{ text: '你好世界', startSec: 0, durSec: 4, sweepSec: 2 }], OPTS);
    const dlg = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!;
    expect(kfSum(dlg)).toBe(200);
    expect(dlg).toContain(',0:00:00.00,0:00:04.00,');
  });

  it('sweepSec 超镜长被 clamp 到 durSec(配音溢出不越界)', () => {
    const ass = buildKaraokeAss([{ text: '你好', startSec: 0, durSec: 3, sweepSec: 9 }], OPTS);
    const dlg = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!;
    expect(kfSum(dlg)).toBe(300);
  });
});
