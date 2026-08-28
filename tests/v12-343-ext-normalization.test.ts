/**
 * v12.343:「能播放但会被删」——扩展名缺前导点导致的静默数据丢失。
 *
 * 病根是**两套 key 反推语义不一致**:
 *   - serve 侧 resolveByKey:`files.find(f => f.startsWith(key))` —— 前缀匹配
 *   - cleanup 侧:`f.replace(/\.[^.]*$/, '')` —— 去扩展名
 * 对 `<key>png`(调用方写 `{ ext: 'png' }` 漏了点)两者结果不同:能取到、却反推不出 key,
 * 于是被判孤儿删除。v12.342 的「查引用再删」保不住它,因为引用比对用的就是反推出的 key。
 *
 * 这里锁的是**行为**:任何 persistAsset 落盘的文件,cleanup 都必须能反推回它的 key。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/asset-storage.ts'), 'utf8');

/** 复刻 cleanup 里的 key 反推(与实现同源,见下方「实现未漂移」断言)。 */
function deriveKey(filename: string): string {
  const m = filename.match(/^([a-f0-9]{16,64})/i);
  return m ? m[1] : filename.replace(/\.[^.]*$/, '');
}
/** 复刻 resolveByKey 的前缀匹配。 */
function resolves(filename: string, key: string): boolean {
  return filename.startsWith(key);
}

const KEY = 'a'.repeat(32);

describe('v12.343 扩展名归一', () => {
  it('persistAsset 给无点扩展名补前导点', () => {
    expect(SRC).toMatch(/if \(ext && !ext\.startsWith\('\.'\)\) ext = '\.' \+ ext;/);
  });

  it('补点发生在扩展名兜底解析之后(否则 .bin 等回落路径漏网)', () => {
    const fallback = SRC.indexOf("extFromContentType(contentType) || extFromUrl(sourceUrl)");
    const normalize = SRC.indexOf("if (ext && !ext.startsWith('.')) ext = '.' + ext;");
    expect(fallback).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(fallback);
  });

  it('补点发生在写盘之前', () => {
    const normalize = SRC.indexOf("if (ext && !ext.startsWith('.')) ext = '.' + ext;");
    const put = SRC.indexOf('getStorageDriver().put(key, ext');
    expect(put).toBeGreaterThan(normalize);
  });

  it('实现未漂移:cleanup 仍用前缀反推 key,不是去扩展名', () => {
    const win = SRC.slice(SRC.indexOf('export function cleanup('));
    expect(win).toMatch(/const m = f\.match\(\/\^\(\[a-f0-9\]\{16,64\}\)\/i\);/);
    expect(win).toContain('const key = m ? m[1] : ');
  });

  // ——— 行为断言:两套语义必须对同一文件名给出一致结论 ———
  it.each([
    [`${KEY}.png`, '正常命名'],
    [`${KEY}png`,  '存量坏命名(缺点)'],
    [`${KEY}.mp4`, '视频'],
    [`${KEY}`,     '无扩展名'],
  ])('%s(%s):serve 取得到 ⇒ cleanup 必须反推出同一个 key', (filename) => {
    expect(resolves(filename, KEY)).toBe(true);   // serve 侧能取到
    expect(deriveKey(filename)).toBe(KEY);        // cleanup 侧必须认得
  });

  it('回归:旧的去扩展名写法对缺点文件确实会误判(证明这个 bug 真实存在)', () => {
    const old = `${KEY}png`.replace(/\.[^.]*$/, '');
    expect(old).not.toBe(KEY);          // 旧写法反推失败
    expect(deriveKey(`${KEY}png`)).toBe(KEY); // 新写法修好
  });

  it('非资产文件名不被误当成 key(不能把任意文件都保住)', () => {
    expect(deriveKey('README.md')).toBe('README');
    expect(deriveKey('.DS_Store')).not.toMatch(/^[a-f0-9]{16,64}$/);
  });

  it('所有 persistAsset 调用点的 ext 字面量都带点', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    for (const root of ['app', 'lib', 'services']) walk(path.join(process.cwd(), root));

    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (!line.includes('persistAsset(')) continue;
        const m = line.match(/ext:\s*'([^']*)'/);
        if (m && m[1] && !m[1].startsWith('.')) bad.push(`${path.relative(process.cwd(), f)}: ext:'${m[1]}'`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * v12.343 第二组:重生端点「生成完不存」。
 *
 * 冒烟重跑一镜时抓到:分镜图 `persistent_url` 为空、`media_urls` 直指
 * `hailuo-*.aliyuncs.com` 外链;视频更彻底 —— regenerate-shot 只把 URL 从 SSE 吐出去,
 * 资产表**一行都没写**,而唯一调用方是 `fetch(...).catch(()=>{})` 连读都不读。
 * 即「重试镜头 N」花钱生成 → 直接丢弃。
 *
 * 锁行为:凡是产出媒体的重生端点,都必须 ① persistAsset 落盘 ② 把 persistentUrl 写进资产。
 */
describe('v12.343 重生端点必须落盘落库', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  const MEDIA_REGEN_ROUTES = [
    'app/api/projects/[id]/regenerate-storyboard/route.ts',
    'app/api/projects/[id]/regenerate-shot/route.ts',
    'app/api/projects/[id]/regenerate-asset-image/route.ts',
  ];

  it.each(MEDIA_REGEN_ROUTES)('%s 调用 persistAsset 落盘', (rel) => {
    expect(read(rel)).toMatch(/persistAsset\(/);
  });

  it.each(MEDIA_REGEN_ROUTES)('%s 把 persistentUrl 写进资产(不只是外链)', (rel) => {
    expect(read(rel)).toMatch(/persistentUrl:/);
  });

  it('regenerate-shot 必须把视频写进资产表 —— 否则生成了等于没有', () => {
    const src = read('app/api/projects/[id]/regenerate-shot/route.ts');
    expect(src).toMatch(/upsertAsset\(\{[\s\S]{0,200}type: 'video'/);
    expect(src).toMatch(/shotNumber,/);
  });

  it('落盘失败要有明确告警,不能静默回退到会过期的外链', () => {
    for (const rel of MEDIA_REGEN_ROUTES.slice(0, 2)) {
      expect(read(rel)).toMatch(/会过期/);
    }
  });

  it('保存顺序:先 persistAsset 再写库,且 complete 事件回的是落盘后的 URL', () => {
    const src = read('app/api/projects/[id]/regenerate-shot/route.ts');
    // 窗口必须按语义划:文件里有两处 send('complete') —— 演示分支在前、真实分支在后。
    // 裸 indexOf 会命中演示分支,把断言变成永远为假(第一版就是这么红的)。
    const persist = src.indexOf('await persistAsset(result.videoUrl)');
    const upsert = src.indexOf('await upsertAsset({');
    const complete = src.indexOf("send('complete'", upsert);   // ← 只找 upsert 之后的那处
    expect(persist).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(persist);
    expect(complete).toBeGreaterThan(upsert);
    // complete 回 savedUrl(落盘后)而不是 result.videoUrl(原始外链)
    const tail = src.slice(complete, complete + 200);
    expect(tail).toContain('videoUrl: savedUrl');
    expect(tail).not.toContain('videoUrl: result.videoUrl');
  });

  it('保存失败不能让整镜白跑(必须 try/catch 包住,仍回 URL)', () => {
    const src = read('app/api/projects/[id]/regenerate-shot/route.ts');
    const start = src.indexOf('await orchestrator.regenerateShot');
    const win = src.slice(start, src.indexOf("send('complete'", start));
    expect(win).toMatch(/try \{/);
    expect(win).toMatch(/catch \(e\) \{/);
  });
});
