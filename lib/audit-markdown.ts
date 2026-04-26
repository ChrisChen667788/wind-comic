/**
 * 把 Polish Pro 的 audit + 润色正文序列化成一份可以直接发给团队的 Markdown 体检报告。
 *
 * 为什么要独立成 lib:
 *   1. 可被测试 (snapshot 锁定输出格式, 防止迭代时不小心把导演看习惯的结构改了)
 *   2. 未来可能除了 polish 页的"导出 .md 按钮", Agent 管线的 Editor / Producer 也想生成类似报告
 *
 * 设计原则:
 *   - 遵循 GFM 常见语法 (标题 / 表格 / 列表 / 引用), 飞书/Notion/GitHub 都能原生渲染
 *   - 缺字段优雅跳过, 不渲染空 section
 *   - 前言区有 metadata block, 让团队一眼知道是哪次跑的哪个项目
 */

import type { PolishAudit } from '@/components/polish/IndustryAuditCard';
import { readinessLevel } from './polish-prompts';

export interface AuditMarkdownOptions {
  /** 项目/剧本名, 不给就不写项目名 */
  projectTitle?: string;
  /** 模式 (basic 也能导, 但没 audit 就只含 polished) */
  mode?: 'basic' | 'pro';
  style?: string | null;
  intensity?: string | null;
  focus?: string | null;
  /** 模型名 (展示用) */
  model?: string;
  /** 跑的时间 (ISO 或空) */
  at?: string;
  /** 润色后的剧本全文 */
  polished?: string;
  /** 50 字左右的改动要点 */
  summary?: string;
  /** 具体改动点 */
  notes?: string[];
  /** Pro 模式行业 audit (可空) */
  audit?: PolishAudit | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: '❗ 严重',
  major: '⚠️ 重要',
  minor: '· 建议',
};
const CATEGORY_LABEL: Record<string, string> = {
  pacing: '节奏',
  dialogue: '对白',
  structure: '结构',
  character: '角色',
  aigc: 'AIGC',
  other: '其他',
};
const HOOK_LABEL: Record<string, string> = { weak: '弱', ok: '中', strong: '强' };

export function auditToMarkdown(opt: AuditMarkdownOptions): string {
  const lines: string[] = [];

  // 标题 + metadata block
  const title = opt.projectTitle ? `《${opt.projectTitle}》润色 & 行业体检报告` : '剧本润色 & 行业体检报告';
  lines.push(`# ${title}`, '');

  const meta: string[] = [];
  if (opt.mode) meta.push(`- **模式**: ${opt.mode === 'pro' ? 'Pro · 行业级' : 'Basic'}`);
  if (opt.style) meta.push(`- **风格**: ${opt.style}`);
  if (opt.intensity) meta.push(`- **力度**: ${opt.intensity}`);
  if (opt.focus) meta.push(`- **特别要求**: ${opt.focus}`);
  if (opt.model) meta.push(`- **模型**: \`${opt.model}\``);
  if (opt.at) {
    try { meta.push(`- **生成时间**: ${new Date(opt.at).toLocaleString('zh-CN')}`); }
    catch { /* ignore invalid date */ }
  }
  if (meta.length) {
    lines.push(...meta, '');
  }

  // 改动要点
  if (opt.summary) {
    lines.push('## 📌 改动要点', '', `> ${opt.summary}`, '');
  }

  // 具体调整
  if (opt.notes && opt.notes.length > 0) {
    lines.push(`## ✏️ 具体调整 (${opt.notes.length})`, '');
    opt.notes.forEach((n, i) => lines.push(`${i + 1}. ${escapeMd(n)}`));
    lines.push('');
  }

  // ────── Pro audit ──────
  if (opt.audit) {
    const a = opt.audit;

    // AIGC 就绪度
    if (a.aigcReadiness) {
      const score = a.aigcReadiness.score ?? 0;
      const lvl = readinessLevel(score);
      const emoji = lvl.level === 'green' ? '🟢' : lvl.level === 'amber' ? '🟡' : '🔴';
      lines.push(
        `## ${emoji} AIGC 管线就绪度: **${score} / 100**`,
        '',
        `> ${lvl.label}`,
        '',
      );
      if (a.aigcReadiness.reasoning) {
        lines.push(escapeMd(a.aigcReadiness.reasoning), '');
      }
    }

    // 风格画像
    if (a.styleProfile) {
      const s = a.styleProfile;
      const rows: Array<[string, string]> = [
        ['类型', s.genre],
        ['基调', s.tone],
        ['节奏', s.rhythm],
        ['美术', s.artDirection],
      ].filter(([, v]) => !!v) as Array<[string, string]>;
      if (rows.length) {
        lines.push('## 🎨 风格画像', '');
        lines.push('| 维度 | 描述 |', '| --- | --- |');
        for (const [k, v] of rows) lines.push(`| ${k} | ${escapeCell(v)} |`);
        lines.push('');
      }
    }

    // Hook
    if (a.hook) {
      lines.push(
        '## ⚡ 前 3 秒 Hook',
        '',
        `- **强度**: ${HOOK_LABEL[a.hook.strength] || a.hook.strength}`,
      );
      if (a.hook.at3s) lines.push(`- **3 秒内呈现**: ${escapeMd(a.hook.at3s)}`);
      if (a.hook.rationale) lines.push(`- **评级理由**: _${escapeMd(a.hook.rationale)}_`);
      lines.push('');
    }

    // 三幕结构
    if (a.actStructure) {
      lines.push('## 🎬 三幕结构 · Save the Cat 节拍', '');
      if (a.actStructure.incitingIncident) lines.push(`- **激励事件**: ${escapeMd(a.actStructure.incitingIncident)}`);
      if (a.actStructure.midpoint) lines.push(`- **中点反转**: ${escapeMd(a.actStructure.midpoint)}`);
      if (a.actStructure.climax) lines.push(`- **高潮**: ${escapeMd(a.actStructure.climax)}`);
      if (a.actStructure.resolution) lines.push(`- **收尾**: ${escapeMd(a.actStructure.resolution)}`);
      if (a.actStructure.missingBeats?.length) {
        lines.push('', `**缺失节拍 (${a.actStructure.missingBeats.length})**:`);
        a.actStructure.missingBeats.forEach((b) => lines.push(`- ${escapeMd(b)}`));
      }
      lines.push('');
    }

    // 对白问题
    if (a.dialogueIssues) {
      const d = a.dialogueIssues;
      if (d.onTheNoseLines.length > 0 || d.abstractEmotionLines.length > 0) {
        lines.push('## 💬 对白问题', '');
        if (d.onTheNoseLines.length) {
          lines.push(`### 直抒胸臆 (建议改 subtext, ${d.onTheNoseLines.length})`, '');
          d.onTheNoseLines.forEach((l) => lines.push(`- "${escapeMd(l)}"`));
          lines.push('');
        }
        if (d.abstractEmotionLines.length) {
          lines.push(`### 抽象情绪 (建议画面化, ${d.abstractEmotionLines.length})`, '');
          d.abstractEmotionLines.forEach((l) => lines.push(`- "${escapeMd(l)}"`));
          lines.push('');
        }
      }
    }

    // 角色 identity 锚
    if (a.characterAnchors && a.characterAnchors.length > 0) {
      lines.push('## 👥 角色 Identity 锚点 · Cameo / Seedance 对齐', '');
      a.characterAnchors.forEach((c) => {
        lines.push(`### ${c.name}`, '');
        if (c.visualLock) lines.push(`- **锁脸**: ${escapeMd(c.visualLock)}`);
        if (c.speechStyle) lines.push(`- **话风**: ${escapeMd(c.speechStyle)}`);
        if (c.arc) lines.push(`- **弧光**: ${escapeMd(c.arc)}`);
        lines.push('');
      });
    }

    // 场景光影表
    if (a.sceneLighting && a.sceneLighting.length > 0) {
      lines.push('## 💡 场景光影表 · Prompt-ready', '');
      lines.push('| 场景 | 光向 | 光质 | 色温 | 氛围 |', '| --- | --- | --- | --- | --- |');
      a.sceneLighting.forEach((s) => {
        lines.push(
          `| ${escapeCell(s.scene)} | ${escapeCell(s.lightDirection) || '—'} | ${escapeCell(s.quality) || '—'} | ${escapeCell(s.colorTemp) || '—'} | ${escapeCell(s.mood) || '—'} |`
        );
      });
      lines.push('');
    }

    // 跨镜 continuity
    if (a.continuityAnchors && a.continuityAnchors.length > 0) {
      lines.push('## ⚓ 跨镜一致性钩子 · Keyframes 首尾帧衔接', '');
      a.continuityAnchors.forEach((c, i) => lines.push(`${i + 1}. ${escapeMd(c)}`));
      lines.push('');
    }

    // 问题清单 (按严重度排序)
    if (a.issues && a.issues.length > 0) {
      const order = { critical: 0, major: 1, minor: 2 } as Record<string, number>;
      const sorted = [...a.issues].sort((x, y) => (order[x.severity] ?? 9) - (order[y.severity] ?? 9));
      lines.push(`## 🎭 问题清单 (${a.issues.length})`, '');
      sorted.forEach((it) => {
        const sev = SEVERITY_LABEL[it.severity] || it.severity;
        const cat = CATEGORY_LABEL[it.category] || it.category;
        const where = it.where ? ` · \`${escapeCell(it.where)}\`` : '';
        lines.push(`- **${sev}** · ${cat}${where}  \n  ${escapeMd(it.text)}`);
      });
      lines.push('');
    }
  }

  // 润色后全文 (折叠 <details>, 默认不展开, 不塞爆视觉)
  if (opt.polished) {
    lines.push(
      '## 📄 润色后全文',
      '',
      '<details>',
      '<summary>点击展开查看完整剧本</summary>',
      '',
      '```',
      opt.polished,
      '```',
      '',
      '</details>',
      '',
    );
  }

  // footer
  lines.push('---', '', '_本报告由 AI Comic Studio · Polish Studio Pro 生成_', '');

  return lines.join('\n');
}

/**
 * 最小化转义 —— 防止用户正文里的 `#` / `|` / 反引号意外破坏 Markdown 结构。
 * 但不想过度转义, 因为我们希望 Markdown 仍然保有可读性。
 */
function escapeMd(s: string): string {
  if (!s) return '';
  // 只转义可能把 Markdown 搞坏的字符: 反斜杠 / 反引号
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

/** 表格单元格需要额外处理 | 和 换行 */
function escapeCell(s: string): string {
  if (!s) return '';
  return escapeMd(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
