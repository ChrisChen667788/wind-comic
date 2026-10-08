/**
 * v12.468 — 创建管线:项目行记的画幅 = 实际出片的画幅。
 *
 * 修前三种对不上(见 v12-468-aspect-235 的说明):
 *   - 选 2.35:1:项目行 2.35:1,编排器拒掉后按 16:9(短剧题材再翻成 9:16)出;
 *   - 显式选 16:9 + 短剧题材:项目行 16:9,出 9:16;
 *   - 没带画幅(API / 系列以外的调用方)+ 短剧题材:项目行 16:9,出 9:16(翻转从不回写)。
 * 另外,续跑没带画幅时编排器回到默认 16:9,而续跑会跳过 Style Bible(翻转就在那一步),
 * 续跑段按 16:9 出,和首跑已出的 9:16 镜头接不上。
 *
 * 这里用**真的编排器**,只把出图换成记账、把编剧之后的阶段截断:题材翻转、setAspect、
 * 项目行读写都走真代码。「实际出片画幅」以 Style Bible 帧的出图参数为准 —— 之后的
 * 角色 / 场景 / 分镜 / 视频都读同一个 this.aspect。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';

const h = vi.hoisted(() => ({
  genre: '都市',
  renders: [] as string[],
  instances: [] as Array<Record<string, unknown>>,
  cp: null as null | { plan: unknown; styleBibleUrl: string },
}));

vi.mock('@/services/hybrid-orchestrator', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/hybrid-orchestrator')>();
  class HybridOrchestrator extends real.HybridOrchestrator {
    constructor() {
      super();
      const self = this as unknown as Record<string, unknown>;
      h.instances.push(self);
      self.generateImage = async (_p: string, op?: { aspectRatio?: string }) => { h.renders.push(op?.aspectRatio ?? ''); return 'https://img.test/bible.png'; };
    }
    // 导演:不调 LLM,直接给题材(真 runDirector 也是在这里定 genre / originalIdea / styleKeywords)
    async runDirector(idea: string) {
      const self = this as unknown as Record<string, unknown>;
      self.genre = h.genre;
      self.originalIdea = idea;
      self.styleKeywords = 'cinematic anime, rim light';
      return { title: 't', genre: h.genre, characters: [], scenes: [], storyStructure: { totalShots: 3 } } as never;
    }
    // Style Bible 用真的(题材翻转就在里面);编剧起截断,管线按失败收尾
    async runWriter(): Promise<never> { throw new Error('STOP_AFTER_STYLE_BIBLE'); }
  }
  return { ...real, HybridOrchestrator };
});

vi.mock('@/lib/pipeline-checkpoints', async (orig) => {
  const m = await orig<typeof import('@/lib/pipeline-checkpoints')>();
  return { ...m, loadCheckpoints: async () => ({ ...m.emptyCheckpoints(), ...(h.cp ?? {}) }) };
});

import { runCreatePipeline } from '@/lib/create-pipeline';
import { getProject, insertProjectFull } from '@/lib/repos/project-repo';
import { db, now } from '@/lib/db';

const DRAMA_IDEA = '女主重生回到婚礼前一天,当众揭穿未婚夫的阴谋';
const SCIFI_IDEA = '星际飞船在深空发现远古遗迹,船员因恐惧产生分歧';

async function run(opts: { genre: string; idea: string; aspect?: string; projectId?: string; resume?: boolean }) {
  h.genre = opts.genre;
  h.renders.length = 0;
  h.instances.length = 0;
  const projectId = opts.projectId ?? `as465-${nanoid(8)}`;
  const statuses: string[] = [];
  await runCreatePipeline(
    { idea: opts.idea, projectId, ...(opts.aspect !== undefined ? { aspect: opts.aspect } : {}) } as never,
    (type, data) => { if (type === 'status') statuses.push(String((data as { message?: string })?.message ?? '')); },
    opts.resume ? { resume: true } : undefined,
  );
  const row = await getProject(projectId);
  return { projectId, recorded: row?.aspect, renders: [...h.renders], orchestrator: h.instances[0], statuses };
}

beforeEach(() => { h.cp = null; });

// 真跑管线要加载编排器全家,机器负载高时单条可超过默认 10s
describe('v12.468 · 项目行记的画幅 = 实际出片画幅', { timeout: 60_000 }, () => {
  it('选 2.35:1(旧客户端 / API)+ 短剧:按 16:9 出,项目行也记 16:9', async () => {
    const r = await run({ genre: '短剧', idea: DRAMA_IDEA, aspect: '2.35:1' });
    expect(r.renders).toEqual(['16:9']);
    expect(r.recorded).toBe('16:9');
  });

  it('显式选 16:9 + 短剧:不被题材翻成 9:16', async () => {
    const r = await run({ genre: '短剧', idea: DRAMA_IDEA, aspect: '16:9' });
    expect(r.renders).toEqual(['16:9']);
    expect(r.recorded).toBe('16:9');
  });

  it('没带画幅 + 短剧:按题材翻成 9:16,并回写项目行(还告诉用户)', async () => {
    const r = await run({ genre: '短剧', idea: DRAMA_IDEA });
    expect(r.renders).toEqual(['9:16']);
    expect(r.recorded).toBe('9:16');
    expect(r.statuses.some((s) => s.includes('项目画幅按实际出片记为 9:16'))).toBe(true);
  });

  it('反面:没带画幅 + 非短剧 → 16:9,不回写也不提示', async () => {
    const r = await run({ genre: '科幻', idea: SCIFI_IDEA });
    expect(r.renders).toEqual(['16:9']);
    expect(r.recorded).toBe('16:9');
    expect(r.statuses.some((s) => s.includes('项目画幅按实际出片记为'))).toBe(false);
  });

  it('反面:选 9:16 / 1:1 → 原样', async () => {
    for (const aspect of ['9:16', '1:1']) {
      const r = await run({ genre: '科幻', idea: SCIFI_IDEA, aspect });
      expect(r.renders, aspect).toEqual([aspect]);
      expect(r.recorded, aspect).toBe(aspect);
    }
  });

  it('续跑没带画幅、跳过 Style Bible:沿用项目行的 9:16,不退回 16:9', async () => {
    // 首跑:没带画幅的短剧,翻成 9:16 并回写
    const first = await run({ genre: '短剧', idea: DRAMA_IDEA });
    expect(first.recorded).toBe('9:16');
    // 续跑:导演计划和 Style Bible 都从断点装载 → runStyleBibleArtist 不会再跑
    h.cp = { plan: { title: 't', genre: '短剧', characters: [], scenes: [] }, styleBibleUrl: 'https://img.test/bible.png' };
    const again = await run({ genre: '短剧', idea: DRAMA_IDEA, projectId: first.projectId, resume: true });
    expect(again.renders).toEqual([]); // 确实没再出 Style Bible
    expect(again.orchestrator.aspect).toBe('9:16');
    expect(again.recorded).toBe('9:16');
  });

  it('旧库里记成 2.35:1 的项目重跑(没带画幅):项目行改成实际出的画幅', async () => {
    const projectId = `as465-${nanoid(8)}`;
    const userId = `u-${nanoid(8)}`;
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(userId, `${userId}@test.local`, 'x', userId, now());
    await insertProjectFull({ id: projectId, userId, title: '旧项目', description: '', coverUrls: [], status: 'active', aspect: '2.35:1' });
    const r = await run({ genre: '科幻', idea: SCIFI_IDEA, projectId });
    expect(r.renders).toEqual(['16:9']);
    expect(r.recorded).toBe('16:9');
  });
});
