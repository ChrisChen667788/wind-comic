#!/usr/bin/env node
/** v6.7 — 把 v6 截图压到 web 尺寸 (1440 宽) + 合成功能巡览 GIF. */
import ff from 'ffmpeg-static';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'assets', 'v6');
const names = ['dashboard', 'health', 'styles', 'team', 'characters', 'story-intake', 'director-console', 'cinema-timeline'];

// 1) 原图 (2x, 2880宽) → 压到 1440 宽, 控制仓库体积
for (const n of names) {
  const f = path.join(dir, `${n}.png`);
  if (!fs.existsSync(f)) continue;
  const tmp = `${f}.tmp.png`;
  execFileSync(ff, ['-y', '-i', f, '-vf', 'scale=1440:-1:flags=lanczos', tmp], { stdio: 'ignore' });
  fs.renameSync(tmp, f);
  console.log('scaled', n, Math.round(fs.statSync(f).size / 1024) + 'KB');
}

// 2) 功能巡览 GIF (5 帧, ~1.4s/帧, 900 宽)
const tour = ['health', 'director-console', 'story-intake', 'styles', 'cinema-timeline'];
const frames = path.join(dir, '_frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames);
tour.forEach((n, i) => {
  execFileSync(ff, ['-y', '-i', path.join(dir, `${n}.png`), '-vf', 'scale=900:-1:flags=lanczos', path.join(frames, `${String(i + 1).padStart(3, '0')}.png`)], { stdio: 'ignore' });
});
const out = path.join(dir, 'wind-comic-v6-tour.gif');
execFileSync(ff, [
  '-y', '-framerate', '0.7', '-i', path.join(frames, '%03d.png'),
  '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
  '-loop', '0', out,
], { stdio: 'ignore' });
fs.rmSync(frames, { recursive: true, force: true });
console.log('GIF:', out, Math.round(fs.statSync(out).size / 1024) + 'KB');
