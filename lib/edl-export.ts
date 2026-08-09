/**
 * lib/edl-export (v8.0) — EDL / FCP7 XML 导出 (对接 DaVinci Resolve / Premiere Pro)
 *
 * 纯逻辑, 把分镜序列 (顺序拼接的镜头) 编译成专业 NLE 可导入的剪辑表:
 *   - buildEDL():    CMX3600 EDL (最通用, DaVinci/Premiere/Avid 都能读)
 *   - buildFCPXML(): FCP7 xmeml (DaVinci / Premiere 导入, 保留片段名 + 时长)
 *
 * 注: EDL + FCPXML 覆盖 DaVinci/Premiere 对接 (最通用)。真 AAF (Avid) 为二进制 MS-CFB 容器,
 *     已在 v9.2.0 由 lib/aaf-export 自实现 (无第三方库), 端点 /api/projects/[id]/export-aaf。
 */

import { computeXfadeTimeline } from './xfade-timeline';

export interface EdlShot {
  name: string;
  /** ⚠️ 必须是**成片终值时长**,不是剧本设计时长 —— 见文件头 v12.277 说明。 */
  durationS: number;
  sourceUrl?: string;
  /** v12.277:该镜**进入时**的转场('cut' 视为硬切,其余按溶解处理)。 */
  transition?: string;
  /** v12.277:转场时长(秒)。EDL 的 D 事件与 FCPXML 的 transitionitem 都需要它。 */
  transitionDurationS?: number;
}

/**
 * v12.278:剪辑线标记 —— 把**节奏审计的结论**带进 NLE。
 *
 * 为什么值得做:节奏审计与 EDL/AAF 导出各自都是「全部已查竞品的空白」,
 * 把两者接起来更没有第二家 —— 剪辑师在自己的时间轴上直接看到
 * 「第 3~5 镜是拖沓段」「高潮在第 8 镜」,而不是去翻另一个网页里的报告。
 * 这正对着本项目的价值主张:**降废片率,并且要说出改哪几镜**。
 */
export interface EdlMarker {
  /** 在成片时间轴上的位置(秒) */
  atS: number;
  /** 覆盖时长(秒);0/缺省表示点标记 */
  durationS?: number;
  name: string;
  comment?: string;
}

/** v12.277:音轨条目(逐镜配音 / 整条 BGM)。 */
export interface EdlAudio {
  name: string;
  sourceUrl?: string;
  /** 在成片时间轴上的起点(秒) */
  startS: number;
  durationS: number;
  /** 'vo' 逐镜配音 → A1;'bgm' 配乐 → A2 */
  kind: 'vo' | 'bgm';
}

const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** 帧数 → CMX 时间码 HH:MM:SS:FF (non-drop) */
export function framesToTimecode(frames: number, fps = 24): string {
  const f = Math.max(0, Math.round(frames));
  const ff = f % fps;
  const totalSec = Math.floor(f / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

export function secondsToTimecode(seconds: number, fps = 24): string {
  return framesToTimecode(Math.round((seconds || 0) * fps), fps);
}

/** 归一化镜头: 时长兜底 5s, 名称兜底 */
function normShots(shots: EdlShot[]): { name: string; durationS: number; sourceUrl?: string; transition?: string; transitionDurationS?: number }[] {
  return (Array.isArray(shots) ? shots : []).map((s, i) => ({
    name: (s?.name || `Shot ${i + 1}`).slice(0, 80),
    // ⚠️ v12.277 修既有精度 bug:此前这里是 `Math.round(durationS)` —— 把**秒**四舍五入成整秒,
    // 之后才 × fps,亚秒精度被直接抹掉(3.5s 导成 4s)。而变速后的时长几乎全是小数
    // (如 4 ÷ 0.7 = 5.71s),20 个镜头累积可漂十几秒 —— 剪辑线「看着像、对不上」的另一个根因。
    // 现在保留原始秒值,由调用方按 `Math.round(durationS * fps)` 一次性转帧。
    durationS: (s?.durationS && s.durationS > 0) ? s.durationS : 5,
    sourceUrl: s?.sourceUrl,
    transition: s?.transition,
    transitionDurationS: s?.transitionDurationS,
  }));
}

/** 秒 → 帧(唯一转换口径,避免各处各转一次导致累积误差)。 */
function toFrames(durationS: number, fps: number): number {
  return Math.max(1, Math.round((durationS || 0) * fps));
}

/** v12.277:非硬切即按溶解导出。'cut'/'flash-cut' 与空值都算硬切。 */
export function isDissolveTransition(t: string | undefined | null): boolean {
  const v = String(t || '').trim().toLowerCase();
  if (!v) return false;
  return v !== 'cut' && v !== 'flash-cut' && v !== 'continuous';
}


/**
 * v12.297:各镜在**压缩后**记录时间轴上的起始帧。
 *
 * 复用 `lib/xfade-timeline` 的 `computeXfadeTimeline` —— 与成片、与配音 adelay、与字幕起点
 * 同一份真源(v12.265 立的规矩)。硬切(transition 为空/cut/flash-cut)重叠为 0。
 */
export function xfadeRecordStartsSec(
  shots: Array<{ durationS: number; transition?: string; transitionDurationS?: number }>,
): number[] {
  const durations = shots.map((s) => (s?.durationS > 0 ? s.durationS : 0));
  const tds = shots.map((s, i) => {
    if (i === 0) return 0;                                  // 首镜无入场转场
    if (!isDissolveTransition(s?.transition)) return 0;      // 硬切不重叠
    const td = s?.transitionDurationS;
    return typeof td === 'number' && td > 0 ? td : 0.5;      // 未回写时沿用旧兜底
  });
  return computeXfadeTimeline(durations, tds).clipStartSec;
}

/**
 * 帧版本。**只在这里做一次秒→帧转换** —— 调用方不要先把秒取整再转帧,
 * v12.277 就栽在 `Math.round(durationS)` 上(3.5s 导成 4s,20 镜累积漂十几秒)。
 */
export function xfadeRecordStarts(
  shots: Array<{ durationS: number; transition?: string; transitionDurationS?: number }>,
  fps = 24,
): number[] {
  return xfadeRecordStartsSec(shots).map((sec) => Math.max(0, Math.round(sec * fps)));
}

/** CMX3600 EDL */
export function buildEDL(shots: EdlShot[], fps = 24, title = 'WIND COMIC TIMELINE', audio: EdlAudio[] = [], markers: EdlMarker[] = []): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: toFrames(s.durationS, fps) }));
  const lines: string[] = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
  // v12.297:**记录时间轴要用 xfade 压缩后的那一份**,不能纯累加。
  // 每个 D(溶解)事件在 NLE 里都是一段**重叠** —— 画面轨会因此压缩 Σ(转场时长),
  // 而纯累加算出的 record-in 停在绝对位置,于是导入 Premiere/Avid 后画面与音频逐镜错开,
  // n 镜项目最大偏 (n−1)×转场时长。这正是 v12.264/265 在**成片**里修过的病,
  // v12.277 做**导出**时又原样犯了一遍;现在两边共用 `computeXfadeTimeline`。
  const recStartFrames = xfadeRecordStarts(norm, fps);
  let evtNo = 0;
  const nextEvt = () => String(++evtNo).padStart(3, '0');

  norm.forEach((s, i) => {
    const rec = recStartFrames[i];
    const srcIn = framesToTimecode(0, fps);
    const srcOut = framesToTimecode(s.frames, fps);
    const recIn = framesToTimecode(rec, fps);
    const recOut = framesToTimecode(rec + s.frames, fps);
    // v12.277:非硬切导出为 D(溶解)事件 —— 此前一律写 C,管线设计的转场在剪辑线里全丢了。
    // CMX3600 惯例:D 事件需前置一条同 record-in 的 C 事件作为 "from" 素材,并在 D 行末给出转场帧数。
    if (isDissolveTransition(s.transition)) {
      const tFrames = Math.max(1, Math.round((s.transitionDurationS ?? 0.5) * fps));
      lines.push(`${nextEvt()}  AX       V     C        ${srcOut} ${srcOut} ${recIn} ${recIn}`);
      lines.push(`${nextEvt()}  AX       V     D    ${String(tFrames).padStart(3, '0')} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
      lines.push(`* EFFECT NAME: CROSS DISSOLVE`);
    } else {
      lines.push(`${nextEvt()}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    }
    lines.push(`* FROM CLIP NAME: ${s.name}`);
    if (s.sourceUrl) lines.push(`* SOURCE FILE: ${s.sourceUrl}`);
    lines.push('');
  });

  // v12.277:音轨 —— 逐镜配音走 A(A1 语义),BGM 走 A2。
  // 此前 EDL 只有 V 轨,剪辑师导入后**逐角色配音与配乐全部丢失**,等于把管线一半的活儿扔了。
  for (const a of Array.isArray(audio) ? audio : []) {
    const dur = Math.max(1, Math.round((a?.durationS > 0 ? a.durationS : 1) * fps));
    const start = Math.max(0, Math.round((a?.startS || 0) * fps));
    const chan = a?.kind === 'bgm' ? 'A2   ' : 'A    ';
    lines.push(`${nextEvt()}  AX       ${chan} C        ${framesToTimecode(0, fps)} ${framesToTimecode(dur, fps)} ${framesToTimecode(start, fps)} ${framesToTimecode(start + dur, fps)}`);
    lines.push(`* FROM CLIP NAME: ${a.name}`);
    if (a.sourceUrl) lines.push(`* SOURCE FILE: ${a.sourceUrl}`);
    lines.push('');
  }
  // v12.278:节奏审计标记 —— CMX3600 无标准 marker 事件,按通用做法以注释块附在末尾,
  // 各家 NLE 导入时保留为片段注释/日志,剪辑师肉眼可见「哪几镜要改」。
  if (Array.isArray(markers) && markers.length > 0) {
    lines.push('* ─── PACING AUDIT MARKERS (wind-comic) ───');
    for (const m of markers) {
      const at = framesToTimecode(Math.max(0, Math.round((m?.atS || 0) * fps)), fps);
      const span = m?.durationS && m.durationS > 0
        ? `–${framesToTimecode(Math.round(((m.atS || 0) + m.durationS) * fps), fps)}`
        : '';
      lines.push(`* MARKER ${at}${span}  ${m.name}${m.comment ? ` — ${m.comment}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/** FCP7 XML (xmeml v5) — DaVinci / Premiere 可导入 */
export function buildFCPXML(shots: EdlShot[], fps = 24, title = 'Wind Comic Sequence', audio: EdlAudio[] = [], markers: EdlMarker[] = []): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: toFrames(s.durationS, fps) }));
  // v12.297:与 buildEDL 同理 —— 时间轴要用 xfade 压缩后的那份,纯累加会让画面与音轨错开。
  const recStartFrames = xfadeRecordStarts(norm, fps);
  const last = norm.length - 1;
  const total = last >= 0 ? (recStartFrames[last] + norm[last].frames) : 0;
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const clips = norm.map((s, i) => {
    const start = recStartFrames[i], end = start + s.frames;
    return [
      `        <clipitem id="clipitem-${i + 1}">`,
      `          <name>${xmlEscape(s.name)}</name>`,
      `          <duration>${s.frames}</duration>`,
      `          ${rate}`,
      `          <start>${start}</start>`,
      `          <end>${end}</end>`,
      `          <in>0</in>`,
      `          <out>${s.frames}</out>`,
      s.sourceUrl ? `          <pathurl>${xmlEscape(s.sourceUrl)}</pathurl>` : '',
      `        </clipitem>`,
    ].filter(Boolean).join('\n');
  });
  // v12.277:按 kind 分两条音轨(vo → A1,bgm → A2)
  const mkAudioTrack = (items: EdlAudio[], label: string): string[] => {
    if (!items.length) return [];
    const cis = items.map((a, i) => {
      const dur = Math.max(1, Math.round((a?.durationS > 0 ? a.durationS : 1) * fps));
      const start = Math.max(0, Math.round((a?.startS || 0) * fps));
      return [
        `          <clipitem id="${label}-${i + 1}">`,
        `            <name>${xmlEscape(a.name)}</name>`,
        `            <duration>${dur}</duration>`,
        `            ${rate}`,
        `            <start>${start}</start>`,
        `            <end>${start + dur}</end>`,
        `            <in>0</in>`,
        `            <out>${dur}</out>`,
        a.sourceUrl ? `            <pathurl>${xmlEscape(a.sourceUrl)}</pathurl>` : '',
        `          </clipitem>`,
      ].filter(Boolean).join('\n');
    });
    return ['        <track>', ...cis, '        </track>'];
  };
  const list = Array.isArray(audio) ? audio : [];
  const audioTracks = [
    ...mkAudioTrack(list.filter((a) => a?.kind !== 'bgm'), 'vo'),
    ...mkAudioTrack(list.filter((a) => a?.kind === 'bgm'), 'bgm'),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="5">',
    `  <sequence id="sequence-1">`,
    `    <name>${xmlEscape(title)}</name>`,
    `    <duration>${total}</duration>`,
    `    ${rate}`,
    // v12.278:FCPXML 有原生 <marker>,比 EDL 的注释更实用 —— DaVinci/Premiere 导入后
    // 直接落在时间轴标尺上,剪辑师一眼看到「这段是拖沓段」。
    ...(Array.isArray(markers) ? markers : []).map((m) => {
      const inF = Math.max(0, Math.round((m?.atS || 0) * fps));
      const outF = m?.durationS && m.durationS > 0 ? inF + Math.round(m.durationS * fps) : inF + 1;
      return [
        '    <marker>',
        `      <comment>${xmlEscape(m.comment || '')}</comment>`,
        `      <name>${xmlEscape(m.name || 'marker')}</name>`,
        `      <in>${inF}</in>`,
        `      <out>${outF}</out>`,
        '    </marker>',
      ].join('\n');
    }),
    '    <media>',
    '      <video>',
    '        <track>',
    ...clips,
    '        </track>',
    '      </video>',
    // v12.277:音频段 —— 此前 FCPXML 只有 <video>,配音/配乐进不了剪辑线。
    // A1 = 逐镜配音,A2 = BGM;各自独立 track,便于剪辑师单独调平衡。
    ...(audioTracks.length ? ['      <audio>', ...audioTracks, '      </audio>'] : []),
    '    </media>',
    '  </sequence>',
    '</xmeml>',
  ].join('\n');
}

/**
 * v12.278:节奏审计报告 → 剪辑线标记。
 *
 * 只翻译**能指到具体镜号**的结论(拖沓段、高潮峰值、开场不达标),
 * 不把「平均分 5.2」这种没法操作的数字塞进时间轴 —— 那只会变成噪声。
 *
 * @param shotStartsS 各镜在成片时间轴上的起点(秒),由调用方按终值时长累计得出
 */
export function pacingReportToMarkers(
  report: any,
  shotStartsS: number[],
): EdlMarker[] {
  const out: EdlMarker[] = [];
  const v2 = report?.v2;
  if (!v2 || !Array.isArray(shotStartsS) || shotStartsS.length === 0) return out;
  const startOf = (shot1Based: number) => shotStartsS[Math.max(0, Math.min(shotStartsS.length - 1, shot1Based - 1))] ?? 0;

  // 拖沓段 —— 最该让剪辑师看到的:范围 + 均分 + 怎么改
  for (const d of (Array.isArray(v2.dragSegments) ? v2.dragSegments : [])) {
    const from = startOf(d.fromShot);
    const to = startOf(d.toShot) + 0.001;
    out.push({
      atS: from,
      durationS: Math.max(0.001, to - from),
      name: `拖沓段 S${d.fromShot}-${d.toShot}`,
      comment: `连续 ${d.length} 镜低冲突(均分 ${Number(d.avgScore).toFixed(1)})—— 建议合并/删减/插一次反转`,
    });
  }
  // 高潮峰值 —— 点标记,便于核对高潮是否落在该落的位置
  if (v2.shape?.peakIndex > 0) {
    out.push({
      atS: startOf(v2.shape.peakIndex),
      name: `高潮 S${v2.shape.peakIndex}`,
      comment: `曲线形状 ${v2.shape.shape};峰值高出均值 ${Number(v2.shape.peakProminence).toFixed(1)} 分`,
    });
  }
  // 开场不达标 —— 完播率由这里决定
  if (v2.opening && v2.opening.passed === false) {
    out.push({
      atS: 0,
      durationS: Math.max(0.001, startOf(v2.opening.sampled + 1) || 0.001),
      name: '开场密度不足',
      comment: `前 ${v2.opening.sampled} 镜均分 ${Number(v2.opening.avgScore).toFixed(1)} —— 完播率主要由开场决定`,
    });
  }
  return out;
}
