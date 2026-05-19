#!/usr/bin/env node
/**
 * v3.1.3 — ModelScope upload semi-auto helper.
 *
 * 因为 modelscope.cn 没有公开的"创建作品页"的 API (有的只是模型/数据集 SDK 上传),
 * 我们走"剪贴板 + 浏览器"半自动:
 *
 *   1. 脚本顺序读 docs/modelscope-profile.md 里的几个段
 *   2. 每段塞到 macOS pbcopy / Linux xclip 剪贴板
 *   3. 终端打印"现在打开 modelscope.cn/profile/haozi667788/create-studio,
 *      在 <字段名> 框里 cmd+V 粘"
 *   4. 你确认 (回车) 后进下一段
 *
 * 用法:
 *   node scripts/modelscope-upload-helper.mjs
 *   node scripts/modelscope-upload-helper.mjs --open    # 自动 open 浏览器到对应页
 *
 * 输出截图建议: assets/banner.png + screenshot-dashboard-v3.1.3 +
 * screenshot-cinema-timeline-v3.1.3 + screenshot-pacing-v3.1.3 — 都已在 repo.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const profileFile = path.join(projectRoot, 'docs', 'modelscope-profile.md');
const flagOpen = process.argv.includes('--open');

const MODELSCOPE_PROFILE_URL = 'https://www.modelscope.cn/profile/haozi667788';
const MODELSCOPE_CREATE_STUDIO_URL = 'https://www.modelscope.cn/studios/create';

// ─── Markdown section parser ────────────────────────────────────────────────
// 不复杂; 找 "## 一. xxx" / "### 中文版" 这种标题, 抽出后续直到下一个 ## / ### 为止的内容
function loadSections() {
  if (!fs.existsSync(profileFile)) {
    console.error(`[ms-helper] not found: ${profileFile}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(profileFile, 'utf-8');
  const lines = raw.split('\n');
  const sections = [];
  let current = null;
  for (const ln of lines) {
    // 三级标题或四级标题
    if (/^#{2,4}\s+/.test(ln)) {
      if (current) sections.push(current);
      current = { title: ln.replace(/^#{2,4}\s+/, '').trim(), body: [] };
    } else if (current) {
      current.body.push(ln);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function toClipboard(text) {
  // 优先 macOS pbcopy
  try {
    execFileSync('/usr/bin/pbcopy', { input: text });
    return true;
  } catch { /* not mac */ }
  // Linux xclip / wl-copy
  try {
    execFileSync('xclip', ['-selection', 'clipboard'], { input: text });
    return true;
  } catch { /* try wl */ }
  try {
    execFileSync('wl-copy', { input: text });
    return true;
  } catch { /* nope */ }
  return false;
}

function openUrl(url) {
  try {
    if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
    else if (process.platform === 'linux') spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' });
  } catch (e) {
    console.warn(`[ms-helper] cannot auto-open browser: ${e.message}`);
  }
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
}

// ─── Wizard steps ───────────────────────────────────────────────────────────
const STEPS = [
  {
    title: '步骤 1/8 · 项目名 (Studio 名 / Project Name)',
    body: 'Wind Comic 🌬️ — 多 Agent AI 漫剧流水线',
    instruction: '复制后, 浏览器 → ModelScope 个人主页 → 我创建的 → 创建 Studio/作品 → 名字框 cmd+V',
    autoUrl: flagOpen ? MODELSCOPE_CREATE_STUDIO_URL : null,
  },
  {
    title: '步骤 2/8 · Studio 简介 (Bio · 200 字以内)',
    sectionMatch: (s) => s.title === '中文版' && s.body.some((l) => l.includes('Wind Comic 🌬️')),
    instruction: '在"作品介绍"或"简介"字段粘贴',
  },
  {
    title: '步骤 3/8 · 长描述 (1000 字, 详细介绍)',
    sectionMatch: (s) => s.title.includes('长描述') || s.title.includes('五. 长描述'),
    bodyFilter: (body) => {
      // 抽出中文版长描述, 跳过英文部分
      const out = [];
      let inZh = false;
      for (const l of body) {
        if (/^### 中文版/.test(l)) { inZh = true; continue; }
        if (/^### English/.test(l)) { inZh = false; continue; }
        if (inZh) out.push(l);
      }
      return out.length > 0 ? out.join('\n') : body.join('\n');
    },
    instruction: '在 "详细介绍" 富文本区粘贴 (支持 markdown)',
  },
  {
    title: '步骤 4/8 · 项目卡 - Top 10 亮点 (英文 sub-section, 给国际访客看)',
    sectionMatch: (s) => /Wind Comic v3\.1\.3 \. English card/.test(s.title) || s.title === 'Wind Comic v3.1.3 · English card',
    instruction: '如果 ModelScope 支持双语 description, 切到 English tab 粘 (可选)',
  },
  {
    title: '步骤 5/8 · 标签 (tags)',
    body: '文生视频, 多 Agent, 短剧, 漫剧, Cinema, 协作工具, Next.js, TypeScript, Yjs, Minimax, Kling, Veo, OpenAI-compatible, FFmpeg, Web Audio API, 短视频创作, 内容营销, 漫画改编, 独立电影, 自托管',
    instruction: '在 tags 输入框逐个粘贴 (或一次粘整段, ModelScope 按逗号自动拆)',
  },
  {
    title: '步骤 6/8 · 许可证',
    body: 'MIT',
    instruction: '选择 MIT (或在 license 字段输入)',
  },
  {
    title: '步骤 7/8 · 仓库链接',
    body: 'https://github.com/ChrisChen667788/wind-comic',
    instruction: '粘贴到 GitHub 字段 / 项目主页字段',
  },
  {
    title: '步骤 8/8 · 截图上传',
    body: [
      'assets/banner.png',
      'assets/screenshot-dashboard-v3.1.3.png',
      'assets/screenshot-cinema-timeline-v3.1.3.png',
      'assets/screenshot-pacing-v3.1.3.png',
      'assets/screenshot-comments-v3.1.3.png',
    ].map((f) => path.join(projectRoot, f)).join('\n'),
    instruction: '把这 5 个文件路径分别用 Finder 上传到 ModelScope 的"封面/特色截图"区',
  },
];

(async () => {
  const sections = loadSections();
  console.log(`[ms-helper] loaded ${sections.length} markdown sections from docs/modelscope-profile.md\n`);
  console.log('============================================================');
  console.log('  ModelScope 半自动上传助手 (clipboard-based)');
  console.log(`  目标主页: ${MODELSCOPE_PROFILE_URL}`);
  console.log('============================================================\n');

  if (flagOpen) {
    console.log('[ms-helper] auto-opening modelscope.cn ...');
    openUrl(MODELSCOPE_PROFILE_URL);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    console.log(`\n━━━ ${step.title} ━━━`);
    let body = step.body;
    if (!body && step.sectionMatch) {
      const sec = sections.find(step.sectionMatch);
      if (sec) {
        body = step.bodyFilter ? step.bodyFilter(sec.body) : sec.body.join('\n');
      } else {
        body = `(section not found — open ${profileFile} and copy manually)`;
      }
    }
    body = (body || '').trim();
    const preview = body.length > 200 ? body.slice(0, 200) + ' …' : body;
    console.log(`\n  ➜  内容预览 (前 200 字):\n${preview.split('\n').map((l) => '     ' + l).join('\n')}\n`);
    const ok = toClipboard(body);
    if (ok) {
      console.log('  ✓  已复制到剪贴板 (' + body.length + ' chars)');
    } else {
      console.log('  ✗  剪贴板工具不可用 (没 pbcopy/xclip/wl-copy). 手动从 docs/modelscope-profile.md 复制');
    }
    console.log(`  ➜  ${step.instruction}`);
    if (step.autoUrl) {
      console.log(`  ➜  自动打开: ${step.autoUrl}`);
      openUrl(step.autoUrl);
    }
    const ans = await ask(rl, '\n  按回车继续下一步, 输 q 退出: ');
    if (ans === 'q' || ans === 'Q') {
      console.log('\n[ms-helper] 中止. 已完成的步骤无需重做.');
      rl.close();
      process.exit(0);
    }
  }

  console.log('\n============================================================');
  console.log('  全部 8 步完成! 在 ModelScope 网页点 "发布".');
  console.log('============================================================\n');
  console.log('  ✦ 后续运营:');
  console.log('    - 每个大版本 (v3.2/v3.3 etc) 上线后重新跑本脚本, 更新"长描述"+ 截图');
  console.log('    - 在评论区贴 GitHub releases 链接');
  console.log('    - 同步发到微博 / 即刻 / Twitter — docs/MARKETING-zh.md + MARKETING-en.md\n');
  rl.close();
})();
