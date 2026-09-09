/**
 * v12.429 —— 交付前审计:别把示意图当成片交出去。
 *
 * 「示意图」= 图像引擎全部失败时返回的渐变占位图。v12.427 让导演台知情了,
 * 但实测四条导出路径 + 六条发布路径**全部对它无感** ——
 * 用户把片子导出去交给客户、甚至自动发到抖音/小红书时,系统一句话都不会提醒。
 * 这是整条链路上唯一一处「会把有问题的成品交到别人手里」的地方。
 *
 * 原则和 v12.427 一致:**如实告知,不挡路**。用户完全可能就是要导一版草稿去对需求,
 * 拦住等于替他做决定;要做的是让他**在交付的那一刻知道**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditAssetsForExport, exportAuditHeaders, exportAuditNote,
} from '../lib/export-audit';
import { PLACEHOLDER_PROVENANCE } from '../lib/placeholder-provenance';
import { buildEDL, buildFCPXML } from '../lib/edl-export';

const REAL = '/api/serve-file?key=9ff8299a6a82c4236029cebd106af478';
const MOCK = 'http://localhost:3000/api/mock-assets/image/2cf3b3d1.svg?label=Shot%201';
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

describe('v12.429 审计本身', () => {
  it('数出示意图条数与镜号,镜号去重升序', () => {
    const a = auditAssetsForExport([
      { type: 'storyboard', shot_number: 3, media_urls: JSON.stringify([MOCK]) },
      { type: 'storyboard', shot_number: 1, media_urls: JSON.stringify([MOCK]) },
      { type: 'storyboard', shot_number: 1, media_urls: JSON.stringify([MOCK]) },
      { type: 'video', shot_number: 2, mediaUrls: [REAL] },
    ]);
    expect(a.total).toBe(4);
    expect(a.placeholders).toBe(3);
    expect(a.shots).toEqual([1, 3]);
    expect(a.byType).toEqual({ storyboard: 3 });
  });

  it('原始库行(data 是 JSON 字符串)也认显式标记', () => {
    // 导出路径走 listAssetsByType,拿到的 data 就是字符串。
    // 只认对象的话,「显式标记优先」会在最需要它的地方失效(实测踩过)。
    const a = auditAssetsForExport([
      { type: 'video', shot_number: 1, data: JSON.stringify({ provenance: PLACEHOLDER_PROVENANCE }), media_urls: JSON.stringify([REAL]) },
    ]);
    expect(a.placeholders).toBe(1);
  });

  it('全是真产物时一个字都不说 —— 总在响的告警等于没有告警', () => {
    const a = auditAssetsForExport([{ type: 'video', shot_number: 1, mediaUrls: [REAL] }]);
    expect(a.placeholders).toBe(0);
    expect(exportAuditNote(a)).toBeNull();
  });

  it('响应头只放 ASCII —— 中文放进 HTTP 头各家处理不一,会截断或乱码', () => {
    const a = auditAssetsForExport([{ type: 'storyboard', shot_number: 7, media_urls: JSON.stringify([MOCK]) }]);
    const h = exportAuditHeaders(a);
    for (const [k, v] of Object.entries(h)) {
      expect(`${k}${v}`, `${k} 含非 ASCII`).toMatch(/^[\x20-\x7E]*$/);
    }
    expect(h['X-QFMJ-Placeholder-Count']).toBe('1');
    expect(h['X-QFMJ-Placeholder-Shots']).toBe('7');
  });

  it('镜号很多时头要截断并标明 —— HTTP 头有长度上限', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      type: 'storyboard', shot_number: i + 1, media_urls: JSON.stringify([MOCK]),
    }));
    const h = exportAuditHeaders(auditAssetsForExport(many));
    expect(h['X-QFMJ-Placeholder-Shots']).toContain('…');
    expect(h['X-QFMJ-Placeholder-Shots'].split(',').length).toBeLessThanOrEqual(51);
  });
});

describe('v12.429 告警要写进产物本身,不能只挂响应头', () => {
  const shots = [{ name: 'S1', durationS: 5 }] as any;

  it('EDL 用 CMX3600 的 * 注释行 —— 文件几小时后才在 NLE 里打开,那时响应头早没了', () => {
    const out = buildEDL(shots, 24, 'T', [], [], '注意:包含 2 张示意图');
    expect(out).toContain('* 注意:包含 2 张示意图');
  });

  it('FCPXML 用 <comments> 标准字段', () => {
    const out = buildFCPXML(shots, 24, 'T', [], [], '注意:包含 2 张示意图');
    expect(out).toContain('<comments>');
    expect(out).toContain('注意:包含 2 张示意图');
  });

  it('没有告警时产物里不留任何痕迹', () => {
    expect(buildEDL(shots, 24, 'T', [], [], null)).not.toContain('* 注意');
    expect(buildFCPXML(shots, 24, 'T', [], [], null)).not.toContain('<comments>');
  });

  it('注释不能破坏 EDL 结构 —— 每行都得以 * 起头', () => {
    const out = buildEDL(shots, 24, 'T', [], [], '第一行\n第二行');
    const noted = out.split('\n').filter((l) => l.includes('第一行') || l.includes('第二行'));
    expect(noted).toHaveLength(2);
    for (const l of noted) expect(l.startsWith('* ')).toBe(true);
  });
});

describe('v12.429 交付出口确实都接上了', () => {
  it('四条导出路径都算了审计', () => {
    for (const f of [
      'app/api/projects/[id]/export/route.ts',
      'app/api/projects/[id]/export-aaf/route.ts',
      'app/api/projects/[id]/export-edl/route.ts',
      'app/api/projects/[id]/export-jianying/route.ts',
    ]) {
      expect(read(f), `${f} 没接审计`).toContain('auditAssetsForExport');
    }
  });

  it('二进制产物走响应头,JSON 产物走人读的话', () => {
    // mp4 / AAF 塞不进 JSON,只能走头
    expect(read('app/api/projects/[id]/export/route.ts')).toContain('exportAuditHeaders');
    expect(read('app/api/projects/[id]/export-aaf/route.ts')).toContain('exportAuditHeaders');
    // 剪映草稿是 JSON,能直接带话
    expect(read('app/api/projects/[id]/export-jianying/route.ts')).toMatch(/\bplaceholderAudit:/);
  });

  it('EDL/FCPXML 的告警真的传进了 builder,不只是算出来放着', () => {
    // 只断言「文件里有 auditAssetsForExport」是不够的:把 builder 的 note 实参删掉,
    // 那个字样依然在(实测这条变异没转红)。锚到**调用点**本身。
    const src = read('app/api/projects/[id]/export-edl/route.ts');
    expect(src, 'EDL 没把告警传进产物').toMatch(/buildEDL\([^)]*exportAuditNote\(/);
    expect(src, 'FCPXML 没把告警传进产物').toMatch(/buildFCPXML\([^)]*exportAuditNote\(/);
  });

  it('发布预检查内容,不只查技术指标 —— 发出去就收不回来了', () => {
    const src = read('app/api/projects/[id]/publish-preflight/route.ts');
    // 用词边界:toContain('contentAudit') 连 `_contentAudit` 都会放行(实测)
    expect(src, '预检响应里没有 contentAudit 字段').toMatch(/(^|[^\w])contentAudit:/m);
    expect(src).toContain('auditAssetsForExport');
  });
});
