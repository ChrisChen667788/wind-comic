/**
 * v12.466 · 项目格式条的「色彩」真的进分镜出图了 —— 修前它存进库,没有任何代码读。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * v12.464 查格式条的「画幅」时顺带确认:`project-format` 资产里只有 `fps` 有读者(EDL / AAF 导出、片段重拍)。
 * `colorSpaceId` 只被 `compileFormatPrompt()` 编进提示词片段,而这个函数全仓零调用。
 * 用户选 A:接上真实读者 —— 写进分镜出图提示词。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. 改写规则(纯函数):写在 `--no …` 参数之前;旧色彩段被换掉而不是叠加;「不指定」只删不加;用户自己写的不动;
 * 2. 注入口(真库):没保存过格式 / 选了「不指定」/ 没有项目 id → 一个字不改;读库失败 → 原样,不打挂出图;
 * 3. 三条路由真跑,截获送进出图引擎的提示词:整张重生、九宫格候选、批量 Cameo 重试;
 *    (编排器里的整片渲染与导演复审重出见 v12-466-color-space-orchestrator,需要真编排器,与这里的桩冲突)
 * 4. 出图入口登记表:app/api 下每个调 `generateImage` 的路由要么接了注入口,要么登记了不接的理由 —— 新路由不能悄悄漏;
 * 5. 色彩段只在 lib/project-format(-store) 里拼,别处不得自己拼(按 AST 取标识符,不 grep 原文)。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u-465' })) }));
vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-465' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: vi.fn(async () => ({ allow: true })) }));

/** 读库失败开关:注入口必须吞掉,不能把出图打挂 */
const repoFault = { on: false };
vi.mock('@/lib/repos/asset-repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/repos/asset-repo')>();
  return {
    ...real,
    listAssetsByType: vi.fn(async (...args: Parameters<typeof real.listAssetsByType>) => {
      if (repoFault.on && args[1] === 'project-format') throw new Error('db down');
      return real.listAssetsByType(...args);
    }),
  };
});

/** 截获送进出图引擎的提示词(generateImage),以及 Cameo 重试收到的原句 */
const captured: string[] = [];
const cameoInputs: string[] = [];
vi.mock('@/services/hybrid-orchestrator', () => ({
  HybridOrchestrator: class {
    setUserStyle() {}
    setPrimaryCharacterRef() {}
    setAspect() {}
    async generateImage(prompt: string) { captured.push(prompt); return 'https://img.test/out.png'; }
    async cameoRetrySingleShot(input: { shotNumber: number; originalPrompt: string }) {
      cameoInputs.push(input.originalPrompt);
      return { shotNumber: input.shotNumber, finalImageUrl: 'https://img.test/cameo.png', cameoScore: 80, firstScore: 60, cameoRetried: true, finalCw: 125, reasoning: 'ok', needsHumanReview: false };
    }
  },
}));

import { db, now } from '@/lib/db';
import { createAsset, updateAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { withColorSpaceClause, COLOR_SPACES } from '@/lib/project-format';
import { withColorSpace } from '@/lib/project-format-store';

const P3 = '. Color: DCI-P3 wide gamut';
const LOGC = '. Color: ARRI LogC4 latitude';
const R709 = '. Color: Rec.709 broadcast color';
const ACES = '. Color: ACES color pipeline, filmic tonal range';
const NO_PARAMS = ' --no text --no words';

const T = Date.now();
const PID = `p465-${T}`;          // 保存过格式(会被各用例改成不同色彩)
const PID_NONE = `p465n-${T}`;    // 从没保存过格式

async function setColor(colorSpaceId: string) {
  const rows = await listAssetsByType(PID, 'project-format');
  const data = { colorSpaceId, fps: 24, safeArea: false };
  if (rows.length) await updateAsset(rows[0].id, { data });
  else await createAsset({ projectId: PID, type: 'project-format', name: 'project-format', data });
}

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run('u-465', 'u465@test.local', 'x', 'u465', now());
  for (const id of [PID, PID_NONE]) {
    db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, 'v12.466', 'draft', '9:16', ?, ?)`)
      .run(id, 'u-465', now(), now());
    // Cameo 批量重试的前置:一张角色图 + 一镜分镜。用第 2 镜 —— 整张重生的用例会往第 1 镜写新行(不带 description)
    await createAsset({ projectId: id, type: 'character', name: '林晚', data: {}, mediaUrls: ['https://img.test/char.png'] });
    await createAsset({ projectId: id, type: 'storyboard', name: 'Shot 2', shotNumber: 2, data: { description: 'a rainy street at night' }, mediaUrls: ['https://img.test/sb2.png'] });
  }
});

afterEach(() => { captured.length = 0; cameoInputs.length = 0; repoFault.on = false; });

describe('v12.466 · 改写规则(纯函数)', () => {
  it('没有参数:接在句末', () => {
    expect(withColorSpaceClause('a rainy street', 'p3')).toBe(`a rainy street${P3}`);
  });

  it('**有 `--no …` 参数:写在参数之前**(落在参数后面会被当成参数的一部分)', () => {
    const out = withColorSpaceClause(`a rainy street${NO_PARAMS}`, 'p3');
    expect(out).toBe(`a rainy street${P3}${NO_PARAMS}`);
  });

  it('**上次落库的成品(已带 ACES 段 + 参数)改成 Rec.709:换掉,不叠加**', () => {
    const persisted = `a rainy street${ACES}, cinematic lighting${NO_PARAMS}`;
    const out = withColorSpaceClause(persisted, 'rec709');
    expect(out).not.toContain('ACES');
    expect(out.split(R709).length - 1).toBe(1);
    expect(out.indexOf(R709)).toBeLessThan(out.indexOf('--no text'));
    expect(out, '其余内容原样保留').toContain('a rainy street');
    expect(out).toContain(', cinematic lighting');
  });

  it('「不指定」/ 未知值 / 空:只删旧色彩段,不加;没有色彩段的句子一字不改(正常侧)', () => {
    expect(withColorSpaceClause(`a rainy street${LOGC}${NO_PARAMS}`, 'none')).toBe(`a rainy street${NO_PARAMS}`);
    for (const id of ['none', 'NOPE', undefined, null, '']) {
      expect(withColorSpaceClause(`a rainy street${NO_PARAMS}`, id as string)).toBe(`a rainy street${NO_PARAMS}`);
    }
  });

  it('幂等:同一色彩写两遍等于写一遍', () => {
    for (const p of COLOR_SPACES) {
      const once = withColorSpaceClause(`a hero${NO_PARAMS}`, p.id);
      expect(withColorSpaceClause(once, p.id), p.id).toBe(once);
    }
  });

  it('用户自己写的 "Color: warm" 不是预设原句,不删', () => {
    expect(withColorSpaceClause('a hero. Color: warm amber', 'none')).toBe('a hero. Color: warm amber');
  });

  it('不再往静帧里写帧率(旧 compileFormatPrompt 会写「120fps slow motion」)', async () => {
    const mod = await import('@/lib/project-format');
    expect(Object.keys(mod)).not.toContain('compileFormatPrompt');
    for (const p of COLOR_SPACES) expect(withColorSpaceClause('x', p.id)).not.toMatch(/fps/i);
  });
});

describe('v12.466 · 注入口 withColorSpace(真库)', () => {
  it('**从没保存过格式的项目:一字不改**(默认值不能悄悄改掉所有项目的出图)', async () => {
    expect(await withColorSpace(PID_NONE, `a hero${NO_PARAMS}`)).toBe(`a hero${NO_PARAMS}`);
  });

  it('保存了 LogC4:写进去', async () => {
    await setColor('logc4');
    expect(await withColorSpace(PID, `a hero${NO_PARAMS}`)).toBe(`a hero${LOGC}${NO_PARAMS}`);
  });

  it('保存了「不指定」:一字不改', async () => {
    await setColor('none');
    expect(await withColorSpace(PID, `a hero${NO_PARAMS}`)).toBe(`a hero${NO_PARAMS}`);
  });

  it('没有项目 id(工作流画布等不带项目的调用):一字不改', async () => {
    expect(await withColorSpace(undefined, 'a hero')).toBe('a hero');
    expect(await withColorSpace('', 'a hero')).toBe('a hero');
  });

  it('**读库失败:原样返回,不抛**(色彩是增强项)', async () => {
    await setColor('p3');
    repoFault.on = true;
    await expect(withColorSpace(PID, 'a hero')).resolves.toBe('a hero');
    repoFault.on = false;
    expect(await withColorSpace(PID, 'a hero'), '窗口自证:同一项目不出错时确实会写').toBe(`a hero${P3}`);
  });
});

const req = (url: string, body: unknown) => new Request(`http://t${url}`, { method: 'POST', body: JSON.stringify(body) }) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('v12.466 · 路由真跑:送进出图引擎的提示词', () => {
  async function regen(id: string, customPrompt: string) {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-storyboard/route');
    const res = await POST(req(`/api/projects/${id}/regenerate-storyboard`, { shotNumber: 1, customPrompt }), params(id));
    await res.text();   // 读完 SSE 流,出图才算跑完
    expect(captured.length, '确实调到了出图').toBe(1);
    return captured.splice(0)[0];
  }

  it('**整张重生**:带项目色彩,且在 `--no` 参数之前', async () => {
    await setColor('logc4');
    const p = await regen(PID, 'a rainy street at night, two people facing off');
    expect(p).toContain(LOGC);
    expect(p.indexOf(LOGC)).toBeLessThan(p.indexOf('--no text'));
  });

  it('**整张重生拿上次的成品再生(换了色彩):只剩新的那一段**', async () => {
    await setColor('logc4');
    const first = await regen(PID, 'a rainy street at night');
    await setColor('rec709');
    const second = await regen(PID, first);   // 用户点「重生」时,输入框里常是上次落库的成品
    expect(second).not.toContain('LogC4');
    expect(second.split(R709).length - 1).toBe(1);
    expect(second.indexOf(R709)).toBeLessThan(second.indexOf('--no text'));
  });

  it('整张重生,没保存过格式的项目:提示词里没有色彩段(正常侧)', async () => {
    const p = await regen(PID_NONE, 'a rainy street at night');
    expect(p).toContain('a rainy street at night');
    expect(p).not.toContain('. Color:');
  });

  it('**九宫格候选**:每一格都带项目色彩,且在参数之前', async () => {
    await setColor('p3');
    const { POST } = await import('@/app/api/projects/[id]/candidates/route');
    const res = await POST(req(`/api/projects/${PID}/candidates`, { shotNumber: 1, basePrompt: 'a rainy street at night', count: 4 }), params(PID));
    await res.text();
    expect(captured.length, '四格都出了').toBe(4);
    for (const p of captured) {
      expect(p).toContain(P3);
      expect(p.indexOf(P3)).toBeLessThan(p.indexOf('--no text'));
    }
  });

  it('九宫格候选,没保存过格式的项目:没有色彩段(正常侧)', async () => {
    const { POST } = await import('@/app/api/projects/[id]/candidates/route');
    const res = await POST(req(`/api/projects/${PID_NONE}/candidates`, { shotNumber: 1, basePrompt: 'a rainy street at night', count: 4 }), params(PID_NONE));
    await res.text();
    expect(captured.length).toBe(4);
    for (const p of captured) expect(p).not.toContain('. Color:');
  });

  it('**批量 Cameo 重试**:编排器收到的原句带项目色彩(重出的图在这句上追加锁脸描述)', async () => {
    await setColor('aces');
    const { POST } = await import('@/app/api/projects/[id]/cameo-retry-storyboard/route');
    const res = await POST(req(`/api/projects/${PID}/cameo-retry-storyboard`, { shotNumbers: [2] }), params(PID));
    expect(res.status).toBe(200);
    expect(cameoInputs).toEqual([`a rainy street at night${ACES}`]);
  });

  it('批量 Cameo 重试,没保存过格式的项目:原句不变(正常侧)', async () => {
    const { POST } = await import('@/app/api/projects/[id]/cameo-retry-storyboard/route');
    const res = await POST(req(`/api/projects/${PID_NONE}/cameo-retry-storyboard`, { shotNumbers: [2] }), params(PID_NONE));
    expect(res.status).toBe(200);
    expect(cameoInputs).toEqual(['a rainy street at night']);
  });
});

// ── 源码扫描(按 TypeScript AST,注释与字符串里的不算) ─────────────────────
function sourceFiles(dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
      if (/\.tsx?$/.test(rel)) out.push(path.join(dir, rel).split(path.sep).join('/'));
    }
  }
  return out;
}
function parse(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
/** 文件里作为标识符 / 属性名出现的名字 */
function identifiers(file: string): Set<string> {
  const sf = parse(file);
  const names = new Set<string>();
  const walk = (n: ts.Node) => { if (ts.isIdentifier(n)) names.add(n.text); ts.forEachChild(n, walk); };
  walk(sf);
  return names;
}
/**
 * 文件里有没有出图调用:`xxx.generateImage(` / `generateImageWithRefs(` / `editImage(`(含 `(orchestrator as any).generateImage(`),
 * 以及 provider 注册表的 `dispatchImageGenerate(`。初版只认 generateImage,自查时发现
 * regenerate-asset-image / 角色工作室 / 系列封面三条走注册表的路扫不到 —— 那正是新路由漏网的方式。
 */
const IMAGE_CALLS = new Set(['generateImage', 'generateImageWithRefs', 'editImage', 'dispatchImageGenerate']);
function callsGenerateImage(file: string): boolean {
  const sf = parse(file);
  let hit = false;
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
      if (IMAGE_CALLS.has(name)) hit = true;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hit;
}

/**
 * app/api 下所有出图路由的去向。新加一个出图路由,必须在这里二选一 —— 这正是 twin-path 病的入口:
 * v12.440 站位只接了整片生成,单镜重生等四条路三个版本都没人发现。
 */
const COLORED = [
  'app/api/projects/[id]/regenerate-storyboard/route.ts',
  'app/api/projects/[id]/candidates/route.ts',
];
const NOT_COLORED: Record<string, string> = {
  'app/api/projects/[id]/covers/route.ts': '封面是发布用的海报,不是成片画面',
  'app/api/projects/[id]/shot-sketch/route.ts': '构图草图是黑白线稿,色彩描述没有意义',
  'app/api/preview-shot/route.ts': '建项目前的试拍,还没有项目,也就没有项目格式',
  'app/api/tools/video-compare/route.ts': '引擎对比工具,不属于任何项目',
  'app/api/projects/[id]/regenerate-asset-image/route.ts': '角色 / 场景设定图,是出分镜时的参考图,不是成片画面',
  'app/api/characters/[id]/studio/route.ts': '角色库的多视角设定图,不属于某个项目',
  'app/api/series/[id]/cover/route.ts': '系列封面,发布用的海报',
};

describe('v12.466 · 出图入口登记表', () => {
  const routes = sourceFiles(['app/api']).filter(callsGenerateImage);

  it('扫描器自证:扫得到已知的出图路由', () => {
    expect(routes).toContain('app/api/projects/[id]/regenerate-storyboard/route.ts');
    expect(routes, '走 provider 注册表的出图也扫得到').toContain('app/api/series/[id]/cover/route.ts');
    expect(routes.length).toBeGreaterThanOrEqual(COLORED.length + Object.keys(NOT_COLORED).length);
  });

  it('**每个出图路由都已归类:接了色彩,或登记了不接的理由**', () => {
    const unclassified = routes.filter((f) => !COLORED.includes(f) && !(f in NOT_COLORED));
    expect(unclassified, '新出图路由:接 withColorSpace,或在 NOT_COLORED 里写明理由').toEqual([]);
  });

  it('登记为「接了」的路由确实调用了注入口', () => {
    for (const f of [...COLORED, 'app/api/projects/[id]/cameo-retry-storyboard/route.ts']) {
      expect(identifiers(f).has('withColorSpace'), f).toBe(true);
    }
  });

  it('登记表里没有已经不存在的文件', () => {
    for (const f of [...COLORED, ...Object.keys(NOT_COLORED)]) expect(fs.existsSync(f), f).toBe(true);
  });

  it('**色彩段只在 lib/project-format(-store) 里拼**:别处不得直接用预设或改写函数', () => {
    const own = new Set(['lib/project-format.ts', 'lib/project-format-store.ts']);
    const offenders: string[] = [];
    for (const f of sourceFiles(['app', 'components', 'lib', 'services'])) {
      if (own.has(f)) continue;
      const ids = identifiers(f);
      for (const name of ['withColorSpaceClause', 'getColorSpace', 'compileFormatPrompt']) if (ids.has(name)) offenders.push(`${f}: ${name}`);
    }
    expect(offenders).toEqual([]);
    // 窗口自证:格式条用 COLOR_SPACES 画下拉框,扫描器看得到它
    expect(identifiers('components/project/project-format-bar.tsx').has('COLOR_SPACES')).toBe(true);
  });
});
