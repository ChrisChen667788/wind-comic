/**
 * lib/polish-docx — Polish 结果导出为 .doc (Word 原生 HTML 格式)
 *
 * 不引入 docx npm 依赖, 用的是微软 Office 早就支持的 "Word HTML" 模式:
 * 一个带特殊 namespace + meta charset 的 HTML 文件, 后缀写 .doc,
 * Word / WPS / Pages / Google Docs 都能原生识别为 Word 文档,
 * 字体 / 标题 / 表格 / 列表样式全部保留。
 *
 * 触发场景: 导演/编剧需要把润色结果发给制片或纸质化排印用 Word 二次编辑,
 *           Markdown 不直接给, 但 Word 是行业标准。
 */

import type { PolishAudit } from '@/components/polish/IndustryAuditCard';

export interface PolishDocxOptions {
  projectTitle?: string;
  mode?: 'basic' | 'pro';
  style?: string | null;
  intensity?: string | null;
  focus?: string | null;
  model?: string;
  at?: string;
  polished: string;
  summary?: string;
  notes?: string[];
  audit?: PolishAudit | null;
}

/** 把字符串里的 HTML 控制字符转义, 防止用户文本破坏文档结构 */
function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把多段正文里的换行变成 <br/>, 保留段落感 */
function escMultiline(s: string | undefined | null): string {
  if (!s) return '';
  return esc(s).replace(/\n/g, '<br/>');
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: '❗ 严重',
  major: '⚠️ 重要',
  minor: '· 建议',
};

const HOOK_LABEL: Record<string, string> = { weak: '弱', ok: '中', strong: '强' };

export function buildPolishDocxHtml(opt: PolishDocxOptions): string {
  const t = opt.projectTitle ? `《${esc(opt.projectTitle)}》润色 & 行业体检报告` : '剧本润色 & 行业体检报告';
  const buf: string[] = [];

  buf.push(
    `<html xmlns:o="urn:schemas-microsoft-com:office:office"
           xmlns:w="urn:schemas-microsoft-com:office:word"
           xmlns="http://www.w3.org/TR/REC-html40">`,
    `<head>`,
    `<meta charset="utf-8"/>`,
    `<meta name="ProgId" content="Word.Document"/>`,
    `<meta name="Generator" content="AI Comic Studio · Polish Studio Pro"/>`,
    `<title>${t}</title>`,
    `<style>
      body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.7; }
      h1 { font-size: 22pt; color: #2d1a55; border-bottom: 2px solid #6b46c1; padding-bottom: 6px; }
      h2 { font-size: 14pt; color: #4c2a85; margin-top: 18pt; border-left: 4px solid #6b46c1; padding-left: 10px; }
      h3 { font-size: 12pt; color: #553c9a; }
      .meta { background: #f6f3ff; padding: 10px 14px; border-radius: 4px; font-size: 10pt; line-height: 1.8; color: #4a4458; }
      .meta b { color: #2d1a55; }
      blockquote { border-left: 3px solid #d4a017; background: #fffbeb; padding: 8px 14px; margin: 6px 0; color: #6b4f0e; font-style: italic; }
      table { border-collapse: collapse; width: 100%; margin: 6px 0 14px; }
      th { background: #ede9fe; color: #2d1a55; text-align: left; padding: 6px 10px; border: 1px solid #c4b5fd; font-size: 10pt; }
      td { padding: 6px 10px; border: 1px solid #e5e0f5; font-size: 10pt; vertical-align: top; }
      ol, ul { margin: 4px 0 12px 18px; }
      li { margin: 2px 0; }
      .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 9pt; margin-right: 4px; }
      .pill-red { background: #fee2e2; color: #991b1b; }
      .pill-amber { background: #fef3c7; color: #92400e; }
      .pill-green { background: #d1fae5; color: #065f46; }
      .scriptbox { font-family: "Source Han Sans", "PingFang SC", monospace; font-size: 10pt; background: #faf9ff; border: 1px solid #ddd6fe; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
      .footer { margin-top: 22pt; color: #7c7290; font-size: 9pt; text-align: center; border-top: 1px solid #ddd6fe; padding-top: 8px; }
    </style>`,
    `</head>`,
    `<body>`,
    `<h1>${t}</h1>`,
  );

  // 元数据块
  const metaParts: string[] = [];
  if (opt.mode) metaParts.push(`<b>模式</b>: ${opt.mode === 'pro' ? 'Pro · 行业级' : 'Basic'}`);
  if (opt.style) metaParts.push(`<b>风格</b>: ${esc(opt.style)}`);
  if (opt.intensity) metaParts.push(`<b>力度</b>: ${esc(opt.intensity)}`);
  if (opt.focus) metaParts.push(`<b>特别要求</b>: ${esc(opt.focus)}`);
  if (opt.model) metaParts.push(`<b>模型</b>: <code>${esc(opt.model)}</code>`);
  if (opt.at) {
    try { metaParts.push(`<b>生成时间</b>: ${new Date(opt.at).toLocaleString('zh-CN')}`); }
    catch { /* skip invalid */ }
  }
  if (metaParts.length) {
    buf.push(`<div class="meta">${metaParts.join(' &nbsp;·&nbsp; ')}</div>`);
  }

  // 改动要点
  if (opt.summary) {
    buf.push(`<h2>📌 改动要点</h2>`, `<blockquote>${escMultiline(opt.summary)}</blockquote>`);
  }

  // 具体调整
  if (opt.notes && opt.notes.length > 0) {
    buf.push(`<h2>✏️ 具体调整 (${opt.notes.length})</h2>`, `<ol>`);
    opt.notes.forEach((n) => buf.push(`<li>${escMultiline(n)}</li>`));
    buf.push(`</ol>`);
  }

  // ── Pro audit ──
  if (opt.audit) {
    const a = opt.audit;

    if (a.aigcReadiness) {
      const sc = a.aigcReadiness.score ?? 0;
      const cls = sc >= 85 ? 'pill-green' : sc >= 65 ? 'pill-amber' : 'pill-red';
      buf.push(
        `<h2>🎯 AIGC 管线就绪度</h2>`,
        `<p><span class="pill ${cls}">${sc} / 100</span> ${esc(a.aigcReadiness.reasoning)}</p>`,
      );
    }

    if (a.styleProfile) {
      const s = a.styleProfile;
      const rows = [
        ['类型', s.genre], ['基调', s.tone], ['节奏', s.rhythm], ['美术', s.artDirection],
      ].filter(([, v]) => !!v);
      if (rows.length) {
        buf.push(`<h2>🎨 风格画像</h2>`, `<table><tr><th>维度</th><th>描述</th></tr>`);
        rows.forEach(([k, v]) => buf.push(`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`));
        buf.push(`</table>`);
      }
    }

    if (a.hook) {
      buf.push(
        `<h2>⚡ 前 3 秒 Hook</h2>`,
        `<p><b>强度</b>: ${HOOK_LABEL[a.hook.strength] || esc(a.hook.strength)}</p>`,
      );
      if (a.hook.at3s) buf.push(`<p><b>3 秒内呈现</b>: ${esc(a.hook.at3s)}</p>`);
      if (a.hook.rationale) buf.push(`<p><i>${esc(a.hook.rationale)}</i></p>`);
    }

    if (a.actStructure) {
      buf.push(`<h2>🎬 三幕结构 · Save the Cat 节拍</h2>`, `<ul>`);
      if (a.actStructure.incitingIncident) buf.push(`<li><b>激励事件</b>: ${esc(a.actStructure.incitingIncident)}</li>`);
      if (a.actStructure.midpoint) buf.push(`<li><b>中点反转</b>: ${esc(a.actStructure.midpoint)}</li>`);
      if (a.actStructure.climax) buf.push(`<li><b>高潮</b>: ${esc(a.actStructure.climax)}</li>`);
      if (a.actStructure.resolution) buf.push(`<li><b>收尾</b>: ${esc(a.actStructure.resolution)}</li>`);
      buf.push(`</ul>`);
      if (a.actStructure.missingBeats?.length) {
        buf.push(`<h3>缺失节拍 (${a.actStructure.missingBeats.length})</h3>`, `<ul>`);
        a.actStructure.missingBeats.forEach((b) => buf.push(`<li>${esc(b)}</li>`));
        buf.push(`</ul>`);
      }
    }

    if (a.dialogueIssues) {
      const d = a.dialogueIssues;
      if (d.onTheNoseLines.length > 0 || d.abstractEmotionLines.length > 0) {
        buf.push(`<h2>💬 对白问题</h2>`);
        if (d.onTheNoseLines.length) {
          buf.push(`<h3>直抒胸臆 (${d.onTheNoseLines.length})</h3>`, `<ul>`);
          d.onTheNoseLines.forEach((l) => buf.push(`<li>"${esc(l)}"</li>`));
          buf.push(`</ul>`);
        }
        if (d.abstractEmotionLines.length) {
          buf.push(`<h3>抽象情绪 (${d.abstractEmotionLines.length})</h3>`, `<ul>`);
          d.abstractEmotionLines.forEach((l) => buf.push(`<li>"${esc(l)}"</li>`));
          buf.push(`</ul>`);
        }
      }
    }

    if (a.characterAnchors && a.characterAnchors.length > 0) {
      buf.push(`<h2>👥 角色 Identity 锚点</h2>`);
      a.characterAnchors.forEach((c) => {
        buf.push(`<h3>${esc(c.name)}</h3>`, `<ul>`);
        if (c.visualLock) buf.push(`<li><b>锁脸</b>: ${esc(c.visualLock)}</li>`);
        if (c.speechStyle) buf.push(`<li><b>话风</b>: ${esc(c.speechStyle)}</li>`);
        if (c.arc) buf.push(`<li><b>弧光</b>: ${esc(c.arc)}</li>`);
        buf.push(`</ul>`);
      });
    }

    if (a.sceneLighting && a.sceneLighting.length > 0) {
      buf.push(`<h2>💡 场景光影表</h2>`,
        `<table><tr><th>场景</th><th>光向</th><th>光质</th><th>色温</th><th>氛围</th></tr>`);
      a.sceneLighting.forEach((s) => {
        buf.push(
          `<tr><td>${esc(s.scene)}</td><td>${esc(s.lightDirection || '—')}</td><td>${esc(s.quality || '—')}</td><td>${esc(s.colorTemp || '—')}</td><td>${esc(s.mood || '—')}</td></tr>`
        );
      });
      buf.push(`</table>`);
    }

    if (a.continuityAnchors && a.continuityAnchors.length > 0) {
      buf.push(`<h2>⚓ 跨镜一致性钩子</h2>`, `<ol>`);
      a.continuityAnchors.forEach((c) => buf.push(`<li>${esc(c)}</li>`));
      buf.push(`</ol>`);
    }

    if (a.issues && a.issues.length > 0) {
      const order = { critical: 0, major: 1, minor: 2 } as Record<string, number>;
      const sorted = [...a.issues].sort((x, y) => (order[x.severity] ?? 9) - (order[y.severity] ?? 9));
      buf.push(`<h2>🎭 问题清单 (${a.issues.length})</h2>`, `<ul>`);
      sorted.forEach((it) => {
        const sev = SEVERITY_LABEL[it.severity] || it.severity;
        buf.push(`<li><b>${esc(sev)}</b> · ${esc(it.category)} ${it.where ? `· <code>${esc(it.where)}</code>` : ''}<br/>${esc(it.text)}</li>`);
      });
      buf.push(`</ul>`);
    }
  }

  // 润色后正文
  if (opt.polished) {
    buf.push(
      `<h2>📄 润色后全文</h2>`,
      `<div class="scriptbox">${escMultiline(opt.polished)}</div>`,
    );
  }

  buf.push(
    `<div class="footer">本报告由 AI Comic Studio · Polish Studio Pro 生成</div>`,
    `</body></html>`,
  );

  return buf.join('\n');
}
