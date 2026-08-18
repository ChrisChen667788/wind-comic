#!/usr/bin/env node
/**
 * v9.0.2b — 把 GitHub 主页 (README.md) 镜像成 ModelScope「介绍」可直接粘贴版.
 *
 * 为什么需要这一步: README 用相对路径 (assets/... · docs/... · README.zh-CN.md),
 * 在 GitHub 上能渲染, 但 ModelScope 介绍区解析不了相对路径 → 图全裂、链接全断.
 * 本脚本把:
 *   - 图片/资源 (src="assets/..." / ](assets/...)) → raw.githubusercontent.com 绝对链
 *   - 相对链接 (href="docs/x" / ](ROADMAP.md) 等) → github.com/.../blob/main 绝对链
 *   - 站内锚点 (#...) / 已是 http(s) 的 / mailto: → 原样保留
 * 其余内容逐字不动 → 渲染出来与 GitHub 主页「完全一模一样」.
 *
 * 用法:  node scripts/gen-modelscope-intro.mjs
 * 产物:  docs/modelscope-intro.md  (全选复制粘贴到 ModelScope 项目「介绍」区)
 *
 * README 更新后重跑本脚本即可重新同步 (单一真理: README.md).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'ChrisChen667788/wind-comic';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const BLOB = `https://github.com/${REPO}/blob/main`;

const srcPath = path.join(root, 'README.md');
const outPath = path.join(root, 'docs', 'modelscope-intro.md');

let md = fs.readFileSync(srcPath, 'utf8');
const before = md;

// ModelScope 自己的存储地址(见下方第 1 步的说明)。**必须定义在第 0 步之前** ——
// const 有暂时性死区,定义在使用之后会直接抛 ReferenceError。
const MS = 'https://modelscope.cn/models/haozi667788/wind-comic/resolve/master';

// 0) 架构图 SVG → PNG: raw 把 .svg 当 text/plain 发, ModelScope 渲染不出 → 映射到同名已导出 PNG (image/png 可渲染)
md = md.replace(/src="assets\/diagrams\/([^"]+)\.svg"/g, `src="${MS}/assets/diagrams/$1.png"`);

// v12.336:**光栅图改指 ModelScope 自己的存储**,不再走 raw.githubusercontent.com。
// 病根:ModelScope 有自己的图片代理(resouces.modelscope.cn/proxy-image/),会把外链图
// 全部改写过去。代理本身是通的(实测直接抓返回 200 image/jpeg),但它要**逐张跨境**回源
// 到 raw,30 张图就得排队等很久 —— 页面在这期间大片显示成裂图,看起来就是「图挂了」。
// 实测等到稳态是 47/47 全部加载,也就是说这是**慢**不是**坏**。
// 镜像里本来就有全部文件,改指 ModelScope 自己的 resolve 地址即可变成境内取图。
//
// ⚠️ **SVG 例外**:ModelScope 的 resolve 把 .svg 当 `text/plain` 发(实测),浏览器不会当图渲染;
// 而 raw.githubusercontent.com 发的是 `image/svg+xml`。所以 SVG 仍留在 raw
//(只有 star 曲线两张,7KB,慢一点无妨)。架构图那三张早就另存了 PNG,见第 0 步。
// 1) 图片/资源相对路径 → 绝对链 (HTML <img src>、<source srcset> 与 markdown ![](...))
// ⚠️ v12.334:`srcset` 此前**被漏掉**。README 用 <picture> 做亮/暗双主题图后,
// 深色那张写在 <source srcset="assets/...">,于是在 ModelScope 上仍是相对路径解析不了 ——
// 而 <picture> 的 source 命中却加载失败时**不会**回退到 <img>,直接裂图。
// 下面的自检也一并加上 srcset,否则它会继续报「残留相对图: 0」。
md = md.replace(/(src|srcset)="(assets\/[^"]+\.(?:png|jpe?g|gif|webp))"/g, (_m, a, p) => `${a}="${MS}/${p}"`);
md = md.replace(/\]\((assets\/[^)]+\.(?:png|jpe?g|gif|webp))\)/g, (_m, p) => `](${MS}/${p})`);
// 剩下的(SVG)仍走 raw —— ModelScope 的 resolve 把 svg 当 text/plain 发
md = md.replace(/src="assets\//g, `src="${RAW}/assets/`);
md = md.replace(/srcset="assets\//g, `srcset="${RAW}/assets/`);
md = md.replace(/\]\(assets\//g, `](${RAW}/assets/`);

// 2) HTML href 相对链 → blob 绝对链 (排除 http(s)://, #锚点, mailto:)
md = md.replace(/href="(?!https?:\/\/|#|mailto:)([^"]+)"/g, `href="${BLOB}/$1"`);

// 3) markdown 链接相对目标 → blob 绝对链 (assets 已在第 1 步绝对化, 此处被 http 排除)
md = md.replace(/\]\((?!https?:\/\/|#|mailto:)([^)]+)\)/g, `](${BLOB}/$1)`);

const header =
  '<!-- 由 scripts/gen-modelscope-intro.mjs 从 README.md 自动生成: 图片→raw、相对链→blob 绝对化, ' +
  '其余逐字不变. 全选复制粘贴到 ModelScope 项目「介绍」区即与 GitHub 主页一致. 勿手改本文件, ' +
  '改 README.md 后重跑脚本. -->\n\n';

fs.writeFileSync(outPath, header + md);

// 自检: 输出里不应再有 README 相对资源/链接残留
const leftoverImg = (md.match(/src="assets\//g) || []).length
  + (md.match(/srcset="assets\//g) || []).length
  + (md.match(/\]\(assets\//g) || []).length;
const rawCount = (md.match(/raw\.githubusercontent\.com/g) || []).length;
const msCount = (md.match(/modelscope\.cn\/models\/[^/]+\/[^/]+\/resolve/g) || []).length;
const blobCount = (md.match(/github\.com\/[^/]+\/[^/]+\/blob\/main/g) || []).length;
console.log(`✅ 写入 docs/modelscope-intro.md (${md.length} chars, README ${before.length} chars)`);
console.log(`   图片绝对化: ${msCount} 处 ModelScope 自托管 + ${rawCount} 处 raw 链 | 相对链绝对化: ${blobCount} 处 blob 链 | 残留相对图: ${leftoverImg}`);
if (leftoverImg > 0) { console.error('❌ 仍有相对图片路径未绝对化, 检查正则'); process.exit(1); }
