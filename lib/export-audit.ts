/**
 * 交付前审计:这一版要交出去的东西里,有多少不是真出图的(v12.429)。
 *
 * ## 为什么必须有
 *
 * 图像引擎全部失败时会返回一张渐变示意图,它会一路流进成片。v12.427 让**导演台**
 * 知道了这件事,但实测四条导出路径(export / export-aaf / export-edl / export-jianying)
 * 里搜不到任何相关判断 —— **用户把片子导出去交给客户时,系统一句话都不会提醒**
 * 里面混着占位画面。这是整条链路上唯一一处「会把有问题的成品交到别人手里」的地方。
 *
 * ## 告知,不禁止
 *
 * 不拦导出。用户完全可能就是要导一版草稿去对需求 —— 拦住等于替他做决定。
 * 要做的是让他**在导出的那一刻知道**,而不是等客户看片时才发现。
 * 这和 v12.427 对就绪判定的处理是同一条原则:如实告知,不挡路。
 *
 * ## 为什么单独成模块
 *
 * 四条路径的产物形态完全不同(mp4 二进制 / AAF 二进制 / EDL 文本 / 剪映 JSON),
 * 各自实现必然漂成四套口径。这里出**一份结论 + 两种载体**:
 *   · 响应头 —— 二进制附件也能带,机器可读;
 *   · 人读的一句话 —— 放进 JSON 响应或前端提示。
 */

import { isPlaceholderAsset, PLACEHOLDER_LABEL, type PlaceholderCheckable } from './placeholder-provenance';

/** 参与审计的资产行。兼容原始库行(data 是字符串)与接口层已解析的行。 */
export interface AuditableAsset extends PlaceholderCheckable {
  type?: string;
  shot_number?: number | null;
  shotNumber?: number | null;
}

export interface ExportAudit {
  /** 参与交付的资产条数 */
  total: number;
  /** 其中是示意图的条数 */
  placeholders: number;
  /** 涉及的镜号,去重升序;取不到镜号的不计入(但仍计进 placeholders) */
  shots: number[];
  /** 按资产类型分布,便于定位是分镜还是成片 */
  byType: Record<string, number>;
}

const shotOf = (a: AuditableAsset): number | null => {
  const n = a.shotNumber ?? a.shot_number;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export function auditAssetsForExport(assets: Array<AuditableAsset | null | undefined>): ExportAudit {
  const shots = new Set<number>();
  const byType: Record<string, number> = {};
  let placeholders = 0;
  let total = 0;

  for (const a of assets) {
    if (!a) continue;
    total++;
    if (!isPlaceholderAsset(a)) continue;
    placeholders++;
    const t = a.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    const n = shotOf(a);
    if (n !== null) shots.add(n);
  }

  return { total, placeholders, shots: [...shots].sort((x, y) => x - y), byType };
}

/**
 * 响应头载体 —— 二进制附件(mp4 / AAF)没法塞 JSON,只能走头。
 *
 * 值必须是 ASCII:HTTP 头对非 ASCII 的处理各家不一,中文放进去可能被截断或乱码。
 * 所以头里只放数字和镜号,人读的那句话走 `exportAuditNote()`。
 */
export function exportAuditHeaders(a: ExportAudit): Record<string, string> {
  const h: Record<string, string> = {
    'X-QFMJ-Placeholder-Count': String(a.placeholders),
    'X-QFMJ-Asset-Count': String(a.total),
  };
  // 镜号可能很多,头有长度上限 —— 只放前 50 个,并标明被截断过
  if (a.shots.length) {
    const shown = a.shots.slice(0, 50);
    h['X-QFMJ-Placeholder-Shots'] = shown.join(',') + (a.shots.length > shown.length ? ',…' : '');
  }
  return h;
}

/** 人读的一句话;没有示意图时返回 null(**不说话**,免得变成每次都响的告警)。 */
export function exportAuditNote(a: ExportAudit): string | null {
  if (a.placeholders <= 0) return null;
  const where = a.shots.length
    ? `第 ${a.shots.slice(0, 12).join('、')}${a.shots.length > 12 ? ' 等' : ''} 镜`
    : '部分素材';
  return `注意:本次交付包含 ${a.placeholders} 张${PLACEHOLDER_LABEL}(${where})——`
    + `这些画面引擎当时没出成,重生对应镜头即可替换。`;
}
