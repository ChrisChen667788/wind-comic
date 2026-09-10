/**
 * v12.432 —— 失败不许静默消失。
 *
 * 起因:全仓 10 处 `onError → style.display='none'`。v12.425 修了 2 处时用的是
 * 「display:none 一律有害」这条朴素规则 —— 这条规则是错的。剩下 8 处里有 6 处
 * 藏得对:底下压着 emoji 图标或 DOM 兜底,把图藏掉恰恰露出身份。
 *
 * 真正该判死的是「藏完什么都不剩」:
 *   - character-lock-section:藏的是 closest('button'),角色**整个选项**从
 *     「从角色库带出」里消失。本机实测 46 个有立绘的角色 41 个会这样蒸发,
 *     用户看到一个只剩 5 个人的角色库,还以为是自己没存过。
 *   - script-export:剧本册里的分镜图挂了就整格不见,出册看不出这镜没图。
 *   - styles/page:藏完只剩一块渐变色块,分不清「风格就长这样」还是「预览没出」。
 *
 * 所以这里锁的是**语义**:每一处藏图,都必须在同一个盒子里留下一个能看见的替身。
 * 白名单精确匹配 —— 新增一处藏图会直接把门禁打红,逼你当场表态它露出的是什么。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MediaThumb } from '@/components/ui/media-thumb';
import { buildScriptBookHtml, pullSheetToMarkdown } from '@/lib/script-export';
import { buildPullSheetFromScript, toShotNumber, pullSheetShortfall, toPullSheetCsv } from '@/lib/pull-sheet';
import { confirmAssetsToServer } from '@/lib/confirm-assets-client';
import { formatMetric, metricSubLabel, emptyStateLabel } from '@/lib/metric-display';
import { toShareShots, playableShotCount, shareShotsLabel } from '@/lib/share-shots';
import { NodeShell } from '@/components/nodes/node-shell';
import { CharacterLockSection } from '@/components/create/character-lock-section';
import { ToastProvider } from '@/components/ui/toast-provider';
import { useProjectWorkspaceStore } from '@/lib/store';
import type { PullSheet, PullSheetShot } from '@/lib/pull-sheet';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

/** 去掉注释再扫 —— 否则 media-thumb 顶上那段讲历史的注释会被当成一处藏图。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

describe('v12.432 · MediaThumb:图挂了要留下痕迹,不是整块消失', () => {
  it('图加载失败 → 容器还在,并说出为什么', () => {
    const { container } = render(<MediaThumb src="/nope.png" alt="林晚" note="缩略图失效" />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();

    fireEvent.error(img);

    // 关键:不是 display:none,是换成一个**看得见的**替身
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('缩略图失效')).toBeTruthy();
    const box = container.firstElementChild as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.display).not.toBe('none');
    expect(box.textContent).toContain('缩略图失效');
  });

  it('src 为空也走替身,而不是渲染一个空 img', () => {
    const { container } = render(<MediaThumb src="" note="素材已失效" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('素材已失效')).toBeTruthy();
  });

  it('换了 src 要重新给一次机会 —— 重生完不该永远停在失效态', () => {
    const { container, rerender } = render(<MediaThumb src="/a.png" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<MediaThumb src="/b.png" />);
    const again = container.querySelector('img');
    expect(again).toBeTruthy();
    expect(again!.getAttribute('src')).toBe('/b.png');
  });
});

describe('v12.432 · 角色库:图没了不等于角色没了', () => {
  const src = read('components/create/character-lock-section.tsx');
  const clean = stripComments(src);

  it('不再藏掉整个可选项(closest 到 button 再 display:none)', () => {
    expect(clean).not.toMatch(/closest\(\s*['"]button['"]\s*\)[\s\S]{0,160}display/);
  });

  it('角色库缩略走 MediaThumb,名字照常渲染', () => {
    // 名字必须和缩略件同级 —— 图挂了名字还在,用户仍然选得到这个角色
    const block = clean.slice(clean.indexOf('libAssets.map('));
    expect(block).toContain('<MediaThumb');
    // 找名字**标签**,不是按钮 title 里那个 {a.name} —— indexOf 会先命中 title,
    // 拿它比顺序等于什么都没测(这个坑上一版刚踩过)。
    const nameLabel = block.match(/truncate\S*">\{a\.name\}</);
    expect(nameLabel).toBeTruthy();
    expect(block.indexOf('<MediaThumb')).toBeLessThan(block.indexOf(nameLabel![0]));
  });
});

describe('v12.432 · 剧本册导出:分镜图挂了要留一格「图未出」', () => {
  const shot = (n: number, thumbnail?: string): PullSheetShot => ({
    shotNumber: n, startSec: (n - 1) * 4, endSec: n * 4, durationSec: 4,
    description: `第 ${n} 镜`, characters: ['林晚'], dialogue: '你来了。', emotion: '克制',
    shotSize: '中景', cameraAngle: '平视', cameraMovement: '固定', lens: '35mm',
    lightingIntent: '侧逆光', storyBeat: '相遇', soundDesign: '风声', scoreMood: '低回',
    thumbnail,
  } as PullSheetShot);

  const sheet = (shots: PullSheetShot[]): PullSheet => ({
    title: '示例片', shotCount: shots.length,
    totalDurationSec: shots.reduce((a, s) => a + s.durationSec, 0), shots,
  } as PullSheet);

  it('有缩略的镜 → 图外面裹一层占位,而不是裸 img', () => {
    const html = buildScriptBookHtml(sheet([shot(1, '/x.png')]), { title: '示例片' });
    expect(html).toContain('thumb-wrap');
    expect(html).toContain('图未出');
    // 占位必须在 img 之前 —— 顺序反了会盖住正常图
    expect(html.indexOf('thumb-missing')).toBeLessThan(html.indexOf('/x.png'));
  });

  it('角色附页同样待遇', () => {
    const html = buildScriptBookHtml(sheet([shot(1)]), {
      title: '示例片',
      characters: [{ name: '林晚', role: '主角', imageUrl: '/c.png' }],
    });
    const seg = html.slice(html.indexOf('/c.png') - 400, html.indexOf('/c.png') + 200);
    expect(seg).toContain('thumb-missing');
    expect(seg).toContain('图未出');
  });

  it('没有缩略的镜不凭空造一格占位', () => {
    const html = buildScriptBookHtml(sheet([shot(1)]), { title: '示例片' });
    expect(html).not.toContain('图未出');
  });

  it('CSS 必须让占位垫在底下,而不是盖在正常图上', () => {
    const css = read('lib/script-export.ts');
    // 占位绝对定位铺满
    expect(css).toMatch(/\.thumb-missing\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.thumb-missing\s*\{[^}]*inset:\s*0/);
    // 外框是定位上下文,否则占位会跑到页面角落
    expect(css).toMatch(/\.thumb-wrap\s*\{[^}]*position:\s*relative/);
    // 分镜图自己也得是定位元素 —— 绝对定位的兄弟会画在非定位元素之上,
    // 少这一行,每张出得来的图上都盖着「图未出」。
    expect(css).toMatch(/\.thumb\s*\{[^}]*position:\s*relative/);
    // 外框是 flex 项,高度靠兄弟文字撑。描述/台词全空的镜头会把它压成 0 高,
    // 占位跟着只剩 2px ——「占位自己也静默消失」等于没修。实测 wrapH=0 / missH=2。
    expect(css).toMatch(/\.thumb-wrap\s*\{[^}]*min-height/);
  });
});

describe('v12.432 · 门禁:每一处藏图都得说清楚它露出的是什么', () => {
  /** 站点 → 藏掉之后同一个盒子里露出来的东西。新增站点必须在这里表态。 */
  const ALLOWED: Record<string, string> = {
    'app/dashboard/styles/page.tsx': '预览未出',
    'app/dashboard/create/page.tsx': 'aria-hidden>{preset.icon}',
    'components/creation/ModeCard.tsx': 'aria-hidden>{preset.icon}',
    'components/creation/CreationWizard.tsx': 'aria-hidden>{modePreset.icon}',
    'components/create/template-library-picker.tsx': 'aria-hidden>{template.icon}',
    'components/nodes/video-node.tsx': '点击播放',
    'lib/script-export.ts': 'thumb-missing',
  };

  const FILES = execFilesToScan();
  const sites = FILES.flatMap((f) => {
    const lines = stripComments(read(f)).split('\n');
    return lines
      .map((l, i) => ({ file: f, line: i, text: l }))
      .filter((x) => /display\s*=\s*['"]none['"]/.test(x.text));
  });

  it('扫得到东西 —— 扫空了等于门禁没开', () => {
    expect(sites.length).toBeGreaterThanOrEqual(7);
  });

  it('没有白名单之外的藏图站点', () => {
    const unknown = [...new Set(sites.map((s) => s.file))].filter((f) => !(f in ALLOWED));
    expect(unknown).toEqual([]);
  });

  it('每一处藏图,同一个盒子里都留着替身', () => {
    const naked: string[] = [];
    for (const s of sites) {
      const lines = stripComments(read(s.file)).split('\n');
      const win = lines.slice(Math.max(0, s.line - 14), s.line + 14).join('\n');
      if (!win.includes(ALLOWED[s.file])) naked.push(`${s.file}:${s.line + 1}`);
    }
    expect(naked).toEqual([]);
  });

  it('白名单里的文件都还真有藏图 —— 修完了就把条目删掉,别留死规则', () => {
    const touched = new Set(sites.map((s) => s.file));
    const stale = Object.keys(ALLOWED).filter((f) => !touched.has(f));
    expect(stale).toEqual([]);
  });
});

function execFilesToScan(): string[] {
  const { execSync } = require('child_process') as typeof import('child_process');
  // 别用 git 的 "lib/**/*.ts":** 至少吃一层目录,顶层的 lib/script-export.ts 会被静默漏掉
  // —— 一个少扫一整层却照样绿的门禁,比没有门禁更坏。这里只按前缀取,扩展名在 JS 里筛。
  // --others --exclude-standard:新加的文件还没 git add 时也要扫到。
  // 上一版就栽在这儿 —— 门禁本地全绿,只因为待测文件还没被 git 跟踪。
  return execSync('git ls-files --cached --others --exclude-standard app components lib', {
    cwd: ROOT, encoding: 'utf-8',
  }).split('\n').filter((f) => /\.tsx?$/.test(f));
}

// ─────────────────────────────────────────────────────────────────────────────
// 后半程:比「图不见了」更狠的一类 —— 失败**长得像成功**。
// 后台对抗复检坐实 5 处,以下逐条锁行为。
// ─────────────────────────────────────────────────────────────────────────────

describe('v12.432 · 「已保存 ✓」不许在没存上的时候亮', () => {
  const okRes = { ok: true, status: 200 } as Response;
  const bad = (status: number) => ({ ok: false, status } as Response);

  it('后端 200 才算成功', async () => {
    const r = await confirmAssetsToServer(PAYLOAD, async () => okRes);
    expect(r).toEqual({ ok: true });
  });

  it('后端 500 → 明确失败,并带上状态码', async () => {
    const r = await confirmAssetsToServer(PAYLOAD, async () => bad(500));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('500');
  });

  it('401/403 单独说清是权限问题 —— 和「网断了」的处置完全不同', async () => {
    for (const code of [401, 403]) {
      const r = await confirmAssetsToServer(PAYLOAD, async () => bad(code));
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toContain('权限');
    }
  });

  it('fetch 抛异常也要如实返回,而不是吞掉变成成功', async () => {
    const r = await confirmAssetsToServer(PAYLOAD, async () => { throw new Error('Failed to fetch'); });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('Failed to fetch');
  });

  it('无论如何自己不抛 —— 调用方不必再套一层 try/catch 来吞', async () => {
    await expect(confirmAssetsToServer(PAYLOAD, async () => { throw 'not-an-error'; })).resolves.toMatchObject({ ok: false });
  });

  it('只准有一份实现 —— 别再各写各的 POST /api/assets/confirm', () => {
    const files = execFilesToScan().filter((f) => !f.startsWith('app/api/'));
    const callers = files.filter((f) => read(f).includes("'/api/assets/confirm'"));
    expect(callers).toEqual(['lib/confirm-assets-client.ts']);
  });
});

describe('v12.432 · 节点「确认保存」:后端失败要看得见', () => {
  it('后端 500 → 不显示「已确认」,显示为什么没存上', async () => {
    useProjectWorkspaceStore.setState({
      currentProject: { id: 'p1', title: 't' } as never,
      assets: [] as never,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    try {
      render(<NodeShell status="completed" color="purple" agentRole={'writer' as never}><div>子节点</div></NodeShell>);
      fireEvent.click(screen.getByText('确认保存'));
      await waitFor(() => expect(screen.getByText(/没存上/)).toBeTruthy());
      expect(screen.queryByText('已确认')).toBeNull();
      expect(screen.getByText(/没存上/).textContent).toContain('500');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('后端 200 → 才亮「已确认」', async () => {
    useProjectWorkspaceStore.setState({
      currentProject: { id: 'p1', title: 't' } as never,
      assets: [] as never,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    try {
      render(<NodeShell status="completed" color="purple" agentRole={'writer' as never}><div>子节点</div></NodeShell>);
      fireEvent.click(screen.getByText('确认保存'));
      await waitFor(() => expect(screen.getByText('已确认')).toBeTruthy());
      expect(screen.queryByText(/没存上/)).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('没有项目实体(草稿态)→ 标成「已确认(未入库)」,不冒充真入库', async () => {
    useProjectWorkspaceStore.setState({ currentProject: null as never, assets: [] as never });
    render(<NodeShell status="completed" color="purple" agentRole={'writer' as never}><div>子节点</div></NodeShell>);
    fireEvent.click(screen.getByText('确认保存'));
    await waitFor(() => expect(screen.getByText('已确认(未入库)')).toBeTruthy());
  });
});

describe('v12.432 · 统计卡:0 是结论,只有真读到才配写', () => {
  it('接口挂了显示破折号,并说明不是 0', () => {
    expect(formatMetric('failed', 0)).toBe('—');
    expect(formatMetric('failed', 42)).toBe('—');
    expect(metricSubLabel('failed', '个项目')).toContain('不是 0');
  });

  it('还没读完也不写 0', () => {
    expect(formatMetric('loading', 0)).toBe('—');
    expect(metricSubLabel('loading', '个项目')).not.toBe('个项目');
  });

  it('真读到 0 才写 0,副标题恢复原样', () => {
    expect(formatMetric('ok', 0)).toBe('0');
    expect(metricSubLabel('ok', '个项目')).toBe('个项目');
  });

  it('dashboard 真的用了它 —— 造好没接线等于没修', () => {
    const src = read('app/dashboard/page.tsx');
    expect(src).toContain("from '@/lib/metric-display'");
    expect(src).toContain('formatMetric(metricsState');
    expect(src).toContain('metricSubLabel(metricsState');
    // 三张卡都得走,漏一张就还留着一个会撒谎的 0
    expect(src.match(/\{stat\(metrics\./g) || []).toHaveLength(3);
    expect(src).not.toMatch(/>\{metrics\.(projects|generations|cases)\}</);
  });
});

describe('v12.432 · 分享页:标题上的镜数要等于看得见的格子数', () => {
  const rows = (n: number, withUrl: number) =>
    Array.from({ length: n }, (_, i) => ({
      shot_number: i + 1,
      media_urls: i < withUrl ? JSON.stringify([`https://cdn/${i}.mp4`]) : '[]',
      persistent_url: null,
    }));

  it('5 镜只出片 2 → 标题说「已出片 2/5」,不写 5', () => {
    const shots = toShareShots(rows(5, 2));
    expect(playableShotCount(shots)).toBe(2);
    expect(shareShotsLabel(shots)).toBe('已出片 2/5');
  });

  it('全出齐了就只写总数,不啰嗦', () => {
    expect(shareShotsLabel(toShareShots(rows(4, 4)))).toBe('4');
  });

  it('空串 URL 也算没出片 —— regenerate 失败会写进 [""]', () => {
    const shots = toShareShots([{ shot_number: 1, media_urls: '[""]', persistent_url: null }]);
    expect(shots[0].url).toBe('');
    expect(shareShotsLabel(shots)).toBe('已出片 0/1');
  });

  it('media_urls 是坏 JSON 时当没出片,不炸页面', () => {
    const shots = toShareShots([{ shot_number: 1, media_urls: '{坏', persistent_url: null }]);
    expect(shots[0].url).toBe('');
  });

  it('持久化副本优先 —— 分享链接最怕 CDN 过期', () => {
    const shots = toShareShots([{ shot_number: 1, media_urls: JSON.stringify(['https://cdn/x.mp4']), persistent_url: '/local/x.mp4' }]);
    expect(shots[0].url).toBe('/local/x.mp4');
  });

  it('分享页真的用了它,而且缺的镜头留着格子(不许 return null)', () => {
    const src = read('app/share/[token]/page.tsx');
    expect(src).toContain("from '@/lib/share-shots'");
    expect(src).toContain('shareShotsLabel(shots)');
    expect(src).toContain('这镜还没出片');
    // 「不存在」类断言必须先去注释 —— 讲这段历史的注释里就写着旧代码,
    // 拿原文断言等于被自己的注释挡住,永远绿。
    const code = stripComments(src);
    expect(code).not.toContain('if (!url) return null');
    expect(code).not.toContain('分镜 ({videoRows.length})');
  });
});

describe('v12.432 · 「重试镜头」点了要有下文', () => {
  const src = read('app/dashboard/create/page.tsx');

  it('不再是 fetch(...).catch(() => {}) 打发掉', () => {
    const at = src.indexOf('regenerate-shot');
    expect(at).toBeGreaterThan(0);
    const seg = src.slice(at - 600, at + 1400);
    // 先自证窗口切对了 —— 只写 not.* 的话,窗口切歪了照样绿,等于没测
    expect(seg).toContain('重试镜头');
    expect(seg).toContain('regenerate-shot');
    expect(seg).not.toMatch(/regenerate-shot[\s\S]{0,400}\.catch\(\(\) => \{\}\)/);
  });

  it('成功、失败、发不出去,三种都会说话', () => {
    const at = src.indexOf('regenerate-shot');
    const seg = src.slice(at - 600, at + 1600);
    expect(seg).toContain('重试没发出去');   // HTTP 非 2xx
    expect(seg).toContain('重试失败');       // 流里回了 error 事件
    expect(seg).toContain('已重生');         // 成功
    expect(seg).toContain('重试请求失败');   // fetch 抛异常
  });

  it('会把 SSE 流读完再下结论 —— 不读就永远不知道成没成', () => {
    const at = src.indexOf('regenerate-shot');
    const seg = src.slice(at, at + 1400);
    expect(seg).toMatch(/await res\.text\(\)/);
  });
});

const PAYLOAD = { projectId: 'p1', agentRole: 'writer', assets: [] };

describe('v12.432 · 在线指示灯不许永远说在线', () => {
  const src = read('app/dashboard/page.tsx');

  it('绿点和文案都跟着 metricsState 走,不是写死的', () => {
    // 正向自证:窗口里确实是那盏灯
    expect(src).toContain('t.dashboard.systemOnline');
    const at = src.indexOf('t.dashboard.systemOnline');
    const seg = src.slice(at - 700, at + 200);
    expect(seg).toContain('接口没响应');
    expect(seg).toContain('连接中…');
    // 锁行为而不是锁类名顺序:**这盏灯自己的颜色**必须由状态算出来。
    // 第一版写的是 not.toContain('rounded-full bg-emerald-400 animate-pulse'),
    // 把它改回写死的绿点照样绿 —— 因为类名换个顺序那串字面量就不出现了。
    const dotAt = seg.indexOf('w-1.5 h-1.5 rounded-full');
    expect(dotAt).toBeGreaterThan(-1);
    const dot = seg.slice(dotAt, seg.indexOf('/>', dotAt));
    expect(dot).toContain('metricsState');
  });
});

describe('v12.432 · 拉片表:镜号读不出来不许把整镜悄悄扔掉', () => {
  const mk = (shotNumbers: unknown[]) => ({
    title: '示例片',
    shots: shotNumbers.map((n, i) => ({ shotNumber: n, sceneDescription: `第 ${i} 镜`, duration: 4 })),
  });

  it('纯数字字符串是合法镜号 —— 修前这些镜整条被扔掉且不留痕迹', () => {
    const sheet = buildPullSheetFromScript(mk([1, '2', ' 3 ', 4]));
    expect(sheet.shots.map((s) => s.shotNumber)).toEqual([1, 2, 3, 4]);
    expect(sheet.droppedShots).toBe(0);
  });

  it('不是数字就别硬转 —— Number([]) 和 Number(\'\') 都是 0,会凭空造出第 0 镜', () => {
    for (const bad of [[], '', '   ', true, false, null, undefined, {}, 'S3', NaN, Infinity]) {
      expect(toShotNumber(bad)).toBeNull();
    }
    // 正向自证:上面那串确实是被这个函数判掉的,而不是函数永远返回 null
    expect(toShotNumber(7)).toBe(7);
    expect(toShotNumber('7')).toBe(7);
    expect(toShotNumber('-2.5')).toBe(-2.5);
  });

  it('真扔了几镜要数出来,不是假装本来就这么多', () => {
    const sheet = buildPullSheetFromScript(mk([1, 'S2', 3, null]));
    expect(sheet.shotCount).toBe(2);
    expect(sheet.droppedShots).toBe(2);
  });

  it('镜号归一后,分镜图/视频要按归一后的号对上', () => {
    const sheet = buildPullSheetFromScript(mk(['5']), {
      storyboards: [{ shotNumber: 5, url: '/sb5.png' }],
      videos: [{ shotNumber: 5, url: '/v5.mp4' }],
    });
    expect(sheet.shots[0].thumbnail).toBe('/sb5.png');
    expect(sheet.shots[0].videoUrl).toBe('/v5.mp4');
  });
});

describe('v12.432 · 残表/空表要自己说出来', () => {
  const sheetOf = (shotCount: number, droppedShots: number) => ({ shotCount, droppedShots });

  it('全须全尾就闭嘴', () => {
    expect(pullSheetShortfall(sheetOf(6, 0))).toBeNull();
  });

  it('丢了镜要说丢了几镜', () => {
    const n = pullSheetShortfall(sheetOf(4, 2));
    expect(n).toContain('2 镜');
    expect(n).toContain('不是全本');
  });

  it('一镜都没有要说清是「读不到」不是「本来就没有」', () => {
    expect(pullSheetShortfall(sheetOf(0, 0))).toContain('空的');
  });

  it('CSV 把这句写进表里,而且不破坏「首行是表头」', () => {
    const full = buildPullSheetFromScript({ title: 'x', shots: [{ shotNumber: 1, duration: 3 }] });
    const partial = buildPullSheetFromScript({ title: 'x', shots: [{ shotNumber: 1, duration: 3 }, { shotNumber: 'S2' }] });
    expect(toPullSheetCsv(full)).not.toContain('⚠');
    const csv = toPullSheetCsv(partial);
    expect(csv).toContain('⚠');
    expect(csv).toContain('1 镜');
    // 表头仍在第一行 —— 说明是追加不是插队
    expect(csv.split('\r\n')[0]).toContain('镜头');
  });

  it('Markdown 剧本册在标题下面就说', () => {
    const partial = buildPullSheetFromScript({ title: 'x', shots: [{ shotNumber: 1, duration: 3 }, { shotNumber: 'S2' }] });
    const md = pullSheetToMarkdown(partial, { title: 'x' });
    expect(md).toContain('⚠️');
    expect(md).toContain('1 镜');
    expect(md.indexOf('⚠️')).toBeLessThan(md.indexOf('## S1'));
  });

  it('PDF/HTML 册子印在标题正下方,且有底色不会被当正文', () => {
    const partial = buildPullSheetFromScript({ title: 'x', shots: [{ shotNumber: 1, duration: 3 }, { shotNumber: 'S2' }] });
    const html = buildScriptBookHtml(partial, { title: 'x' });
    expect(html).toContain('class="shortfall"');
    expect(html).toMatch(/\.shortfall\s*\{[^}]*background/);
    const full = buildScriptBookHtml(buildPullSheetFromScript({ title: 'x', shots: [{ shotNumber: 1, duration: 3 }] }), { title: 'x' });
    expect(full).not.toContain('class="shortfall"');
  });
});

describe('v12.432 · 「你还没创作过」和「我读不到」是两句话', () => {
  it('读挂了不许沿用空态文案', () => {
    const empty = '还没有动态 —— 创建第一个项目后,这里会显示你的真实进度';
    expect(emptyStateLabel('ok', empty)).toBe(empty);
    expect(emptyStateLabel('failed', empty)).not.toBe(empty);
    expect(emptyStateLabel('failed', empty)).toContain('加载失败');
    expect(emptyStateLabel('loading', empty)).not.toBe(empty);
  });

  it('同一页里数字和列表口径必须一致 —— 只修一半是这族 bug 的复发方式', () => {
    const src = read('app/dashboard/page.tsx');
    // 正向自证:窗口里确实是那两条取数
    expect(src).toContain('api.metrics()');
    expect(src).toContain('api.generations()');
    const code = stripComments(src);
    // 两条取数都不许再以裸 .catch(() => {}) 收场
    expect(code).not.toMatch(/api\.metrics\(\)[\s\S]{0,200}\.catch\(\(\) => \{\}\)/);
    expect(code).not.toMatch(/api\.generations\(\)[\s\S]{0,200}\.catch\(\(\) => \{\}\)/);
    expect(code).toContain('setGenerationsState');
    expect(code).toContain('emptyStateLabel(generationsState');
  });
});

describe('v12.432 · 角色库选项:图挂了也得选得到', () => {
  const LIB = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `角色${i}`, thumbnail: `/face-${i}.png` }));

  it('12 张缩略图全挂,12 个选项一个都不能少,而且照样点得动', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ assets: LIB }),
    } as unknown as Response);
    const picked: unknown[] = [];
    try {
      const { container } = render(
        <ToastProvider>
          <CharacterLockSection value={[]} onChange={(n) => picked.push(n)} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText(/从角色库带出/));
      await waitFor(() => expect(screen.getByText('角色0')).toBeTruthy());

      const imgs = [...container.querySelectorAll('img')].filter((i) => /face-\d+\.png$/.test(i.getAttribute('src') || ''));
      expect(imgs.length).toBe(12);

      // 修前:每个 onError 都会 closest('button').style.display='none' —— 12 个选项全消失。
      // 实测本机 46 个有立绘的角色 41 个会这样蒸发,用户看到一个只剩 5 人的角色库。
      imgs.forEach((i) => fireEvent.error(i));

      for (let i = 0; i < 12; i++) expect(screen.getByText(`角色${i}`)).toBeTruthy();
      expect(screen.getAllByText('缩略图失效').length).toBe(12);
      expect(container.querySelectorAll('[style*="display: none"]').length).toBe(0);

      // 图没了不等于角色没了 —— 还得能带出来
      fireEvent.click(screen.getByText('角色3'));
      await waitFor(() => expect(picked.length).toBeGreaterThan(0));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
