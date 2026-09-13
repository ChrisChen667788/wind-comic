/**
 * v12.436 —— 列表页改海报墙:竖版封面、一行梗概、人话标题、更高密度。
 *
 * 对标用户给的 Castloop 截图:一屏扫几十个故事,卡片只有封面、标题、一句梗概。
 * 改版途中挖出三个比「好不好看」更实在的问题,一并修掉:
 *   ① 库里 84% 的项目是 9:16,列表却写死 h-[160px] 横框,竖图只看得见 28%;
 *      而且封面容器**没有 position: relative** —— v12.431 那三轮徽章撞版的根子。
 *   ② 案例库「复制提示词 / 用这个创作」是空壳:cases 表没有 prompt 列,永远落到标题,
 *      「月华藏境」4 个字带进创作页,开机门槛 10 字,**按钮是灰的**。
 *   ③ 素材库 1095 个资产里 488 个叫「镜头 N / 视频 N」;初版换成描述首句后,
 *      截图里又冒出「Dolly-in on 85mm lens」—— 那是运镜指令,不是画面内容。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { posterFitFor, posterVisibleFraction, POSTER_FRAME_CLASS, POSTER_COVER_MAX_AR } from '@/lib/media-frame';
import { caseSeedIdea } from '@/lib/case-seed';
import { IDEA_MIN_CHARS, ideaReady } from '@/lib/idea-gate';
import { assetDisplayTitle, buildStoryboardIndex, isMachineName, contentOf, firstClause } from '@/lib/asset-title';
import { cleanSynopsis, cleanDescription, loglineFrom } from '@/lib/logline';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('v12.436 · 海报框:按图片真实比例决定裁不裁', () => {
  it('9:16 竖图铺满,一个像素不丢', () => {
    expect(posterFitFor(1080, 1920)).toBe('cover');
    expect(posterVisibleFraction(1080, 1920)).toBeCloseTo(1, 5);
  });

  it('3:4 是铺满的上限,此时最多从两侧裁掉 25%', () => {
    expect(POSTER_COVER_MAX_AR).toBe(0.75);
    expect(posterFitFor(768, 1024)).toBe('cover');
    expect(posterVisibleFraction(768, 1024)).toBeCloseTo(0.75, 5);
  });

  it('比 3:4 宽一点点就改 contain —— 横图绝不裁', () => {
    expect(posterFitFor(770, 1024)).toBe('contain');
    expect(posterFitFor(1920, 1080)).toBe('contain');
    expect(posterVisibleFraction(1920, 1080)).toBe(1);
  });

  it('量不到尺寸时不裁(宁可留边,不替用户赌)', () => {
    for (const [w, h] of [[0, 0], [NaN, 100], [100, 0], [-1, 5]]) {
      expect(posterFitFor(w, h)).toBe('contain');
    }
  });

  it('框本身是 9:16', () => {
    expect(POSTER_FRAME_CLASS).toBe('aspect-[9/16]');
  });
});

describe('v12.436 · 项目列表接线', () => {
  const code = stripComments(read('app/dashboard/projects/page.tsx'));

  it('封面容器带 relative + 海报框,不再写死 160px 横框', () => {
    expect(code).toContain('cover relative overflow-hidden ${POSTER_FRAME_CLASS}');
    expect(code).not.toContain('h-[160px]');
  });

  it('填充方式在图片加载后按真实尺寸算,不按库里的 aspect 字段', () => {
    expect(code).toMatch(/onLoad=\{\(e\) => setFit\(posterFitFor\(e\.currentTarget\.naturalWidth, e\.currentTarget\.naturalHeight\)\)\}/);
  });

  it('候选串回退仍走 nextCoverIndex,且由 React 状态持有下标(背景模糊层才跟得上换图)', () => {
    const at = code.indexOf('function PosterCover(');
    expect(at).toBeGreaterThan(0);
    const body = code.slice(at);
    expect(body).toContain('nextCoverIndex(idx, coverList.length)');
    expect(body).toContain('setIdx(next)');
    // 修前是直接改 DOM:img.src = coverList[next]
    expect(code).not.toMatch(/img\.src = coverList\[next\]/);
  });

  it('横图 contain 时有同图模糊铺底', () => {
    const body = code.slice(code.indexOf('function PosterCover('));
    expect(body).toMatch(/\{fit === 'contain' && \(/);
    // 锁「有一层铺满的模糊底」这个行为,不锁具体模糊档位 —— 调 blur-xl/2xl 属于视觉微调
    const backdrop = body.slice(body.indexOf("{fit === 'contain' && ("), body.indexOf('data-poster-fit'));
    expect(backdrop).toMatch(/absolute inset-0[^"]*object-cover[^"]*blur-/);
    expect(backdrop).toContain('aria-hidden');
  });

  it('网格变密,骨架屏与正式列表同一套列数', () => {
    expect(code).not.toContain('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5');
    const dense = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4';
    expect(code.split(dense).length - 1).toBe(2);
  });

  it('梗概走 lib/logline,卡片不直接倒原始字段', () => {
    expect(code).toContain('{loglineOf(p)}');
    const fn = code.slice(code.indexOf('function loglineOf('), code.indexOf('function PosterCover('));
    expect(fn).toContain('loglineFrom(');
    expect(fn).not.toMatch(/return\s+syn\.trim\(\)/);
  });
});

describe('v12.436 · 梗概:剥掉结构前缀和标题复述(真库实测形态)', () => {
  it('剧本导入的结构化 synopsis:去掉「主要角色:…。剧情概要:」', () => {
    const raw = '主要角色：Lip、Shirley、经理。剧情概要：[1-1卡内基音乐厅门口,白天] Lip穿着保龄球衫站在音乐厅前';
    const out = cleanSynopsis(raw);
    expect(out).not.toMatch(/主要角色|剧情概要|\[1-1/);
    expect(out.startsWith('卡内基音乐厅门口')).toBe(true);
  });

  it('方括号里是整段正文时只去编号、保留内容 —— 初版整段删掉,会删成空串', () => {
    const raw = '[1-1虚无中矗立一座八角铁笼,锈蚀铁栏切割冷蓝硬光,橡胶垫下水渍泛着死鱼眼般的冷光。]';
    const out = cleanSynopsis(raw);
    expect(out.startsWith('虚无中矗立一座八角铁笼')).toBe(true);
    expect(out).not.toContain(']');
  });

  it('没有闭合括号(被截断)也不丢内容', () => {
    expect(cleanSynopsis('[1-1城市天际线,浓雾弥漫。一个孤独的男人').startsWith('城市天际线')).toBe(true);
  });

  it('不留双空格', () => {
    expect(cleanSynopsis('主要角色：甲。剧情概要：[1-1门口,白天] 甲走进来')).not.toMatch(/\s{2,}/);
  });

  it('description 去掉对标题的逐字复述和章节号', () => {
    const title = '第 1 章 月挂不下来';
    const d = '第 1 章 月挂不下来 鳏夫李长安对嫂子暗生情愫';
    expect(cleanDescription(d, title)).toBe('鳏夫李长安对嫂子暗生情愫');
  });

  it('synopsis 剥完为空时退到 description,都没有返回空串不编', () => {
    expect(loglineFrom({ title: 'T', description: '雨夜赛博都市,侦探追查失踪线人', scriptData: { synopsis: '主要角色：甲。' } }))
      .toBe('雨夜赛博都市,侦探追查失踪线人');
    expect(loglineFrom({ title: 'T', description: '', scriptData: {} })).toBe('');
  });

  it('好的 synopsis 原样(只收空白)', () => {
    const good = '在一个暮色渐浓的农家小院,李长安暗中窥视着寡嫂柳如烟';
    expect(cleanSynopsis(good)).toBe(good);
  });
});

describe('v12.436 · 案例库:送去创作页的那句话必须开得了机', () => {
  it('只有标题 + 题材时,拼出的种子创意过得了开机门槛', () => {
    const seed = caseSeedIdea({ title: '月华藏境', category: '东方幻想' });
    expect(ideaReady(seed)).toBe(true);
    expect(seed).toContain('月华藏境');
    expect(seed).toContain('东方幻想');
    // 修前送出去的就是标题本身 —— 过不了门槛
    expect(ideaReady('月华藏境')).toBe(false);
  });

  it('标题极短、没有题材,照样过门槛', () => {
    for (const c of [{ title: '雾' }, { title: '' }, {}, { title: null, category: null }]) {
      expect(ideaReady(caseSeedIdea(c as any))).toBe(true);
    }
  });

  it('将来表里有了够长的真提示词,原样用它,不再拼', () => {
    const real = '一个在雨夜霓虹里追查失踪案的赛博侦探,发现委托人就是凶手';
    expect(caseSeedIdea({ title: 'x', prompt: real })).toBe(real);
  });

  it('真提示词太短(不足门槛)时退回拼句,不送一句开不了机的话', () => {
    const seed = caseSeedIdea({ title: '月华藏境', category: '东方幻想', prompt: '古风' });
    expect(seed).not.toBe('古风');
    expect(ideaReady(seed)).toBe(true);
  });

  it('门槛只有一个定义,创作页读的就是它', () => {
    expect(IDEA_MIN_CHARS).toBe(10);
    const create = stripComments(read('app/dashboard/create/page.tsx'));
    expect(create).toContain('const isReady = ideaReady(idea);');
    expect(create).not.toMatch(/const isReady = ideaCharCount >= \d+/);
  });

  it('两个按钮都走 caseSeedIdea,不再退到标题', () => {
    const code = stripComments(read('app/dashboard/cases/page.tsx'));
    expect(code.split('const promptText = caseSeedIdea(c);').length - 1).toBe(2);
    expect(code).not.toContain('c.prompt || c.description || c.title');
  });

  it('题材签不依赖有没有视频 —— 初版放进视频分支,又删了信息区的题材文字,无视频案例会丢题材', () => {
    const code = stripComments(read('app/dashboard/cases/page.tsx'));
    const chipAt = code.indexOf('{c.category && (');
    const videoBranchAt = code.indexOf('{playingId === c.id && c.videoUrl ? (');
    expect(chipAt).toBeGreaterThan(0);
    expect(videoBranchAt).toBeGreaterThan(0);
    // 题材签在画面分支**之前**、顶层渲染
    expect(chipAt).toBeLessThan(videoBranchAt);
    // 版权诚实标记仍然跟着视频走
    expect(code).toMatch(/\{c\.videoUrl && \(\s*<span[^>]*>示意片段<\/span>/);
    // 没有硬偏移补丁
    expect(code).not.toContain('translate-y-6');
  });

  it('去掉作者行与种子热度数', () => {
    const code = stripComments(read('app/dashboard/cases/page.tsx'));
    expect(code).not.toContain('c.authorAvatar');
    expect(code).not.toContain('c.metrics?.views');
    expect(code).not.toContain('c.metrics?.likes');
  });
});

describe('v12.436 · 素材库标题:说画面里有什么,不说运镜', () => {
  it('认得出机器名,不误伤正常名字', () => {
    for (const n of ['镜头 1', '视频 10', 'Shot 3', 'Shot 1 (re-gen)', '分镜 2', '场景 4']) expect(isMachineName(n)).toBe(true);
    for (const n of ['卡内基音乐厅', 'voice-cast', '背景配乐(自备)', '镜头语言笔记']) expect(isMachineName(n)).toBe(false);
  });

  it('中文剧本式描述:首句就是地点,原样取', () => {
    const t = assetDisplayTitle({ type: 'storyboard', name: '镜头 1', data: { description: '卡内基音乐厅门口,白天（日）。Lip穿着保龄球衫站在音乐厅前' } });
    expect(t).toBe('卡内基音乐厅门口');
  });

  it('英文镜头规格式:取冒号之后的画面内容,不取运镜指令', () => {
    const desc = 'Dolly-in on 85mm lens, close-up single, high-angle over-the-shoulder: Chen Huaian gripping the rusted blade';
    const t = assetDisplayTitle({ type: 'storyboard', name: '镜头 4', data: { description: desc } });
    expect(t).not.toMatch(/lens|Dolly|85mm/);
    expect(t.startsWith('Chen Huaian')).toBe(true);
  });

  it('中文以景别/运镜开头的,跳过那一句', () => {
    const desc = '大远景缓慢推镜入中景。李长安靠在左侧门框,目光紧盯画面中央的瓷勺';
    expect(contentOf(desc).startsWith('李长安')).toBe(true);
  });

  it('只剥开头的镜头语言,正文里出现「特写」「lens」不能被误删', () => {
    const zh = '卡内基音乐厅门口,白天。镜头给到手中那张纸的特写';
    expect(contentOf(zh)).toBe(zh.replace(/\s+/g, ' ').trim());
    const en = 'A photographer adjusts her lens by the window, rain on the glass';
    expect(contentOf(en)).toBe(en); // 根本没有冒号,原样
  });

  it('冒号前不是镜头规格时不切 —— 真实剧本里的对白冒号', () => {
    // 初版这条断言用的句子没有冒号,冒号分支永远不触发;把判定改成「见冒号就切」照样绿。
    // 真库里中文剧本式描述常带对白冒号,一律切会把地点标题换成半句台词。
    const desc = 'Shirley公寓大厅,对话收束（日）。Shirley问:你为一个黑人工作有问题吗';
    expect(contentOf(desc).startsWith('Shirley公寓大厅')).toBe(true);
    const t = assetDisplayTitle({ type: 'storyboard', name: '镜头 8', data: { description: desc } });
    expect(t).toBe('Shirley公寓大厅');
    // 正向自证:冒号前**是**镜头规格时确实会切
    expect(contentOf('Static on 50mm lens, CU, eye-level: 一只颤抖的手').startsWith('一只颤抖的手')).toBe(true);
  });

  it('视频自己没描述,借同项目同镜号的分镜', () => {
    const assets = [
      { type: 'storyboard', name: '镜头 7', projectId: 'p1', shotNumber: 7, data: JSON.stringify({ description: 'Static on 50mm lens, ECU: a crack glowing in darkness' }) },
      { type: 'video', name: '视频 7', projectId: 'p1', shotNumber: 7, data: {} },
      { type: 'video', name: '视频 7', projectId: 'p2', shotNumber: 7, data: {} }, // 别的项目,不许串
    ];
    const idx = buildStoryboardIndex(assets);
    const borrowed = assetDisplayTitle(assets[1], idx);
    // 借到的是分镜的**画面内容**(冒号之后),而不是运镜;超过 22 字按规则截断
    expect(borrowed.startsWith('a crack glowing')).toBe(true);
    expect(borrowed).not.toMatch(/Static|50mm|lens/);
    expect(assetDisplayTitle(assets[2], idx)).toBe('视频 7');
  });

  it('两边都拿不到描述时老实显示原名,不编', () => {
    expect(assetDisplayTitle({ type: 'video', name: '视频 3', data: {} }, new Map())).toBe('视频 3');
    expect(assetDisplayTitle({ type: 'storyboard', name: '镜头 2', data: '{坏 JSON' })).toBe('镜头 2');
  });

  it('非机器名不动', () => {
    expect(assetDisplayTitle({ type: 'music', name: '背景配乐(自备)', data: { description: '一段钢琴' } })).toBe('背景配乐(自备)');
  });

  it('标题截短,别把整段提示词塞进去', () => {
    expect(firstClause('这是一个非常非常非常非常非常非常非常长的地点描述没有任何标点符号')).toMatch(/…$/);
  });

  it('接线:素材库卡片标题用 assetDisplayTitle,索引整库只建一次', () => {
    const code = stripComments(read('app/dashboard/assets/page.tsx'));
    expect(code).toContain('useMemo(() => buildStoryboardIndex(assets), [assets])');
    expect(code).toContain('const title = assetDisplayTitle(asset, storyboardIdx);');
    expect(code).toMatch(/title=\{asset\.name\}>\{title\}</);
  });
});
