/**
 * v12.278 — 节奏审计:落库 + 回流剪辑线。
 *
 * 两个缺口:
 *  ① **审计结果从不落库**。writer-agent 算完挂在 `script.pacingReport` 上并经 SSE 推前端,
 *     但 `saveAsset(projectId,'script',…)` 只存 `{synopsis,title,shots,theme}` ——
 *     前端那份是 `store.updateAsset` 写进 Zustand 的**纯客户端状态**(不打服务端),
 *     于是项目页「节奏分析」tab **刷新后空白**。而这恰是全部竞品都没有的核心差异化能力。
 *  ② **审计结论进不了剪辑线**。节奏审计与 EDL/AAF 各自都是竞品空白,接起来更没有第二家:
 *     剪辑师应当在自己的时间轴上直接看到「第 3~5 镜是拖沓段」,而不是去翻另一个网页。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { auditScript } from '@/lib/pacing-audit';
import { pacingReportToMarkers, buildEDL, buildFCPXML } from '@/lib/edl-export';

const mkScript = (rows: Array<{ act: string; emo: string; d?: string; dur: number }>) =>
  ({ shots: rows.map((a, i) => ({ shotNumber: i + 1, sceneDescription: '', action: a.act, emotion: a.emo, characters: ['A'], dialogue: a.d, duration: a.dur })) }) as any;

const BAD = mkScript([
  { act: '她一巴掌打过去,怒吼撕破婚约', emo: '愤怒', d: '你竟敢背叛我!', dur: 4 },
  { act: '他跪地哀求,场面失控', emo: '绝望', d: '求你别走', dur: 4 },
  { act: '两人走在路上', emo: '平静', dur: 4 },
  { act: '她看着窗外', emo: '平静', dur: 4 },
  { act: '他喝了口水', emo: '平静', dur: 4 },
  { act: '天亮了', emo: '平静', dur: 4 },
]);

const startsOf = (sc: any): number[] => {
  const out: number[] = []; let c = 0;
  for (const s of sc.shots) { out.push(c); c += s.duration; }
  return out;
};

describe('v12.278 · ① 审计结果必须随 script 落库', () => {
  it('两处 saveAsset 都带 pacingReport(此前只存 synopsis/title/shots/theme)', () => {
    const src = fs.readFileSync('lib/create-pipeline.ts', 'utf-8');
    const saves = src.split('\n').filter((l) => l.includes("saveAsset(projectId, 'script'"));
    expect(saves.length, '应有两处 script 落库').toBe(2);
    for (const line of saves) {
      expect(line, `该行未带 pacingReport: ${line.trim().slice(0, 80)}`).toContain('pacingReport');
    }
  });

  it('store.updateAsset 仍是纯客户端 set —— 说明不落库就真的会丢(病根锁)', () => {
    const store = fs.readFileSync('lib/store.ts', 'utf-8');
    const i = store.indexOf('updateAsset: (assetId, updates) => set(');
    expect(i, 'updateAsset 应仍是 Zustand set').toBeGreaterThan(0);
    // 它附近不该出现服务端写入 —— 若哪天改成落库,这条会提醒重新评估本版修法
    const near = store.slice(i, i + 400);
    // v12.390:否定式断言前先自证窗口 —— 切歪时 not.toMatch 必然通过
    expect(near, '窗口没切到 updateAsset').toContain('updateAsset');
    expect(near).not.toMatch(/fetch\(|await\s+api|axios/);
  });
});

describe('v12.278 · ② 审计结论 → 剪辑线标记', () => {
  it('拖沓段翻译成带时间范围的标记,并说清怎么改', () => {
    const r: any = auditScript(BAD, { dramaMode: true });
    const markers = pacingReportToMarkers(r, startsOf(BAD));
    const drag = markers.find((m) => m.name.includes('拖沓段'));
    expect(drag, '应产出拖沓段标记').toBeTruthy();
    expect(drag!.atS).toBe(8);                    // 第 3 镜起点 = 4+4
    expect(drag!.durationS).toBeGreaterThan(0);   // 是范围标记不是点
    expect(drag!.comment).toContain('建议');       // 必须给可执行建议
  });

  it('高潮点标记指出曲线形状(front-loaded 时尤其重要)', () => {
    const r: any = auditScript(BAD, { dramaMode: true });
    const markers = pacingReportToMarkers(r, startsOf(BAD));
    const peak = markers.find((m) => m.name.includes('高潮'));
    expect(peak).toBeTruthy();
    expect(peak!.comment).toContain('front-loaded');
  });

  it('只翻译能指到镜号的结论 —— 不把「平均分」塞进时间轴变噪声', () => {
    const r: any = auditScript(BAD, { dramaMode: true });
    const markers = pacingReportToMarkers(r, startsOf(BAD));
    for (const m of markers) {
      expect(m.name, `标记名应指向镜号或明确阶段:${m.name}`).toMatch(/S\d|开场/);
    }
    expect(markers.every((m) => !/平均分|averageConflictScore/.test(m.name))).toBe(true);
  });

  it('无审计报告 / 空输入时返回空数组(老项目无该字段)', () => {
    expect(pacingReportToMarkers(null, [0, 4])).toEqual([]);
    expect(pacingReportToMarkers({ v2: { dragSegments: [] } }, [])).toEqual([]);
  });
});

describe('v12.278 · 标记真的进了导出文件', () => {
  const r: any = auditScript(BAD, { dramaMode: true });
  const markers = pacingReportToMarkers(r, startsOf(BAD));
  const shots = BAD.shots.map((s: any, i: number) => ({ name: `Shot ${i + 1}`, durationS: s.duration }));

  it('EDL 以注释块附标记(CMX3600 无标准 marker 事件)', () => {
    const edl = buildEDL(shots, 24, 'T', [], markers);
    expect(edl).toContain('PACING AUDIT MARKERS');
    expect(edl).toContain('* MARKER 00:00:08:00');   // 拖沓段起点
    expect(edl).toContain('拖沓段 S3-6');
  });

  it('FCPXML 用原生 <marker>(可落到 NLE 时间轴标尺上)', () => {
    const xml = buildFCPXML(shots, 24, 'T', [], markers);
    expect((xml.match(/<marker>/g) || []).length).toBe(markers.length);
    expect(xml).toContain('<in>192</in>');           // 8s × 24fps
  });

  it('零回归:不传标记时两种格式都与旧版同形', () => {
    expect(buildEDL(shots, 24)).not.toContain('PACING AUDIT MARKERS');
    expect(buildFCPXML(shots, 24)).not.toContain('<marker>');
  });

  it('导出路由已接线(script.pacingReport → markers)', () => {
    const src = fs.readFileSync('app/api/projects/[id]/export-edl/route.ts', 'utf-8');
    expect(src).toContain('pacingReportToMarkers');
    expect(src).toContain('pacingReport');
  });
});
