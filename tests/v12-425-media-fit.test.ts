/**
 * v12.425 素材显示不全 —— 用户实测:「所有有图片的都显示不全,必须点击全屏后才能显示完整」
 *
 * 真因:框比例写死 + object-cover。实测 99 张在库素材,同一类型内部比例就是混的
 * (character 有 0.78 也有 1.33;storyboard 1.75 和 1.33 五五开;sketch 全是 0.56),
 * 所以任何写死的框配 cover 都必然裁。修法是 contain,框比例只用来压留边。
 *
 * 这些断言锁的是「用户能不能看到完整素材」,不是锁某个 class 字符串怎么写。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  frameClassFor, projectFrameClass, assetMediaClass,
  ASSET_MEDIA_FIT, coverCropRatio,
} from '../lib/media-frame';
import { normalizeReviewScore } from '../lib/review-score';

/** 把 tailwind 的 aspect-* class 还原成数值,好拿真实素材尺寸去验。 */
function aspectOf(cls: string): number {
  if (/\baspect-video\b/.test(cls)) return 16 / 9;
  if (/\baspect-square\b/.test(cls)) return 1;
  const m = cls.match(/aspect-\[(\d+)\/(\d+)\]/);
  if (!m) throw new Error(`认不出框比例:${cls}`);
  return Number(m[1]) / Number(m[2]);
}

/** 实测采到的原生尺寸(2026-09-06,99 张)。测试要跑在真数据上。 */
const OBSERVED: Record<string, Array<[number, number]>> = {
  character:  [[896, 1152], [1152, 864]],
  scene:      [[1344, 768], [1152, 864]],
  storyboard: [[1344, 768], [1152, 864]],
  sketch:     [[816, 1456]],
};

describe('v12.425 素材框:填充方式', () => {
  it('素材媒体一律 contain —— cover 会吃掉画面', () => {
    expect(ASSET_MEDIA_FIT).toBe('object-contain');
  });

  it('每类素材拼出来的 class 都带 contain,且没有 cover 残留', () => {
    for (const kind of ['character', 'scene', 'storyboard', 'sketch', 'video', 'cover', 'reference'] as const) {
      const cls = assetMediaClass(kind, '16:9');
      expect(cls, kind).toContain('object-contain');
      expect(cls, kind).not.toContain('object-cover');
    }
  });

  it('修前那套「一个项目画幅框走天下 + cover」,每类素材都必然裁掉 >20%', () => {
    // 这才是 bug 的形状:框只跟项目画幅,素材比例却五花八门。
    const projectBox = aspectOf(projectFrameClass('16:9'));
    for (const [kind, sizes] of Object.entries(OBSERVED)) {
      const worst = Math.max(...sizes.map(([w, h]) => coverCropRatio(projectBox, w / h)));
      expect(worst, kind + ' 在项目画幅框里用 cover 的最大损失').toBeGreaterThan(0.2);
    }
  });
});

describe('v12.425 素材框:框比例贴合主导原生比例', () => {
  it('角色框是竖的,不是横的 —— 修前是 355x200 横框裁掉 56%', () => {
    expect(aspectOf(frameClassFor('character'))).toBeLessThan(1);
  });

  it('角色主导尺寸 896x1152 在角色框里留边 < 3%', () => {
    const box = aspectOf(frameClassFor('character'));
    expect(coverCropRatio(box, 896 / 1152)).toBeLessThan(0.03);
  });

  it('草图框是竖的 —— 816x1456 修前被塞进横向分镜框', () => {
    const box = aspectOf(frameClassFor('sketch'));
    expect(box).toBeLessThan(1);
    expect(coverCropRatio(box, 816 / 1456)).toBeLessThan(0.05);
  });

  it('分镜/场景/视频/封面跟项目画幅走,竖屏项目给竖框', () => {
    for (const kind of ['scene', 'storyboard', 'video', 'cover'] as const) {
      expect(aspectOf(frameClassFor(kind, '9:16')), kind).toBeLessThan(1);
      expect(aspectOf(frameClassFor(kind, '16:9')), kind).toBeGreaterThan(1);
    }
  });

  it('旧项目没有 aspect 列时按 16:9,零回归', () => {
    expect(projectFrameClass(undefined)).toBe(projectFrameClass('16:9'));
    expect(projectFrameClass(null)).toBe(projectFrameClass('16:9'));
  });
});

describe('v12.425 裁切算术', () => {
  it('比例一致时不裁', () => {
    expect(coverCropRatio(16 / 9, 16 / 9)).toBe(0);
  });
  it('复现修前那两处实测损失', () => {
    // 角色:896x1152 塞进 355x200
    expect(Math.round(coverCropRatio(355 / 200, 896 / 1152) * 100)).toBe(56);
    // 场景:1344x768 塞进 542x180
    expect(Math.round(coverCropRatio(542 / 180, 1344 / 768) * 100)).toBe(42);
  });
  it('尺寸非法时退回 0,不抛', () => {
    expect(coverCropRatio(0, 1.5)).toBe(0);
    expect(coverCropRatio(1.5, Number.NaN)).toBe(0);
  });
});

describe('v12.425 调用方确实接上了(不是造好没接线)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

  it('项目页角色/场景卡不再写死 h-[200px]/h-[180px] 的横框', () => {
    const src = read('app/projects/[id]/page.tsx');
    expect(src).not.toContain('h-[200px] object-cover');
    expect(src).not.toContain('h-[180px] object-cover');
    expect(src).toContain('assetMediaClass');
  });

  it('缩略图默认填充与全屏一致 —— 用户不该为了看全图去点全屏', () => {
    const src = read('components/ui/image-lightbox.tsx');
    const inline = src.match(/imgClassName \|\| ([^\n]+)/)?.[1] ?? '';
    expect(inline).toContain('ASSET_MEDIA_FIT');
    expect(inline).not.toContain('object-cover');
  });
});

describe('v12.425 防回潮:写死像素高 + cover 是无条件的裁切 bug', () => {
  // 这条规则不列白名单 —— 它锁的是一个恒真命题:
  // 框高写死、宽度自适应,框比例就随视口漂移,再配 cover,任何比例的素材都会被裁。
  // 三处真 bug(项目页 h-[200px]/h-[180px]、角色库 h-[140px])全是这个形状。
  // 两类豁免有实质理由,不是为了让门禁变绿:
  //   · app/page.tsx 是营销落地页,用的是选定尺寸的固定配图,裁切是美术决定
  //   · src 写字面量路径 = 已知的固定装饰素材,不是用户生成物
  const EXEMPT_FILES = new Set(['app/page.tsx']);

  it('没有新的「写死像素高 + object-cover」承载动态素材', () => {
    const files = execSync('git ls-files "*.tsx"', { cwd: process.cwd(), encoding: 'utf-8' })
      .split('\n').filter(Boolean);
    const pattern = /h-\[\d+px\][^"`}]*object-cover|object-cover[^"`}]*h-\[\d+px\]/;
    const offenders: string[] = [];
    for (const f of files) {
      if (EXEMPT_FILES.has(f)) continue;
      const lines = fs.readFileSync(path.join(process.cwd(), f), 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (!pattern.test(line)) return;
        // 往上找 6 行拼出这个元素,判断 src 是不是写死的字面量
        const el = lines.slice(Math.max(0, i - 6), i + 1).join(' ');
        if (/src\s*=\s*"[^"]*"/.test(el)) return;
        offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders, `写死高度的框配 cover 会裁掉用户素材,改用 assetMediaClass():\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});

describe('v12.425 评分不说谎', () => {
  it('没分返回 null,不返回 0 —— 「未评分」不是「0 分」', () => {
    for (const raw of [undefined, null, '', NaN, 'abc', {}, [], true, false]) {
      expect(normalizeReviewScore(raw), String(raw)).toBeNull();
    }
  });

  it('有分就原样返回,字符串数字也认', () => {
    expect(normalizeReviewScore(90)).toBe(90);
    expect(normalizeReviewScore('90')).toBe(90);
    expect(normalizeReviewScore(0)).toBe(0);      // 真的评了 0 分要显示 0
    expect(normalizeReviewScore(88.5)).toBe(88.5);
  });

  it('项目页不再直接渲染 overallScore —— 那是 undefined/100 的来源', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/projects/[id]/page.tsx'), 'utf-8');
    expect(src).toContain('normalizeReviewScore');
    // 去掉注释再查:注释里提到 overallScore 是在解释这个坑,不该让断言失效
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(code).not.toMatch(/\{review\.overallScore\}/);
    expect(code).not.toMatch(/\$\{review\.overallScore\}/);
  });
});

describe('v12.425 进场动画不能制造「永久死区」', () => {
  // useInView 的 margin 收缩上边,就会出现「元素明明在屏幕上,却不算进入视野」。
  // 页面不滚时(内容没超过视口)这个死区是永久的:
  //   · NumberTicker 永远停在 0 —— 分镜页一致性仪表真的显示过 AVG 0 / PASS 0,
  //     而同屏的逐镜分是 89~92;
  //   · TextReveal 的词是 opacity:0 —— 死区里的正文直接隐形。
  // 收缩下边没有这个问题(元素从下方进场时晚一点触发,是原本的意图)。
  it('全仓没有收缩上边的 useInView margin', () => {
    const files = execSync('git ls-files "*.tsx" "*.ts"', { cwd: process.cwd(), encoding: 'utf-8' })
      .split('\n').filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      if (!src.includes('useInView')) continue;
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
        .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      for (const m of code.matchAll(/margin:\s*'([^']+)'/g)) {
        const parts = m[1].trim().split(/\s+/);
        // CSS 简写:1 个=四边,2 个=上下/左右,3 个=上/左右/下,4 个=上/右/下/左
        const top = parts.length === 1 ? parts[0] : parts[0];
        if (top.startsWith('-') && top !== '-0' && parseFloat(top) < 0) {
          offenders.push(`${f}  margin: '${m[1]}' —— 上边被收缩,会造成永久死区`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
