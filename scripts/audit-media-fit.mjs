/**
 * 量「框比例 vs 原生比例」的裁切损失。诊断 + 回归基线两用。
 * 跑法:dev server 在 :3000,`node scripts/audit-media-fit.mjs [projectId]`
 */
import puppeteer from 'puppeteer';
import fs from 'fs';

const PROJECT = process.argv[2] || 'proj-1781368728491';
const TABS = ['导演台', '剧本', '角色', '场景', '分镜', '视频'];
const { token, user } = JSON.parse(fs.readFileSync('/tmp/tok.json', 'utf-8'));

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'],
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.setCookie({ name: 'qfmj-session', value: token, domain: 'localhost', path: '/' });
await p.evaluateOnNewDocument(([t, u]) => {
  localStorage.setItem('qfmj-token', t); localStorage.setItem('qfmj-user', u);
}, [token, JSON.stringify(user)]);
await p.goto(`http://localhost:3000/projects/${PROJECT}`, { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 9000));

const measure = () => p.evaluate(() => {
  const out = [];
  for (const el of Array.from(document.querySelectorAll('img, video'))) {
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) continue;
    const nw = el.naturalWidth ?? el.videoWidth, nh = el.naturalHeight ?? el.videoHeight;
    if (!nw || !nh) continue;
    const fit = getComputedStyle(el).objectFit;
    const boxAR = r.width / r.height, natAR = nw / nh;
    // cover 时,框与原图比例差多少,就沿长边裁掉多少
    const loss = fit === 'cover' ? Math.round((1 - Math.min(boxAR, natAR) / Math.max(boxAR, natAR)) * 100) : 0;
    out.push({ fit, box: `${Math.round(r.width)}x${Math.round(r.height)}`, nat: `${nw}x${nh}`, loss });
  }
  return out;
});

const clickTab = (name) => p.evaluate((n) => {
  const el = Array.from(document.querySelectorAll('button,[role="tab"],a'))
    .find(e => new RegExp(`^\\s*${n}\\s*\\d*\\s*$`).test(e.innerText || ''));
  if (!el) return false;
  el.scrollIntoView({ block: 'center' }); el.click(); return true;
}, name);

let worst = 0, total = 0, cropped = 0;
console.log(`项目 ${PROJECT}`);
for (const tab of TABS) {
  if (!(await clickTab(tab))) { console.log(`  ${tab.padEnd(5)} —— 标签未找到`); continue; }
  await new Promise(r => setTimeout(r, 7000));
  const m = await measure();
  const bad = m.filter(x => x.loss >= 10);
  total += m.length; cropped += bad.length;
  worst = Math.max(worst, ...m.map(x => x.loss), 0);
  const shapes = [...new Set(m.map(x => `${x.nat}→${x.box}`))].slice(0, 3).join('  ');
  console.log(`  ${tab.padEnd(5)} 媒体 ${String(m.length).padStart(2)} 张 | 裁≥10% 的 ${String(bad.length).padStart(2)} 张 | 最狠 ${String(Math.max(...m.map(x=>x.loss), 0)).padStart(2)}% | ${shapes}`);
}
console.log(`\n合计:${total} 张,其中 ${cropped} 张被裁掉 ≥10%,最狠 ${worst}%`);
await b.close();
process.exit(cropped > 0 ? 1 : 0);
