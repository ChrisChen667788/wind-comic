/**
 * v12.3.3 — 定时发布(阶段二十二)。走真 SQLite(scheduled_publishes 无 FK)。
 * 验:排定/列表、claimDue 原子认领(到点+pending 只抢一次,未来不抢)、取消属主守卫、
 *     runDuePublishes 经 mock 适配器 dispatch → 落记录 + 标终态。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  schedulePublish, listScheduledPublishes, claimDuePublishes,
  cancelScheduledPublish, markScheduled,
} from '@/lib/repos/scheduled-publish-repo';
import { runDuePublishes } from '@/lib/publish-scheduler';
import { getDbDriver } from '@/lib/db-driver';
import type { PublishPackage } from '@/lib/publish-package';

const P = 'sched-test-proj';
const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
const nowIso = new Date().toISOString();

async function clean() {
  await getDbDriver().run('DELETE FROM scheduled_publishes WHERE project_id = ?', [P]);
  await getDbDriver().run('DELETE FROM publish_records WHERE project_id = ?', [P]);
}

function fakeBundle(): { spec: any; bundle: PublishPackage } {
  return {
    spec: {} as any,
    bundle: {
      platform: 'douyin', label: '抖音', spec: { aspect: '9:16', titleMaxLen: 55, tagCount: 5, descMaxLen: 200 },
      title: '定时标题', titleAlternatives: [], tags: [], hashtags: '', description: '', tips: '',
      video: { url: 'https://cdn/v.mp4', recommendedAspect: '9:16', platformReady: true }, cover: { url: null },
      copyText: '', ready: true, warnings: [],
    },
  };
}

describe('v12.3.3 · scheduled-publish-repo', () => {
  beforeEach(clean);

  it('schedulePublish 落 pending + listScheduledPublishes 回读', async () => {
    const s = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: future, createdBy: 'u1' });
    expect(s.id).toMatch(/^sch_/);
    expect(s.status).toBe('pending');
    const list = await listScheduledPublishes(P);
    expect(list.some((x) => x.id === s.id)).toBe(true);
  });

  it('claimDuePublishes:只抢到点+pending,且原子(第二次抢不到)', async () => {
    const due = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: past, createdBy: 'u1' });
    await schedulePublish({ projectId: P, platform: 'bilibili', scheduledAt: future, createdBy: 'u1' }); // 未来不抢

    const first = await claimDuePublishes(nowIso);
    const mine = first.filter((x) => x.projectId === P);
    expect(mine.length).toBe(1);
    expect(mine[0].id).toBe(due.id);
    expect(mine[0].status).toBe('running');
    expect(mine[0].attempts).toBe(1);

    // 已认领 → 第二次同窗口抢不到(防并发重复发)
    const second = (await claimDuePublishes(nowIso)).filter((x) => x.projectId === P);
    expect(second.length).toBe(0);
  });

  it('cancelScheduledPublish 属主守卫', async () => {
    const s = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: future, createdBy: 'owner' });
    expect(await cancelScheduledPublish(s.id, 'intruder')).toBe(false); // 非属主不取消
    expect(await cancelScheduledPublish(s.id, 'owner')).toBe(true);
    const list = await listScheduledPublishes(P);
    expect(list.find((x) => x.id === s.id)?.status).toBe('canceled');
  });

  it('markScheduled 写终态 + 关联 publish_record_id', async () => {
    const s = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: past });
    await markScheduled(s.id, { status: 'done', publishRecordId: 'pub_xyz' });
    const list = await listScheduledPublishes(P);
    const row = list.find((x) => x.id === s.id)!;
    expect(row.status).toBe('done');
    expect(row.publishRecordId).toBe('pub_xyz');
  });
});

describe('v12.3.3 · runDuePublishes (scheduler tick)', () => {
  beforeEach(clean);

  it('到点 → 经 mock 适配器 dispatch:youtube published / 抖音 manual(packaged),标 done', async () => {
    const yt = await schedulePublish({ projectId: P, platform: 'youtube_shorts', scheduledAt: past, createdBy: 'u1' });
    const dy = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: past, createdBy: 'u1' });

    const recorded: any[] = [];
    const res = await runDuePublishes(nowIso, {
      assemble: () => fakeBundle() as any,
      getAdapter: (platform: string) => ({
        platform, label: platform, mode: platform === 'youtube_shorts' ? 'api' : 'manual',
        isConfigured: () => platform === 'youtube_shorts',
        upload: async () => platform === 'youtube_shorts'
          ? { status: 'published' as const, externalUrl: 'https://youtu.be/abc', externalId: 'abc', message: 'ok' }
          : { status: 'manual' as const, externalUrl: null, externalId: null, message: '手动', instructions: ['上传'] },
        status: async () => null,
      }),
      recordPublish: (async (i: any) => { const r = { id: 'pub_' + recorded.length, ...i }; recorded.push(r); return r; }) as any,
    });

    // 只处理本项目的两条(其它项目残留的 due 行不影响断言:看 results 里我们的)
    const ours = res.results.filter((r) => r.id === yt.id || r.id === dy.id);
    expect(ours.length).toBe(2);
    expect(ours.find((r) => r.id === yt.id)?.status).toBe('published');
    expect(ours.find((r) => r.id === dy.id)?.status).toBe('manual');

    // scheduled 行都标 done
    const list = await listScheduledPublishes(P);
    expect(list.find((x) => x.id === yt.id)?.status).toBe('done');
    expect(list.find((x) => x.id === dy.id)?.status).toBe('done');
    // 落了 publish 记录(youtube published / 抖音 packaged)
    expect(recorded.find((r) => r.platform === 'youtube_shorts')?.status).toBe('published');
    expect(recorded.find((r) => r.platform === 'douyin')?.status).toBe('packaged');
  });

  it('适配器抛错 → 标 failed,不挂整批', async () => {
    const job = await schedulePublish({ projectId: P, platform: 'douyin', scheduledAt: past });
    const res = await runDuePublishes(nowIso, {
      assemble: () => fakeBundle() as any,
      getAdapter: () => ({
        platform: 'douyin', label: '抖音', mode: 'manual', isConfigured: () => false,
        upload: async () => { throw new Error('boom'); }, status: async () => null,
      }),
      recordPublish: (async (i: any) => ({ id: 'pub_x', ...i })) as any,
    });
    const mine = res.results.find((r) => r.id === job.id)!;
    expect(mine.status).toBe('failed');
    const list = await listScheduledPublishes(P);
    expect(list.find((x) => x.id === job.id)?.status).toBe('failed');
  });
});
