/**
 * lib/audit-markdown 单元测试 —— 锁死导演/编剧看到的报告格式。
 *
 * 为什么要这么多断言:
 *   市场部/制片看的是这个 .md, 不是 JSON。模版如果被静默改错 (比如
 *   某个 emoji 标题被删, 或者表格列错位), 他们会在飞书里看到一坨
 *   崩掉的内容。用 fixture 锁死关键结构。
 */

import { describe, it, expect } from 'vitest';
import { auditToMarkdown } from '@/lib/audit-markdown';
import type { PolishAudit } from '@/components/polish/IndustryAuditCard';

const FULL_AUDIT: PolishAudit = {
  hook: { strength: 'strong', at3s: '少女从阁楼窗口纵身跃下', rationale: '强反差 + 悬念' },
  actStructure: {
    incitingIncident: '父亲失踪',
    midpoint: '她发现账本里的线索',
    climax: '地下仓库对峙',
    resolution: '烧掉账本',
    missingBeats: ['Theme Stated 主题未点', 'Dark Night of the Soul 低谷不够'],
  },
  dialogueIssues: {
    onTheNoseLines: ['我真的好恨你', '我好伤心'],
    abstractEmotionLines: ['她感到绝望'],
  },
  characterAnchors: [
    { name: '林小满', visualLock: '黑长直 · 瓜子脸 · 棕眼 · 素白校服', speechStyle: '短促 · 冷', arc: 'want 复仇 / need 原谅 / flaw 偏执' },
  ],
  sceneLighting: [
    { scene: '阁楼黄昏', lightDirection: '侧逆光', quality: '硬光', colorTemp: '暖黄 3200K', mood: '压抑' },
  ],
  continuityAnchors: ['第 3→4 场: 账本放在桌角 → 下一场阳光压在账本上'],
  styleProfile: {
    genre: '年代文艺悬疑',
    tone: '克制苍凉',
    rhythm: '慢热铺垫 + 三幕骤升',
    artDirection: '70 年代胶片质感 · 冷蓝夜景',
  },
  aigcReadiness: { score: 82, reasoning: '三要素齐备, 缺主题一句' },
  issues: [
    { severity: 'critical', category: 'structure', text: '第二幕中点缺失', where: '全片' },
    { severity: 'minor', category: 'dialogue', text: '对白有 3 处直抒', where: '第 2 场' },
    { severity: 'major', category: 'aigc', text: '角色 identity 未复述', where: '第 5 场起' },
  ],
};

describe('auditToMarkdown · Pro 完整报告', () => {
  const md = auditToMarkdown({
    projectTitle: '江南寻味',
    mode: 'pro',
    style: '文艺',
    intensity: '重度',
    focus: '第一人称',
    model: 'claude-sonnet-4-20250514',
    at: '2025-10-15T10:00:00Z',
    polished: '第一幕\n小满推开门...\n',
    summary: '修了三处直抒 + 加了 Hook',
    notes: ['删"我恨你"', '加阁楼视觉钩', '锁林小满的脸'],
    audit: FULL_AUDIT,
  });

  it('contains project title in H1', () => {
    expect(md).toMatch(/^# 《江南寻味》/m);
  });

  it('has metadata block with mode / style / intensity / model', () => {
    expect(md).toContain('**模式**: Pro · 行业级');
    expect(md).toContain('**风格**: 文艺');
    expect(md).toContain('**力度**: 重度');
    expect(md).toContain('**特别要求**: 第一人称');
    expect(md).toContain('`claude-sonnet-4-20250514`');
  });

  it('renders summary as quote', () => {
    expect(md).toMatch(/## 📌 改动要点\n\n> 修了三处直抒/);
  });

  it('renders notes as ordered list', () => {
    expect(md).toMatch(/## ✏️ 具体调整 \(3\)/);
    expect(md).toMatch(/^1\. 删"我恨你"$/m);
    expect(md).toMatch(/^3\. 锁林小满的脸$/m);
  });

  it('renders AIGC readiness with score + emoji + level', () => {
    // 82 → green (>=85 是 green, 65-84 amber; 82 是 amber)
    expect(md).toContain('## 🟡 AIGC 管线就绪度: **82 / 100**');
    expect(md).toContain('基本就绪');
  });

  it('renders style profile as table', () => {
    expect(md).toContain('## 🎨 风格画像');
    expect(md).toMatch(/\| 类型 \| 年代文艺悬疑 \|/);
    expect(md).toMatch(/\| 美术 \| 70 年代胶片质感 · 冷蓝夜景 \|/);
  });

  it('renders hook section with strength label', () => {
    expect(md).toContain('## ⚡ 前 3 秒 Hook');
    expect(md).toContain('**强度**: 强');
    expect(md).toContain('少女从阁楼窗口纵身跃下');
  });

  it('renders all three-act beats + missing beats list', () => {
    expect(md).toContain('**激励事件**: 父亲失踪');
    expect(md).toContain('**中点反转**: 她发现账本里的线索');
    expect(md).toContain('**高潮**: 地下仓库对峙');
    expect(md).toContain('**收尾**: 烧掉账本');
    expect(md).toContain('**缺失节拍 (2)**');
    expect(md).toContain('Theme Stated');
  });

  it('renders dialogue issues sections separately', () => {
    expect(md).toContain('## 💬 对白问题');
    expect(md).toContain('### 直抒胸臆 (建议改 subtext, 2)');
    expect(md).toContain('"我真的好恨你"');
    expect(md).toContain('### 抽象情绪 (建议画面化, 1)');
    expect(md).toContain('"她感到绝望"');
  });

  it('renders character anchors with their three lines', () => {
    expect(md).toContain('### 林小满');
    expect(md).toContain('**锁脸**: 黑长直 · 瓜子脸 · 棕眼 · 素白校服');
    expect(md).toContain('**话风**: 短促 · 冷');
    expect(md).toContain('**弧光**: want 复仇');
  });

  it('renders scene lighting as 5-col table', () => {
    expect(md).toContain('| 场景 | 光向 | 光质 | 色温 | 氛围 |');
    expect(md).toContain('| 阁楼黄昏 | 侧逆光 | 硬光 | 暖黄 3200K | 压抑 |');
  });

  it('sorts issues by severity (critical → major → minor)', () => {
    const criticalIdx = md.indexOf('第二幕中点缺失');
    const majorIdx = md.indexOf('角色 identity 未复述');
    const minorIdx = md.indexOf('对白有 3 处直抒');
    expect(criticalIdx).toBeGreaterThan(0);
    expect(criticalIdx).toBeLessThan(majorIdx);
    expect(majorIdx).toBeLessThan(minorIdx);
  });

  it('wraps polished text in collapsible details block', () => {
    expect(md).toContain('<details>');
    expect(md).toContain('<summary>点击展开查看完整剧本</summary>');
    expect(md).toContain('小满推开门');
    expect(md).toContain('</details>');
  });

  it('ends with a footer signature', () => {
    expect(md.trim().endsWith('_本报告由 AI Comic Studio · Polish Studio Pro 生成_')).toBe(true);
  });
});

describe('auditToMarkdown · Basic (no audit)', () => {
  it('renders summary + notes + polished but skips all audit sections', () => {
    const md = auditToMarkdown({
      mode: 'basic',
      polished: '第一幕\n...',
      summary: '调了语气',
      notes: ['换了形容词'],
      audit: null,
    });
    expect(md).toContain('## 📌 改动要点');
    expect(md).toContain('## ✏️ 具体调整 (1)');
    expect(md).toContain('## 📄 润色后全文');
    // Basic 模式不应出现任何 Pro audit 的标题
    expect(md).not.toMatch(/AIGC 管线就绪度/);
    expect(md).not.toMatch(/前 3 秒 Hook/);
    expect(md).not.toMatch(/角色 Identity 锚点/);
  });
});

describe('auditToMarkdown · 边界情况', () => {
  it('skips empty sections gracefully', () => {
    const md = auditToMarkdown({
      mode: 'pro',
      polished: 'short',
      audit: {
        hook: null,
        actStructure: null,
        dialogueIssues: null,
        characterAnchors: [],
        sceneLighting: [],
        continuityAnchors: [],
        styleProfile: null,
        aigcReadiness: null,
        issues: [],
      },
    });
    // 所有 audit 子 section 都应被跳过, 不应出现空标题
    expect(md).not.toContain('## ⚡');
    expect(md).not.toContain('## 🎬');
    expect(md).not.toContain('## 💬');
    expect(md).not.toContain('## 👥');
    expect(md).not.toContain('## 💡');
    expect(md).not.toContain('## 🎭');
    // 仍然应该有润色正文
    expect(md).toContain('## 📄 润色后全文');
  });

  it('escapes pipe characters in table cells', () => {
    const md = auditToMarkdown({
      mode: 'pro',
      audit: {
        hook: null, actStructure: null, dialogueIssues: null,
        characterAnchors: [], continuityAnchors: [], issues: [],
        sceneLighting: [{
          scene: '窗外有 | 分隔符',
          lightDirection: '侧', quality: '柔', colorTemp: '冷蓝', mood: '冷',
        }],
        styleProfile: null, aigcReadiness: null,
      },
    });
    // | 应被转义为 \| 保持表格结构
    expect(md).toContain('窗外有 \\| 分隔符');
  });
});
