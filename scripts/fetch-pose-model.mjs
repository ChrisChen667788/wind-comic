#!/usr/bin/env node
/**
 * 把 MediaPipe 的 wasm 与姿态模型放进 public/vendor/mediapipe —— **自托管,不在运行时依赖外网**。
 *
 * 为什么不直接引 CDN:① 用户多在国内,jsDelivr/Google 存储都可能慢到超时;
 * ② 运行时外链等于给产品加了一个不受控的依赖,断网/被墙就静默失效(本仓对「静默失效」零容忍)。
 *
 * wasm 从 node_modules 拷(装了依赖就有);模型 .task 随仓库提交。
 * 任一缺失都不阻断构建 —— 界面会明确说「这台设备/这份部署没有姿态模型,请手动选姿态」,
 * 而不是转圈等一个永远来不了的文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'vendor', 'mediapipe');
const WASM_SRC = path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_OUT = path.join(OUT, 'pose_landmarker_lite.task');
/**
 * 只拷 SIMD 版这两个文件(12MB)。non-SIMD 回退版再要 11MB,而 SIMD 从 2021 年起就是各浏览器默认开启;
 * 真遇到不支持的老浏览器,界面会明确说「这台设备跑不了姿态识别,请手动选」,而不是悄悄不工作。
 */
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const f of WASM_FILES) {
  const src = path.join(WASM_SRC, f);
  if (!fs.existsSync(src)) { console.warn(`[pose-model] 缺 ${f} —— 先 npm i`); continue; }
  fs.copyFileSync(src, path.join(OUT, f));
  copied++;
}

// 模型文件(5.8 MB,Apache-2.0)**随仓库提交**,构建期不下载:
// 构建期联网下载 = 给镜像构建加一个会在断网/被墙时失败的步骤,而这个文件几年才变一次。
if (fs.existsSync(MODEL_OUT) && fs.statSync(MODEL_OUT).size > 1_000_000) {
  console.log(`[pose-model] 模型就位(${(fs.statSync(MODEL_OUT).size / 1e6).toFixed(1)} MB)`);
} else {
  console.warn('[pose-model] 缺 public/vendor/mediapipe/pose_landmarker_lite.task —— 「从照片识别姿态」会显示为不可用');
}
console.log(`[pose-model] wasm ${copied}/${WASM_FILES.length} 个就位`);
