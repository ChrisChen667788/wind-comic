/**
 * v13.13 · 格式条的帧率真的决定成片了 —— 修前成片在合成器里写死 24fps,格式条的值只进 EDL / AAF 时间码。
 *
 * ── 来龙去脉 ──────────────────────────────────────────────────────────
 * v13.4 查清了这个字段的三个读者:EDL / AAF 时间码、片段重拍(已改按原片帧率)、以及……没有了 ——
 * 成片在 video-composer 里每镜都过 `fps=24`,片头片尾字卡 `-r 24`,整季合集 `fps=24`。所以 v13.4 先把标签改成
 * 「导出帧率」、悬停写明「成片固定 24fps」。这一版让它名副其实:
 *   - 标签「成片帧率」,只给 24 / 25 / 30(把 24–30fps 的素材换到 48 / 60 只是重复帧);旧值 48 / 60 / 120 回落 24;
 *   - 整片生成(editor-agent 主合成 + 简化合成)、重新合成都按项目成片帧率出片(读口 `projectFilmFps()`);
 *   - 片头 / 片尾字卡、整季合集跟随所拼成片的实际帧率,不再写死 24 —— 否则 30fps 的成片加卡后又被换回 24;
 *   - EDL / AAF 时间码仍读同一个值,与成片一致;片段重拍仍按原片帧率(见 v13-4-export-fps)。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. 格式条:标签、三档选项、悬停说明;旧值回落;
 * 2. `projectFilmFps()` 真库:没项目 / 没存过 / 读库失败 → 24,存了 30 → 30;
 * 3. 真 ffmpeg:`composeVideo({ fps })` 出 24 / 25 / 30fps 的成片(含有一镜被调速、走 xfade 的那种 —— 变速补帧
 *    必须补成片帧率,Linux 7.0.2 上补错就整片合成失败);字卡与整季合集跟随来源帧率;
 * 4. 合成调用方登记表(按 AST,认 `{ composeVideo: 别名 }`):每个项目合成都传 fps 且来自 `projectFilmFps()`;
 *    合成器里不再写死帧率字面量;
 * 5. 对外文档那句。
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { execFileSync, spawnSync } from 'node:child_process';

/** 读库失败开关:projectFilmFps 必须吞掉,回落 24 */
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

// 剪映导出路由要登录:测试用户就是 pid() 建项目时用的 u-v1313(属主守卫照常生效)
vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: 'u-v1313' }) };
});

import { FRAME_RATES, normalizeProjectFormat } from '@/lib/project-format';
import { projectFilmFps } from '@/lib/project-format-store';
import { createAsset } from '@/lib/repos/asset-repo';
import { db, now } from '@/lib/db';
import { resolveFFmpegPath, resolveFFprobePath } from '@/lib/ffmpeg-bin'; // v13.8 起二进制解析只在 lib/ffmpeg-bin
import { serveFilePathUrl } from '@/lib/serve-file-sign';
// 静态导入:后面字卡那组会 vi.resetModules(),之后再动态 import 路由会拿到另一份 lib/db,看不到这里建的项目
import { NextRequest } from 'next/server';
import { GET as jianyingGET, POST as jianyingPOST } from '@/app/api/projects/[id]/export-jianying/route';

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  repoFault.on = false;
});

async function renderBar(initialFormat?: object) {
  const { render } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { ProjectFormatBar } = await import('@/components/project/project-format-bar');
  const { container } = render(React.createElement(ProjectFormatBar, { projectId: 'p1', aspect: '16:9', initialFormat }));
  const fpsLabel = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('成片帧率'));
  return { container, fpsLabel };
}

describe('v13.13 · 格式条:成片帧率', () => {
  it('**标签「成片帧率」,只有 24 / 25 / 30,没有「升格」**', async () => {
    const { container, fpsLabel } = await renderBar();
    expect(fpsLabel, '找得到「成片帧率」').toBeTruthy();
    expect([...fpsLabel!.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['24fps', '25fps', '30fps']);
    expect(FRAME_RATES).toEqual([24, 25, 30]);
    expect(container.textContent).not.toContain('升格');
    expect(container.textContent).not.toContain('导出帧率');
  });

  it('悬停说明:按它合成、时间码也用它、已出的成片不变、不是慢动作', async () => {
    const title = (await renderBar()).fpsLabel!.title;
    for (const s of ['成片按这个帧率合成', '已出的成片不变', 'EDL / AAF', '不会出慢动作']) expect(title, s).toContain(s);
    expect(title, '不能再说成片固定 24fps').not.toContain('固定 24fps');
  });

  it('**旧值 48 / 60 / 120 回落 24**(修前的成片就是 24);25 / 30 原样', async () => {
    for (const v of [48, 60, 120]) expect(normalizeProjectFormat({ fps: v }).fps, String(v)).toBe(24);
    expect(normalizeProjectFormat({ fps: 25 }).fps).toBe(25);
    expect(normalizeProjectFormat({ fps: 30 }).fps).toBe(30);
    const { fpsLabel } = await renderBar({ colorSpaceId: 'none', fps: 60, safeArea: false });
    expect(fpsLabel!.querySelector('select')!.value).toBe('24');
  });
});

const PID = `v1313-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const pid = (n: number) => {
  const id = `${PID}-${n}`;
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-v1313', 'u-v1313@t.local', 'x', 't', 'user', ?)`).run(now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, 'u-v1313', 'v13.13', 'draft', ?, ?)`).run(id, now(), now());
  return id;
};
const saveFps = (projectId: string, fps: number) =>
  createAsset({ projectId, type: 'project-format', name: 'project-format', data: { colorSpaceId: 'none', fps, safeArea: false } });

describe('v13.13 · projectFilmFps()(真库)', () => {
  it('存了 30 → 30;存了 25 → 25', async () => {
    const a = pid(1); await saveFps(a, 30);
    const b = pid(2); await saveFps(b, 25);
    expect(await projectFilmFps(a)).toBe(30);
    expect(await projectFilmFps(b)).toBe(25);
  });

  it('没存过格式 / 没有项目 id → 24(修前写死的值)', async () => {
    expect(await projectFilmFps(pid(3))).toBe(24);
    expect(await projectFilmFps(undefined)).toBe(24);
    expect(await projectFilmFps('')).toBe(24);
  });

  it('旧资产存的 60 → 24', async () => {
    const id = pid(4); await saveFps(id, 60);
    expect(await projectFilmFps(id)).toBe(24);
  });

  it('**读库失败 → 24,不抛**(出片不能被格式读取打挂)', async () => {
    const id = pid(5); await saveFps(id, 30);
    repoFault.on = true;
    await expect(projectFilmFps(id)).resolves.toBe(24);
    repoFault.on = false;
    expect(await projectFilmFps(id), '窗口自证:不出错时确实读到 30').toBe(30);
  });
});

// ── 真 ffmpeg ──────────────────────────────────────────────────────────
const FF = resolveFFmpegPath();
const FP = resolveFFprobePath();
const HAS_FFMPEG = spawnSync(FF, ['-version']).status === 0 && spawnSync(FP, ['-version']).status === 0;
/** 字卡要 drawtext:Linux 的 ffmpeg-static 7.0.2(CI)没编进去。按构建能力判断,不赌 runner 上碰巧没有 CJK 字体 */
const HAS_DRAWTEXT = HAS_FFMPEG && /\sdrawtext\s/.test(spawnSync(FF, ['-hide_banner', '-filters']).stdout?.toString() ?? '');
const SLOW = 240_000;
let dir = '';
const fx = (n: string) => path.join(dir, n);
const ff = (args: string[]) => execFileSync(FF, ['-v', 'error', '-y', ...args]);
function rateOf(file: string): string {
  const j = JSON.parse(execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'json', file]).toString());
  return j.streams[0].avg_frame_rate;
}
function durOf(file: string): number {
  return Number(execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}
/** 造一段带声音的测试片 */
function clip(name: string, rate: string, seconds: number) {
  ff(['-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=${rate}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', fx(name)]);
}

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1313-'));
  clip('a24.mp4', '24', 2);
  clip('b24.mp4', '24', 2);
  clip('ep25a.mp4', '25', 2);
  clip('ep25b.mp4', '25', 2);
  clip('film30.mp4', '30', 2);
  clip('ntsc.mp4', '30000/1001', 1);
}, SLOW);
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!HAS_FFMPEG)('v13.13 · 合成按成片帧率出片(真 ffmpeg)', () => {
  async function compose(fps?: number, shots = 2, extra: { tensionLevel?: number } = {}) {
    const { composeVideo } = await import('@/services/video-composer');
    const out = fs.mkdtempSync(path.join(dir, 'out-'));
    const r = await composeVideo({
      clips: [
        { shotNumber: 1, videoUrl: serveFilePathUrl(fx('a24.mp4')), duration: 2, transition: 'cut', ...extra },
        { shotNumber: 2, videoUrl: serveFilePathUrl(fx('b24.mp4')), duration: 2, transition: 'cut', ...extra },
      ].slice(0, shots),
      aspect: '16:9', outputDir: out, transitionDuration: 0.1, ...(fps ? { fps } : {}),
    });
    return r.outputPath;
  }

  it('**只有一镜(合成器走单镜那条分支):fps: 30 → 30fps**', async () => {
    expect(rateOf(await compose(30, 1))).toBe('30/1');
  }, SLOW);

  // 单镜只有 5 分(硬切 +5),会被判成「低张力过渡段」加速 1.15× —— 变速补帧又钉回 30,上面那条就看不出画布链
  // 自己写的帧率。张力 6 再 +15 → 不变速,这里才真正走「只有画布链」那一段(v13.13 发版变异:画布链改回 24 时上面那条照样绿)。
  it('**只有一镜且不变速:fps: 30 → 30fps,时长不变**', async () => {
    const out = await compose(30, 1, { tensionLevel: 6 });
    expect(durOf(out), '窗口自证:没有被调速(加速 1.15× 会变成 ~1.74s)').toBeGreaterThan(1.9);
    expect(rateOf(out)).toBe('30/1');
  }, SLOW);

  it('**不在 24 / 25 / 30 里的 fps(60)→ 24**:合成器自己也校验,不靠调用方', async () => {
    expect(rateOf(await compose(60))).toBe('24/1');
  }, SLOW);

  it('**fps: 30 → 成片 30fps**(素材是 24fps;修前一律 24)', async () => {
    expect(rateOf(await compose(30))).toBe('30/1');
  }, SLOW);

  it('fps: 25 → 成片 25fps', async () => {
    expect(rateOf(await compose(25))).toBe('25/1');
  }, SLOW);

  it('不传 → 24fps(没有项目的合成,如 MV 工具,行为不变)', async () => {
    expect(rateOf(await compose())).toBe('24/1');
  }, SLOW);
});

/**
 * 被调速的镜要补回**成片帧率**,不是 24。v13.6 把变速镜的 `setpts` 之后钉回恒定帧率(Linux ffmpeg-static 7.0.2
 * 把 setpts 输出标成 1/0,xfade 拒收,整片掉进 concat 兜底);成片帧率可选之后,补回 24 而画布链是 30,
 * 两路帧率照样对不上。macOS 上的 ffmpeg 放行,只有 CI(Linux 7.0.2)会红 —— 所以这组必须在 CI 真跑。
 * 夹具照 v13-6-compose-speed-xfade:4 镜、源片 4s、设计 8s,第 2 镜被判成过渡段加速。
 */
describe.skipIf(!HAS_FFMPEG)('v13.13 · 有一镜被调速时,25 / 30fps 也走完整合成(真 ffmpeg)', () => {
  const tension = [3, 5, 5, 4];
  function speedClips() {
    return ['32a17a', 'add6b4', 'd2511a', '47dec0'].map((c, i) => {
      const p = fx(`spd-${i}.mp4`);
      if (!fs.existsSync(p)) {
        ff(['-f', 'lavfi', '-i', `color=c=0x${c}:s=320x180:d=4:r=24`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p]);
      }
      return { shotNumber: i + 1, videoUrl: p, duration: 8, transition: i === 0 ? '' : 'cut', emotionTemperature: 0, tensionLevel: tension[i], dialogue: '' };
    });
  }

  for (const fps of [25, 30]) {
    it(`**fps: ${fps} → ${fps}fps 的 final-*.mp4,被调速那一镜确实变了速**`, async () => {
      const { composeVideo } = await import('@/services/video-composer');
      const r = await composeVideo({ clips: speedClips(), aspect: '16:9', outputDir: fs.mkdtempSync(path.join(dir, 'spd-out-')), fps });
      // 滤镜图起不来时 composeVideo 直接 reject(concat 兜底在 editor-agent 那层),走到这里就是完整合成出的片
      expect(path.basename(r.outputPath)).toMatch(/^final-\d+\.mp4$/);
      // 窗口自证:必须真的经过了变速分支,否则这条证明不了任何事
      const changed = (r.renderedDurations || []).filter((d) => Math.abs(d.durationS - 4) > 0.2);
      expect(changed.length, '没有任何一镜被调速 —— 夹具没触发变速分支').toBeGreaterThan(0);
      expect(rateOf(r.outputPath)).toBe(`${fps}/1`);
    }, SLOW);
  }
});

describe.skipIf(!HAS_FFMPEG)('v13.13 · 字卡与整季合集跟随来源帧率(真 ffmpeg)', () => {
  it('probeFrameRate:有理数原样(29.97 不取整);读不到 → 24', async () => {
    const { probeFrameRate } = await import('@/services/video-composer');
    expect(await probeFrameRate(fx('ntsc.mp4'))).toBe('30000/1001');
    expect(await probeFrameRate(fx('film30.mp4'))).toBe('30/1');
    expect(await probeFrameRate(fx('missing.mp4'))).toBe('24');
  }, SLOW);

  it('**整季合集:25fps 的分集拼出来还是 25fps**(修前写死 24)', async () => {
    const { concatVideos } = await import('@/services/video-composer');
    const out = fs.mkdtempSync(path.join(dir, 'season-'));
    const r = await concatVideos([fx('ep25a.mp4'), fx('ep25b.mp4')], '16:9', out);
    expect(r.count).toBe(2);
    expect(rateOf(r.outputPath)).toBe('25/1');
  }, SLOW);

  it('**片尾字卡:加在 30fps 的成片上,结果还是 30fps**(修前 -r 24 + fps=24 把整条换回 24)', async (ctx) => {
    const { findCjkFont } = await import('@/lib/text-control');
    // 没有 CJK 字体时字卡会明确拒绝生成(v12.234);ffmpeg 没有 drawtext 时卡片渲染不出来 —— 两种都没法跑
    if (!findCjkFont() || !HAS_DRAWTEXT) ctx.skip();
    const { appendEndCard } = await import('@/services/video-composer');
    const out = fs.mkdtempSync(path.join(dir, 'card-'));
    const r = await appendEndCard(fx('film30.mp4'), { title: '下一集见', w: 320, h: 180, bg: 'solid', outputDir: out });
    expect(r.appended).toBe(true);
    expect(rateOf(r.outputPath)).toBe('30/1');
  }, SLOW);
});

// ── 源码登记表(按 TypeScript AST) ──────────────────────────────────────
function parse(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function sourceFiles(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) for (const rel of fs.readdirSync(d, { recursive: true }) as string[]) {
    if (/\.tsx?$/.test(rel)) out.push(path.join(d, rel).split(path.sep).join('/'));
  }
  return out;
}
/** 文件里所有 composeVideo 调用(含 `const { composeVideo: 别名 } = await import(...)` 与 `import { composeVideo as 别名 }`) */
function composeCalls(file: string) {
  const sf = parse(file);
  const names = new Set(['composeVideo']);
  const decls = new Map<string, string>();   // 变量名 → 初始化表达式原文
  const pre = (n: ts.Node) => {
    if (ts.isBindingElement(n) && n.propertyName?.getText(sf) === 'composeVideo') names.add(n.name.getText(sf));
    if (ts.isImportSpecifier(n) && n.propertyName?.text === 'composeVideo') names.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.set(n.name.text, n.initializer.getText(sf));
    ts.forEachChild(n, pre);
  };
  pre(sf);
  const calls: Array<{ line: number; fps: string | null }> = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
      const arg = n.arguments[0];
      const prop = arg && ts.isObjectLiteralExpression(arg)
        ? arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'fps')
        : undefined;
      let fps = prop ? prop.initializer.getText(sf) : null;
      if (fps && decls.has(fps)) fps = `${fps} = ${decls.get(fps)}`;   // fps: filmFps → 追到它的来源
      calls.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, fps });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return calls;
}

/** 不属于项目、没有项目格式可读的合成 —— 每条写清理由 */
const NOT_PROJECT: Record<string, string> = {
  'app/api/mv/compose/route.ts': 'MV 卡点工具:素材是用户临时上传的片段,不属于任何项目,按默认 24fps 出片',
};

describe('v13.13 · 合成调用方登记表', () => {
  const all = sourceFiles(['app', 'lib', 'services'])
    .filter((f) => f !== 'services/video-composer.ts')
    .map((f) => ({ file: f, calls: composeCalls(f) }))
    .filter((x) => x.calls.length > 0);

  it('扫描器自证:主合成、简化合成(别名 composeVideoRetry)、重新合成、MV 都扫到了', () => {
    const by = Object.fromEntries(all.map((x) => [x.file, x.calls.length]));
    expect(by['services/agents/editor-agent.ts'], '主合成 + 简化合成').toBe(2);
    expect(by['app/api/projects/[id]/recompose/route.ts']).toBe(1);
    expect(by['app/api/mv/compose/route.ts']).toBe(1);
  });

  it('**每个项目合成都传 fps,且来自 projectFilmFps()**', () => {
    const bad: string[] = [];
    for (const { file, calls } of all) {
      if (file in NOT_PROJECT) continue;
      for (const c of calls) {
        const arg = /projectFilmFps\(([^)]*)\)/.exec(c.fps || '')?.[1].trim();
        // 参数得是项目 id —— projectFilmFps(undefined) 也能「来自 projectFilmFps」,但永远是 24
        if (!arg || /^(undefined|null|''|"")$/.test(arg)) bad.push(`${file}:${c.line} fps=${c.fps}`);
      }
    }
    expect(bad, '新的合成调用:传 fps: await projectFilmFps(项目 id),或在 NOT_PROJECT 里写明理由').toEqual([]);
  });

  it('登记为「不属于项目」的文件确实存在', () => {
    for (const f of Object.keys(NOT_PROJECT)) expect(fs.existsSync(f), f).toBe(true);
  });

  it('**合成器里不再写死帧率字面量**(fps=数字 / -r 数字);帧率都来自参数或探测', () => {
    const sf = parse('services/video-composer.ts');
    const literal: string[] = [];
    let interpolated = 0;
    const walk = (n: ts.Node) => {
      const texts = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? [n.text]
        : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)] : [];
      for (const t of texts) {
        for (const m of t.matchAll(/\bfps=\d+|-r \d+/g)) literal.push(`${m[0]} @${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
        interpolated += (t.match(/fps=$|-r $/g) || []).length;   // 片段以 `fps=` 结尾 = 后面紧跟 ${...}
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(literal).toEqual([]);
    expect(interpolated, '自证:合成 ×2、整季、字卡 ×3、Ken Burns 的帧率插值都扫到了').toBeGreaterThanOrEqual(6);
  });
});

/** 文件里所有 `xxx.runEditor(...)` 调用;第三个参数是否带 projectId */
function runEditorCalls(file: string) {
  const sf = parse(file);
  const calls: Array<{ line: number; receiver: string; projectId: boolean }> = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'runEditor') {
      const opts = n.arguments[2];
      const projectId = !!opts && ts.isObjectLiteralExpression(opts) && opts.properties.some((p) =>
        (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p)) && p.name.getText(sf) === 'projectId');
      calls.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, receiver: n.expression.expression.getText(sf), projectId });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return calls;
}

/** 不传 projectId 也对的剪辑调用 —— 编排器上已经 setProjectId 过 */
const RUN_EDITOR_HAS_PROJECT: Record<string, string> = {
  'lib/create-pipeline.ts': '整片生成主流程:开头 orchestrator.setProjectId(projectId),编排器即 ctx,ctx.projectId 就是它',
  'services/hybrid-orchestrator.ts': '编排器自己的 run():this.projectId 由调用方 setProjectId 设好',
};

describe('v13.13 · 剪辑调用都拿得到项目 id(否则按 24 出片)', () => {
  const all = sourceFiles(['app', 'lib', 'services'])
    .map((f) => ({ file: f, calls: runEditorCalls(f) }))
    .filter((x) => x.calls.length > 0);

  it('扫描器自证:整片生成、单镜重生路由的两处(补渲后自动重合成、重做剪辑)都扫到了', () => {
    const by = Object.fromEntries(all.map((x) => [x.file, x.calls.length]));
    expect(by['lib/create-pipeline.ts']).toBe(1);
    expect(by['app/api/regenerate-shot/route.ts']).toBe(2);
  });

  it('**没有 setProjectId 的调用方都显式传 { projectId }**(单镜重生路由修前两处都没传,补渲 / 重做剪辑按 24 出片)', () => {
    const bad: string[] = [];
    for (const { file, calls } of all) {
      if (file in RUN_EDITOR_HAS_PROJECT) continue;
      for (const c of calls) if (!c.projectId) bad.push(`${file}:${c.line} ${c.receiver}.runEditor(…) 没传 { projectId }`);
    }
    expect(bad, '新的剪辑调用:传第三个参数 { projectId },或在 RUN_EDITOR_HAS_PROJECT 里写明理由').toEqual([]);
  });

  it('登记为「已 setProjectId」的文件里确实有 setProjectId 调用', () => {
    expect(fs.readFileSync('lib/create-pipeline.ts', 'utf-8')).toMatch(/orchestrator\.setProjectId\(\s*projectId\s*\)/);
  });

  it('**编排器没 setProjectId、只经 runEditor 参数传项目 id 时,按项目成片帧率**(单镜重生路由就是这么调的;修前主表写死 24)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = pid(30); await saveFps(id, 30);
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const orch = new HybridOrchestrator();   // 不调 setProjectId —— 与 app/api/regenerate-shot 一致
    let sheet: any = null;
    const STOP = new Error('stop-after-continuity');
    // 连续性主表一发出就停:后面是高光检测、配乐与合成,与这条无关
    (orch as any).onProgress = (type: string, data: any) => { if (type === 'continuitySheet') { sheet = data; throw STOP; } };
    const script: any = { title: 't', synopsis: '', shots: [{ shotNumber: 1, sceneDescription: '雨夜', duration: 2 }] };
    await expect(orch.runEditor([], script, { projectId: id })).rejects.toBe(STOP);
    expect(sheet?.rows?.length, '窗口自证:主表确实发出来了').toBeGreaterThan(0);
    expect(sheet.rows.map((r: any) => r.fps)).toEqual([30]);
    expect((orch as any).projectId, '只用来取帧率,不改编排器自己的 projectId(那会连带评分回写等行为)').toBe('');
  }, 30_000);
});

describe('v13.13 · 片尾字卡的编码帧率取自成片探测值(CI 也跑)', () => {
  // CI runner 上 npm 的 ffmpeg-static(Linux 7.0.2)没有 drawtext,字卡真跑那条在 CI 跳过(按 -filters 判断);
  // 这里截获合成器发出的 ffmpeg 命令,探测仍用真 ffprobe 读 30fps 的真片 —— 「-r 24」之类的回退会变红。
  it.skipIf(!HAS_FFMPEG)('**加在 30fps 成片上:渲染卡片用 -r 30/1,拼接时两路都过 fps=30/1**', async () => {
    const cmds: string[] = [];
    vi.resetModules();
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process');
      const exec = (cmd: string, opts: any, cb?: any) => { cmds.push(cmd); (typeof opts === 'function' ? opts : cb)(null, '', ''); };
      return { ...actual, default: { ...actual, exec }, exec };
    });
    vi.stubEnv('CJK_FONT_FILE', path.resolve('tests/v13-13-film-fps.test.tsx'));   // 命令被截获,不会真去读字体
    try {
      const { appendEndCard } = await import('@/services/video-composer');
      await appendEndCard(fx('film30.mp4'), { title: '下一集见', w: 320, h: 180, bg: 'solid', outputDir: fs.mkdtempSync(path.join(dir, 'cardcmd-')) }).catch(() => {});
    } finally {
      vi.doUnmock('child_process');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
    const render = cmds.find((c) => c.includes('anullsrc'));
    const concat = cmds.find((c) => c.includes('concat=n=2'));
    expect(render, '窗口自证:截到了渲染卡片那条命令').toBeTruthy();
    expect(render).toMatch(/-r 30\/1\b/);
    expect(concat, '窗口自证:截到了拼接命令').toBeTruthy();
    expect(concat!.match(/fps=30\/1/g)?.length).toBe(2);
    expect(`${render} ${concat}`).not.toMatch(/-r 24\b|fps=24\b/);
  }, SLOW);
});

describe('v13.13 · editor-agent 读得到项目 id', () => {
  it('**编排器 setProjectId 之后,当成 EditorAgentCtx 读到的 projectId 就是它**(字段名对不上 TS 看不出,只会静默按 24 出片)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const orch = new HybridOrchestrator();
    orch.setProjectId('p-film-fps');
    const ctx = orch as unknown as import('@/services/agents/editor-agent').EditorAgentCtx;   // 与 runEditor 的传法一致
    expect(ctx.projectId).toBe('p-film-fps');
  });
});

describe('v13.13 · probeFrameRate 取哪个帧率(pickStreamFrameRate)', () => {
  it('avg_frame_rate 优先,有理数原样(29.97 不取整)', async () => {
    const { pickStreamFrameRate } = await import('@/services/video-composer');
    expect(pickStreamFrameRate({ avg_frame_rate: '30000/1001', r_frame_rate: '30/1' })).toBe('30000/1001');
    expect(pickStreamFrameRate({ avg_frame_rate: '25/1' })).toBe('25/1');
  });

  it('**avg 是 0/0(部分 VFR 片拿不到平均帧率)→ 退到 r_frame_rate**,不能把 0/0 交给字卡的 -r', async () => {
    const { pickStreamFrameRate } = await import('@/services/video-composer');
    expect(pickStreamFrameRate({ avg_frame_rate: '0/0', r_frame_rate: '30/1' })).toBe('30/1');
    expect(pickStreamFrameRate({ avg_frame_rate: '30/0', r_frame_rate: '24/1' })).toBe('24/1');
  });

  it('两个都拿不到 / 没有视频流 → null(probeFrameRate 再回落 24)', async () => {
    const { pickStreamFrameRate } = await import('@/services/video-composer');
    expect(pickStreamFrameRate({ avg_frame_rate: '0/0', r_frame_rate: '0/0' })).toBeNull();
    expect(pickStreamFrameRate({ avg_frame_rate: 'N/A' })).toBeNull();
    expect(pickStreamFrameRate(undefined)).toBeNull();
  });
});

describe('v13.13 · 剪映草稿的序列帧率 = 项目成片帧率', () => {
  // 修前:服务端组装的 GET 不传 fps,草稿恒写 30fps(lib/jianying-export 的缺省),POST 不给 fps 时也是 30 ——
  // 成片却是项目选的 24 / 25 / 30。EDL / AAF 一直读的是项目格式,剪映这条漏了。
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const withShot = async (id: string) => {
    await createAsset({ projectId: id, type: 'video', name: 'Shot 1', shotNumber: 1, data: { duration: 2 }, persistentUrl: '/tmp/v1313-jy-shot-1.mp4' });
    return id;
  };

  it('**GET(服务端组装)**:存了 25 → 草稿 fps 25;没存过格式 → 24(与成片一致,修前恒 30)', async () => {
    const a = await withShot(pid(31)); await saveFps(a, 25);
    const b = await withShot(pid(32));
    const ra = await jianyingGET(new NextRequest(`http://localhost/api/projects/${a}/export-jianying?file=content`), params(a));
    const rb = await jianyingGET(new NextRequest(`http://localhost/api/projects/${b}/export-jianying?file=content`), params(b));
    expect(ra.status, await ra.clone().text()).toBe(200);
    const da = await ra.json(); const db_ = await rb.json();
    expect((da.materials?.videos ?? []).length, '窗口自证:草稿里确实排上了那一镜').toBe(1);
    expect(da.fps).toBe(25);
    expect(db_.fps).toBe(24);
  });

  it('**POST 没给 fps** → 项目成片帧率;显式给了照用', async () => {
    // 存 25 而不是 30:30 恰好是修前的缺省值,存 30 的话改没改都绿
    const id = pid(33); await saveFps(id, 25);
    const post = (body: object) => jianyingPOST(new NextRequest(`http://localhost/api/projects/${id}/export-jianying`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), params(id));
    const clips = [{ path: '/tmp/v1313-jy-a.mp4', durationSec: 2 }];
    const r1 = await post({ clips });
    expect(r1.status, await r1.clone().text()).toBe(200);
    expect((await r1.json()).draftContent.fps).toBe(25);
    expect((await (await post({ clips, fps: 30 })).json()).draftContent.fps).toBe(30);
  });
});

describe('v13.13 · 对外文档:成片帧率', () => {
  for (const file of ['README.md', 'README.zh-CN.md', 'docs/modelscope-intro.md', 'docs/SCREENSHOTS-v12.425.md']) {
    it(file, () => {
      const src = fs.readFileSync(file, 'utf-8');
      const i = src.indexOf('13-storyboard-specs.jpg');
      expect(i, '分镜规格那张截图的说明还在').toBeGreaterThan(0);
      const caption = src.slice(i, i + 1200);
      expect(caption).toContain('成片帧率按格式条设置(24 / 25 / 30fps)');
      expect(caption).not.toMatch(/导出帧率只决定|成片固定 24fps|升格/);
    });
  }
});
