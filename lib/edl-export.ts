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

export interface EdlShot {
  name: string;
  durationS: number;
  sourceUrl?: string;
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
function normShots(shots: EdlShot[]): { name: string; frames: number; sourceUrl?: string }[] {
  return (Array.isArray(shots) ? shots : []).map((s, i) => ({
    name: (s?.name || `Shot ${i + 1}`).slice(0, 80),
    frames: Math.max(1, Math.round((s?.durationS && s.durationS > 0 ? s.durationS : 5))),
    sourceUrl: s?.sourceUrl,
  }));
}

/** CMX3600 EDL */
export function buildEDL(shots: EdlShot[], fps = 24, title = 'WIND COMIC TIMELINE'): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: s.frames * fps }));
  const lines: string[] = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
  let rec = 0;
  norm.forEach((s, i) => {
    const evt = String(i + 1).padStart(3, '0');
    const srcIn = framesToTimecode(0, fps);
    const srcOut = framesToTimecode(s.frames, fps);
    const recIn = framesToTimecode(rec, fps);
    const recOut = framesToTimecode(rec + s.frames, fps);
    lines.push(`${evt}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${s.name}`);
    if (s.sourceUrl) lines.push(`* SOURCE FILE: ${s.sourceUrl}`);
    lines.push('');
    rec += s.frames;
  });
  return lines.join('\n');
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/** FCP7 XML (xmeml v5) — DaVinci / Premiere 可导入 */
export function buildFCPXML(shots: EdlShot[], fps = 24, title = 'Wind Comic Sequence'): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: s.frames * fps }));
  const total = norm.reduce((a, s) => a + s.frames, 0);
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  let rec = 0;
  const clips = norm.map((s, i) => {
    const start = rec, end = rec + s.frames; rec = end;
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
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="5">',
    `  <sequence id="sequence-1">`,
    `    <name>${xmlEscape(title)}</name>`,
    `    <duration>${total}</duration>`,
    `    ${rate}`,
    '    <media>',
    '      <video>',
    '        <track>',
    ...clips,
    '        </track>',
    '      </video>',
    '    </media>',
    '  </sequence>',
    '</xmeml>',
  ].join('\n');
}
