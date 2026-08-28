/**
 * v12.347:`persistent_url` 里存着会过期的外链 —— 这一列的名字就是它的承诺。
 *
 * v12.343 修了三个重生端点的落盘,顺带审计出「22 个写资产的端点不调 persistAsset,
 * 其中 11 个确实在写媒体 URL」。逐个核对后发现两族问题,而**第二族比第一族更阴**:
 *
 * ① 压根不落盘:`heal-shots`(补渲视频)、`candidates/pick`(九宫格选定的那张)。
 *    heal-shots 的注释还写着「持久化:更新既有 video 资产」—— 做的只是写 DB 行。
 *    补渲的意义是「把坏掉的镜治好」,治完几天又 403 等于没治。
 *
 * ② **假持久**:`persistentUrl: url.startsWith('http') ? url : null` ——
 *    把引擎外链直接塞进 persistent_url。消费方(包括 v12.342 的清理引用扫描)
 *    看到这一列有值就认为「有持久副本」,而它几天后就 403。
 *    库里已有 **9 条**这样的假持久,全是 storyboard-sketch。
 *
 * 锁行为:persistent_url 要么是本地 serve-file,要么是 null —— **绝不能是外链**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = ['app', 'lib', 'services'].flatMap((d) => walk(path.join(ROOT, d)));

describe('v12.347 persistent_url 不得是外链(全仓门禁)', () => {
  it('没有任何地方把 `url.startsWith("http") ? url : null` 当 persistentUrl', () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      for (const [i, line] of read(path.relative(ROOT, f)).split('\n').entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/persistentUrl:\s*\w+[\w.!]*\.startsWith\(['"]http/.test(line)) {
          bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 其余 `persistentUrl: <变量>` 的写法无法靠静态分析判断变量是不是外链,
   * 所以这里用**已复核清单**:逐个人工追过来源,新增站点必须复核后加进白名单,
   * 否则红 —— 「不给静默新增留口子」。
   *
   * 复核结论(v12.347):
   *   covers/choose        `serveFilePathUrl(...)`     本地 ✓
   *   recompose ×2         `serveFilePathUrl(...)`     本地 ✓
   *   narration            `srtPersisted?.url ?? null` 落盘结果 ✓
   *   create-pipeline ×2   `persistFirstValid(...)`    落盘结果 ✓
   *   covers/from-frames   成片抽帧,本地产物           ✓
   *   ab-variant/choose    复制既有资产的 persistent_url ✓(不新增外链)
   *   regenerate-shot-4k   **可灵外链 → 已在本版修掉**
   */
  const REVIEWED = new Set([
    'app/api/projects/[id]/covers/choose/route.ts',
    'app/api/projects/[id]/recompose/route.ts',
    'app/api/projects/[id]/narration/route.ts',
    'app/api/projects/[id]/covers/from-frames/route.ts',
    'app/api/projects/[id]/ab-variant/choose/route.ts',
    'app/api/projects/[id]/regenerate-shot-4k/route.ts',
    'lib/create-pipeline.ts',
    'lib/asset-storage.ts',
  ]);

  it('没有未经复核的新站点给 persistentUrl 赋裸变量', () => {
    const unreviewed: string[] = [];
    for (const f of SOURCES) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      for (const [i, line] of read(rel).split('\n').entries()) {
        const t = line.trimStart();
        if (t.startsWith('//') || t.startsWith('*')) continue;
        const m = line.match(/persistentUrl:\s*([^,}]+)/);
        if (!m) continue;
        const v = m[1].trim();
        // 安全形态:null / xxx?.url / xxx.url / 透传形参
        if (v === 'null' || /\?\.url\b/.test(v) || /\.url\b/.test(v) || /persistentUrl/.test(v)) continue;
        if (!REVIEWED.has(rel)) unreviewed.push(`${rel}:${i + 1} → ${v.slice(0, 50)}`);
      }
    }
    expect(unreviewed).toEqual([]);
  });

  it('4K 重渲的产物必须落盘 —— 收费的高成本操作最不该几天后 403', () => {
    const src = read('app/api/projects/[id]/regenerate-shot-4k/route.ts');
    expect(src).toMatch(/await persistAsset\(videoUrl\)/);
    expect(src).toMatch(/persistentUrl: p4k\?\.url \|\| null/);
    expect(src).not.toMatch(/persistentUrl: videoUrl\b/);
  });
});

describe('v12.347 两个漏落盘的端点', () => {
  it('heal-shots:补渲的视频必须落盘,不能只写 DB 行', () => {
    const src = read('app/api/projects/[id]/heal-shots/route.ts');
    expect(src).toMatch(/await persistAsset\(clip\.videoUrl\)/);
    // 更新与新建两条路径都要带 persistentUrl
    expect(src).toMatch(/updateAssetBySelector\(id, sel, \{[\s\S]{0,120}persistentUrl:/);
    // 窗口按语义划:`[^}]*` 会被 data: {...} 里的第一个 } 截断(本会话第三次踩)。
    const win = src.slice(src.indexOf('if (changes === 0)'), src.indexOf('healed.push('));
    expect(win).toMatch(/persistentUrl: persisted\?\.url \|\| null/);
  });

  it('heal-shots:回给调用方的也必须是落盘后的 URL', () => {
    const src = read('app/api/projects/[id]/heal-shots/route.ts');
    expect(src).toMatch(/healed\.push\(\{ shot: h\.shot, reasons: h\.healable, videoUrl: savedUrl \}\)/);
  });

  it('candidates/pick:选定的那张要落盘 —— 它是视频首帧,最不该丢', () => {
    const src = read('app/api/projects/[id]/candidates/pick/route.ts');
    expect(src).toMatch(/await persistAsset\(picked\.imageUrl\)/);
    expect(src).toMatch(/persistentUrl: pickedPersisted\?\.url \|\| null/);
  });

  it('落盘失败都要显式告警「会过期」,不能静默', () => {
    for (const rel of [
      'app/api/projects/[id]/heal-shots/route.ts',
      'app/api/projects/[id]/candidates/pick/route.ts',
      'app/api/projects/[id]/anytext-cover/route.ts',
      'app/api/projects/[id]/shot-sketch/route.ts',
    ]) expect(read(rel)).toMatch(/会过期/);
  });

  it('落盘失败不阻断主流程(仍回退到外链,只是不谎称持久)', () => {
    for (const rel of [
      'app/api/projects/[id]/heal-shots/route.ts',
      'app/api/projects/[id]/candidates/pick/route.ts',
    ]) expect(read(rel)).toMatch(/persistAsset\([^)]*\)\.catch\(\(\) => null\)/);
  });
});
