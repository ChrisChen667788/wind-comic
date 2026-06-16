/**
 * lib/publish-scheduler (v12.3.3) — 定时发布 worker tick(阶段二十二)。
 *
 * runDuePublishes(now):原子认领到点条目 → 逐条经适配器上传 → 落 publish_records + 标记终态。
 * 由 /api/cron/run-scheduled-publishes 周期触发(或外部 cron 调)。质量门禁在「排期创建」时已硬拦,
 * 此处不再拦(排期即用户的 outward-facing 确认)。依赖可注入 → 单测全 mock,不真打平台。
 */
import { claimDuePublishes, markScheduled } from './repos/scheduled-publish-repo';
import { recordPublish as defaultRecordPublish } from './repos/publish-record-repo';
import { assembleProjectPackage } from './publish-dispatch';
import { getPublishAdapter } from './publish-adapters';
import type { PublishAdapter } from './publish-adapters';

export interface SchedulerDeps {
  assemble?: typeof assembleProjectPackage;
  getAdapter?: (platform: string) => PublishAdapter;
  recordPublish?: typeof defaultRecordPublish;
  claim?: typeof claimDuePublishes;
}

export interface RunResult {
  processed: number;
  results: Array<{ id: string; platform: string; status: string; externalUrl?: string; error?: string }>;
}

export async function runDuePublishes(nowIso: string, deps: SchedulerDeps = {}): Promise<RunResult> {
  const assemble = deps.assemble ?? assembleProjectPackage;
  const getAdapter = deps.getAdapter ?? getPublishAdapter;
  const record = deps.recordPublish ?? defaultRecordPublish;
  const claim = deps.claim ?? claimDuePublishes;

  const claimed = await claim(nowIso);
  const results: RunResult['results'] = [];

  for (const job of claimed) {
    try {
      const assembled = assemble(job.projectId, job.platform);
      if (!assembled) {
        await markScheduled(job.id, { status: 'failed', lastError: '平台非法或取件失败' });
        results.push({ id: job.id, platform: job.platform, status: 'failed', error: 'assemble failed' });
        continue;
      }
      const adapter = getAdapter(job.platform);
      // 排期即用户的 outward-facing 确认 → confirmed=true(真上传只在 adapter.isConfigured 时发生)
      const up = await adapter.upload(assembled.bundle, { confirmed: true });
      const recStatus = up.status === 'published' ? 'published' : up.status === 'failed' ? 'failed' : 'packaged';
      const rec = await record({
        projectId: job.projectId,
        platform: job.platform,
        status: recStatus,
        title: assembled.bundle.title,
        externalUrl: up.externalUrl,
        publishedAt: up.status === 'published' ? nowIso : null,
      });
      await markScheduled(job.id, {
        status: up.status === 'failed' ? 'failed' : 'done',
        lastError: up.status === 'failed' ? up.message : null,
        publishRecordId: rec.id,
      });
      results.push({ id: job.id, platform: job.platform, status: up.status, externalUrl: up.externalUrl ?? undefined });
    } catch (e: any) {
      await markScheduled(job.id, { status: 'failed', lastError: String(e?.message || e) });
      results.push({ id: job.id, platform: job.platform, status: 'failed', error: String(e?.message || e) });
    }
  }

  return { processed: claimed.length, results };
}
