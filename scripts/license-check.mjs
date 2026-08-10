#!/usr/bin/env node
/**
 * v12.226 — 生产依赖许可证门禁(CI 加固 · 🟠-17 / 🟡-22)。
 *
 * 为什么需要:本项目声明 MIT,但 `ffmpeg-static` 实际拉的是 **GPL-3.0-or-later** 的 FFmpeg 二进制。
 * 源码分发无碍(依赖非 vendored),但**打包分发(Docker 镜像等)会连带 GPL-3 义务** —— 这是
 * 企业采购/尽调必问的一条,不能靠"没人注意"过关。
 *
 * 本脚本做两件事:
 *   1. 扫**生产依赖树**(omit=dev)的每个包的 license 字段,挑出 copyleft(GPL/AGPL/LGPL/SSPL…);
 *   2. 对照**已登记豁免名单**(KNOWN_COPYLEFT):已知且已在 README/NOTICE 说明的放行;
 *      **出现名单外的新 copyleft 依赖 → 退出码 1**,把 CI 弄红,逼人工评估。
 *
 * 用法:node scripts/license-check.mjs        (CI 里跑,非零退出即阻断)
 *      node scripts/license-check.mjs --json (机读)
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

/**
 * 已登记的 copyleft 依赖(已在 README「许可证与分发」段说明其分发义务)。
 * 新增任何一项都必须同步更新 README —— 这是本门禁存在的意义。
 *
 * key 以 `*` 结尾表示**前缀匹配**:同一依赖的平台二进制在不同 OS 下包名不同
 * (lightningcss-linux-x64-gnu / @img/sharp-libvips-linux-arm64 …),逐个列举既冗长又会在
 * 换平台跑 CI 时漏网,故按族登记。
 */
const KNOWN_COPYLEFT = {
  'ffmpeg-static': {
    license: 'GPL-3.0-or-later',
    why: '【最强约束】FFmpeg 预编译二进制。源码分发不受影响;**打包分发(Docker/桌面端)须随附 GPL-3 全文与对应源码获取方式**,或改用系统 ffmpeg(设 FFMPEG_PATH)规避。',
  },
  'lightningcss*': {
    license: 'MPL-2.0',
    why: 'Next.js CSS 工具链依赖。MPL-2.0 为**文件级弱 copyleft**:原样使用/分发无额外义务;仅当你修改了其 MPL 源文件才需公开这些文件的源码。不传染本项目代码。',
  },
  '@img/sharp-libvips*': {
    license: 'LGPL-3.0-or-later',
    why: 'sharp 图像处理的 libvips 二进制。LGPL **动态链接使用不传染**;分发时须允许终端用户替换/重链该库,并提供该库源码获取途径。不影响本项目 MIT 授权。',
  },
};

/** 命中已登记名单(支持 `前缀*` 形式)。 */
function registeredEntry(name) {
  if (KNOWN_COPYLEFT[name]) return KNOWN_COPYLEFT[name];
  for (const [k, v] of Object.entries(KNOWN_COPYLEFT)) {
    if (k.endsWith('*') && name.startsWith(k.slice(0, -1))) return v;
  }
  return null;
}

const COPYLEFT_RE = /\b(AGPL|GPL|LGPL|SSPL|CDDL|EPL|MPL|OSL)\b/i;
// GPL 家族里 "LGPL" 弱 copyleft、动态链接通常可接受,但仍需登记可见
const ALLOWED_PERMISSIVE_RE = /^(MIT|ISC|BSD|Apache|Unlicense|CC0|0BSD|Python|BlueOak|WTFPL)/i;

function prodDependencyNames() {
  // 用 npm ls 拿真实生产依赖树(含传递依赖),避免手工遍历 node_modules 混入 devDeps
  let raw;
  try {
    raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // npm ls 在有 peer 冲突时会非零退出但仍吐出 JSON,取 stdout 继续
    raw = e.stdout?.toString() || '';
  }
  // v12.310:**门禁自己静默通过是最坏的一种失败**。
  // 原来这两处都 `return []` —— npm ls 输出被截断/畸形(node_modules 装了一半、磁盘满、
  // peer 冲突输出超 maxBuffer)时,扫描包数变 0,随后打印「✅ 未发现 copyleft 依赖」并 exit 0。
  // 于是一个新引入的 GPL 依赖可以**带着一个假的 CI 绿灯**进主干。空扫描必须是硬失败。
  if (!raw.trim()) {
    console.error('[license-check] FATAL: npm ls 无输出 —— 无法确认依赖树,拒绝以「通过」收场');
    process.exit(2);
  }
  let tree;
  try {
    tree = JSON.parse(raw);
  } catch (parseErr) {
    console.error(`[license-check] FATAL: npm ls JSON 解析失败:${parseErr instanceof Error ? parseErr.message : parseErr}`);
    console.error('           多半是 node_modules 不完整或输出被截断;修复安装后重跑,不要跳过本门禁。');
    process.exit(2);
  }

  const names = new Set();
  const walk = (node) => {
    const deps = node?.dependencies;
    if (!deps) return;
    for (const [name, sub] of Object.entries(deps)) {
      if (!names.has(name)) {
        names.add(name);
        walk(sub);
      }
    }
  };
  walk(tree);
  // 哨兵:生产依赖不可能是 0 个。扫到 0 说明上面的解析虽然没抛错,但拿到的不是有效依赖树。
  if (names.size === 0) {
    console.error('[license-check] FATAL: 解析出 0 个生产依赖 —— 依赖树异常,拒绝以「通过」收场');
    process.exit(2);
  }
  return [...names];
}

function licenseOf(pkgName) {
  const p = path.join(ROOT, 'node_modules', pkgName, 'package.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    if (typeof j.license === 'string') return j.license;
    if (j.license?.type) return j.license.type;
    if (Array.isArray(j.licenses)) return j.licenses.map((l) => l.type || l).join(' OR ');
    return null;
  } catch { return null; }
}

const names = prodDependencyNames();
const copyleft = [];
const unknown = [];

for (const name of names) {
  const lic = licenseOf(name);
  if (!lic) { unknown.push(name); continue; }
  if (COPYLEFT_RE.test(lic) && !ALLOWED_PERMISSIVE_RE.test(lic)) {
    copyleft.push({ name, license: lic, registered: Boolean(registeredEntry(name)) });
  }
}

const unregistered = copyleft.filter((c) => !c.registered);

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned: names.length, copyleft, unregistered, unknownLicense: unknown }, null, 2));
} else {
  console.log(`[license-check] 扫描生产依赖 ${names.length} 个`);
  if (copyleft.length === 0) {
    console.log('[license-check] ✅ 未发现 copyleft 依赖');
  } else {
    console.log(`[license-check] 发现 copyleft 依赖 ${copyleft.length} 个:`);
    for (const c of copyleft) {
      const mark = c.registered ? '已登记 ✅' : '**未登记 ❌**';
      console.log(`  - ${c.name} : ${c.license}  [${mark}]`);
      if (c.registered) console.log(`      分发义务:${registeredEntry(c.name).why}`);
    }
  }
  if (unknown.length > 0) {
    console.log(`[license-check] ⚠️ ${unknown.length} 个包无 license 字段(通常为本地/占位包):${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ' …' : ''}`);
  }
}

if (unregistered.length > 0) {
  console.error(
    `\n[license-check] ❌ 阻断:发现 ${unregistered.length} 个**未登记**的 copyleft 生产依赖:` +
    `\n  ${unregistered.map((c) => `${c.name} (${c.license})`).join('\n  ')}` +
    `\n\n处理方式(二选一):` +
    `\n  A) 移除/替换该依赖;` +
    `\n  B) 确认可接受 → 加进 scripts/license-check.mjs 的 KNOWN_COPYLEFT,**并同步更新 README「许可证与分发」段**说明其分发义务。`,
  );
  process.exit(1);
}
process.exit(0);
