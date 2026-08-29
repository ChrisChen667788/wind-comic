/**
 * v12.368:画风漂移「接了线,却永远看不到一个数字」—— 而且是两处失效叠在一起。
 *
 * v12.350 把面板接上了 `/drift-check`,但它要求 `IMAGE_EMBED_MODEL`。owner 没配,
 * 面板永远显示「暂不可用」。那一版我把这条**如实写进了版本日志**,这一版补上。
 *
 * 补的过程里发现**第二处失效,更隐蔽**:
 *   `.filter(s => /^https?:\/\//.test(s.url))`
 * 而本项目的分镜图是 `/api/serve-file?key=…`(相对路径)——
 * **即使配了嵌入模型,也会 0 张合格**,直接报「可探测分镜图不足 2 张」。
 * 看起来像「素材不够」,其实是过滤条件写错了。
 *
 * 修法:
 * ① 本地签名兜底 —— 用**已在依赖里的 ffmpeg** 把图缩到 8×8 取 RGB(192 维),
 *    喂给既有的 `detectDriftOutliers`(那函数只要 `number[]`,数学是通用的)。零 API、零额度。
 * ② 过滤条件放开到「有 url 即可」,远端嵌入才限 http(s)。
 *
 * **能力边界必须随结果一起交付**:本地签名抓调色/明暗/构图跑偏,
 * 抓不到「同色调下人物的脸变了」。返回体带 `method` + `methodNote`,
 * 不标注就会被当成语义嵌入的等价物。
 *
 * 实测(《月挂不下来》11 镜):首次产出真实数字,指认第 3 镜偏离最大(0.65 vs 均值 0.427)。
 * **人工核对该镜确实是近乎全黑的门缝剪影**,与其余均匀照明的院落场景差异极大 —— 指认正确。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { imageSignature, imageSignatures, SIGNATURE_DIM } from '@/lib/image-signature';
import { detectDriftOutliers } from '@/lib/drift-detect';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const ASSETS = path.join(process.cwd(), 'data/storage/assets');
const realImages = fs.existsSync(ASSETS)
  ? fs.readdirSync(ASSETS).filter((f) => /\.(png|jpe?g)$/i.test(f)).slice(0, 3).map((f) => path.join(ASSETS, f))
  : [];

describe('v12.368 本地图像签名', () => {
  it('维度固定为 8×8×3 = 192', () => {
    expect(SIGNATURE_DIM).toBe(192);
  });

  it.runIf(realImages.length > 0)('真实图片能算出签名,且每一维在 0..1', async () => {
    const sig = await imageSignature(realImages[0]);
    expect(sig).not.toBeNull();
    expect(sig!.length).toBe(SIGNATURE_DIM);
    for (const v of sig!) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('文件不存在返回 null —— **不抛**,一镜失败不该让整次检测失败', async () => {
    expect(await imageSignature('/tmp/definitely-not-here.png')).toBeNull();
    expect(await imageSignature('')).toBeNull();
  });

  it('批量保持与输入同序,失败位置为 null', async () => {
    const out = await imageSignatures(['/tmp/nope-a.png', '/tmp/nope-b.png']);
    expect(out.length).toBe(2);
    expect(out).toEqual([null, null]);
  });

  it.runIf(realImages.length >= 2)('签名能喂进既有的 detectDriftOutliers(数学是通用的)', async () => {
    const sigs = await imageSignatures(realImages);
    const emb = sigs.map((v, i) => ({ shotNumber: i + 1, vector: v! })).filter((x) => x.vector);
    const r = detectDriftOutliers(emb);
    expect(r.available).toBe(true);
    expect(r.scores.length).toBe(emb.length);
  });
});

describe('v12.368 端点:两处失效都修了', () => {
  const R = read('app/api/projects/[id]/drift-check/route.ts');

  it('不再因未配 IMAGE_EMBED_MODEL 就直接返回不可用', () => {
    expect(R).not.toMatch(/if \(!hasImageEmbeddingKey\(\)\) \{\s*return NextResponse\.json\(\{\s*available: false/);
    expect(R).toMatch(/const useEmbedding = hasImageEmbeddingKey\(\)/);
  });

  it('**URL 过滤放开** —— 本项目的分镜图是 serve-file 相对路径', () => {
    expect(R).toMatch(/\.filter\(\(s\) => typeof s\.shotNumber === 'number' && !!s\.url\)/);
    // 远端嵌入仍限 http(s),那是它的真实约束
    expect(R).toMatch(/queue = shots\.filter\(\(s\) => \/\^https\?/);
  });

  it('嵌入不足 2 条时才走本地签名(配了模型仍优先用模型)', () => {
    expect(R).toMatch(/if \(embeddings\.length < 2\)/);
    expect(R).toMatch(/imageSignatures/);
    expect(R).toMatch(/method = 'local-signature'/);
  });

  it('**能力边界随结果一起交付**,不让人当成语义嵌入的等价物', () => {
    expect(R).toMatch(/method,/);
    expect(R).toMatch(/methodNote/);
    expect(R).toContain('发现不了同色调下的人物走形');
  });

  it('把「看起来像素材不够、其实是过滤条件写错」记在代码里', () => {
    expect(R).toMatch(/即使配了嵌入模型,也会 0 张合格/);
  });
});

describe('v12.368 面板要把边界显示出来', () => {
  const UI = read('components/project/monitor-tab.tsx');

  it('类型里承认 method / methodNote', () => {
    expect(UI).toMatch(/method\?: 'embedding' \| 'local-signature'/);
    expect(UI).toMatch(/methodNote\?: string/);
  });

  it('**渲染出来**,不是只加字段(只加不显示等于没说)', () => {
    expect(UI).toMatch(/\{data\.methodNote && \(/);
    expect(UI).toContain('测量方式:');
  });

  it('把「不说清楚会被当成人物一致性没问题」的理由写在代码里', () => {
    expect(UI).toContain('抓不到同色调下的人物走形');
  });
});
