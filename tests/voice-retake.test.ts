/**
 * v10.6.4 — 配音 retake 工作流单测(MOCK_ENGINES=1,mock-tts 确定性合成;
 * 音频落盘 mock 成原样透传,聚焦 take/采用/失效语义)。
 *
 * 验收核心:**单句重录不动整集** —— 重录只生成 take 历史行;采用只改该镜活动行
 * (bumpVersion)+ 该镜 video 置 stale;其余镜活动行与 video 全程零接触。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/asset-storage', () => ({
  // 单测无 dev server,mock URL 抓不下来 —— 原样透传(e2e 走真落盘)
  persistAsset: async (url: string) => ({ key: 'k', absPath: '/tmp/x.mp3', url, contentType: 'audio/mpeg', size: 1 }),
}));

import { db } from '@/lib/db';
import { insertProjectFull, updateProjectById } from '@/lib/repos/project-repo';
import { createAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import {
  loadDialogueShots, synthesizeRetake, adoptTake, listRetakeState, runVoiceRetakeJob,
  TAKE_TYPE, ACTIVE_TYPE,
} from '@/lib/voice-retake';
import { EMOTION_LABELS, deriveProsody } from '@/lib/tts-prosody';

const PID = 'p-retake-test';

beforeAll(async () => {
  process.env.MOCK_ENGINES = '1';
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run('u-test', 'retake@test.dev', 'x', '重录测试员', new Date().toISOString());
  await insertProjectFull({
    id: PID, userId: 'u-test', title: '重录测试', description: '',
    coverUrls: [], status: 'completed', styleId: 'cyberpunk',
    primaryCharacterRef: null, lockedCharacters: [],
  });
  await updateProjectById(PID, {
    script_data: JSON.stringify({
      title: '重录测试', synopsis: '',
      shots: [
        { shotNumber: 1, characters: ['程一帆'], dialogue: '三年了,这段电波从没迟到过一秒。', emotion: '深沉' },
        { shotNumber: 2, character: '苏雨眠', dialogue: '你终于肯来了。', emotion: '冷静' }, // 单数 character(演示工程形)
        { shotNumber: 3, characters: ['程一帆'], dialogue: '', emotion: '平静' },           // 无对白 → 不入列
      ],
    }),
  });
});

describe('v10.6.4 · loadDialogueShots', () => {
  it('script 资产缺失 → 回退 projects.script_data;无对白镜不入列;speaker 兼容单/复数字段', async () => {
    const shots = await loadDialogueShots(PID);
    expect(shots.map((s) => s.shotNumber)).toEqual([1, 2]);
    expect(shots[0].speaker).toBe('程一帆');
    expect(shots[1].speaker).toBe('苏雨眠');
  });
});

describe('v10.6.4 · 台词级情绪标签 → prosody', () => {
  it('EMOTION_LABELS 全部产出合法 prosody;愤怒提速、悲伤降速(与中性可分)', () => {
    for (const l of EMOTION_LABELS) {
      const p = deriveProsody({ emotion: l });
      expect(p.speed).toBeGreaterThanOrEqual(0.5);
      expect(p.speed).toBeLessThanOrEqual(2);
    }
    expect(deriveProsody({ emotion: '愤怒' }).speed).toBeGreaterThan(1);
    expect(deriveProsody({ emotion: '悲伤' }).speed).toBeLessThan(1);
  });
});

describe('v10.6.4 · 单句重录 + 版本 + 采用(真 DB)', () => {
  it('重录只生成 take 历史行;换情绪重录产物 URL 不同(prosody 进 mock 种子)', async () => {
    const r1 = await synthesizeRetake({ projectId: PID, shotNumber: 1, emotion: '愤怒' });
    expect(r1.ok).toBe(true);
    expect(r1.takeId).toMatch(/^take-1-/);
    expect(r1.prosody!.speed).toBeGreaterThan(1);

    const r2 = await synthesizeRetake({ projectId: PID, shotNumber: 1, emotion: '悲伤' });
    expect(r2.ok).toBe(true);
    expect(r2.audioUrl).not.toBe(r1.audioUrl); // A/B 可分

    const takes = await listAssetsByType(PID, TAKE_TYPE);
    expect(takes.filter((t) => t.shot_number === 1).length).toBe(2);
    // 活动行未被动过
    expect((await listAssetsByType(PID, ACTIVE_TYPE)).length).toBe(0);
  });

  it('验收:采用 take 只动该镜 —— 其余镜活动行与 video 零接触', async () => {
    // 预置:两镜活动配音 + 两镜 video
    await createAsset({ projectId: PID, type: ACTIVE_TYPE, name: '配音 · 镜 1', data: { emotion: '深沉' }, mediaUrls: ['/old-1.mp3'], shotNumber: 1, version: 1 });
    await createAsset({ projectId: PID, type: ACTIVE_TYPE, name: '配音 · 镜 2', data: { emotion: '冷静' }, mediaUrls: ['/old-2.mp3'], shotNumber: 2, version: 1 });
    await createAsset({ projectId: PID, type: 'video', name: '镜 1 视频', data: {}, mediaUrls: ['/v1.mp4'], shotNumber: 1, version: 1 });
    await createAsset({ projectId: PID, type: 'video', name: '镜 2 视频', data: {}, mediaUrls: ['/v2.mp4'], shotNumber: 2, version: 1 });

    const r = await synthesizeRetake({ projectId: PID, shotNumber: 1, emotion: '激动' });
    const adopted = await adoptTake(PID, r.takeId!);
    expect(adopted.ok).toBe(true);
    expect(adopted.shotNumber).toBe(1);
    expect(adopted.staleMarked).toBe(1);

    const actives = await listAssetsByType(PID, ACTIVE_TYPE);
    const a1 = actives.find((x) => x.shot_number === 1)!;
    const a2 = actives.find((x) => x.shot_number === 2)!;
    expect(JSON.parse(a1.media_urls!)[0]).toBe(r.audioUrl);  // 换入重录版
    expect(a1.version).toBe(2);                               // bumpVersion
    expect(JSON.parse(a1.data).adoptedTakeId).toBe(r.takeId);
    expect(JSON.parse(a2.media_urls!)[0]).toBe('/old-2.mp3'); // 镜 2 零接触
    expect(a2.version).toBe(1);

    // video:只镜 1 置 stale(asset-repo COLS 不含 stale → 直查)
    const rows = db.prepare("SELECT shot_number, stale FROM project_assets WHERE project_id = ? AND type = 'video'").all(PID) as any[];
    const staleByShot = Object.fromEntries(rows.map((x) => [x.shot_number, x.stale]));
    expect(staleByShot[1]).toBe(1);
    expect(staleByShot[2]).toBe(0);
  });

  it('采用后精准摘掉该镜的口型对齐旧分(整项目聚合行,审查修复回归)', async () => {
    await createAsset({
      projectId: PID, type: 'lipsync-align', name: '口型-音频对齐分',
      data: { scores: { '1': 82, '2': 90 } }, version: 1,
    });
    const r = await synthesizeRetake({ projectId: PID, shotNumber: 1, emotion: '惊讶' });
    await adoptTake(PID, r.takeId!);
    const align = (await listAssetsByType(PID, 'lipsync-align'))[0];
    const scores = JSON.parse(align.data).scores;
    expect(scores['1']).toBeUndefined(); // 换了配音 → 该镜旧对齐分不可信,摘掉
    expect(scores['2']).toBe(90);        // 其余镜分数保留
  });

  it('该镜没有活动行时采用 → 直接建活动行', async () => {
    const r = await synthesizeRetake({ projectId: PID, shotNumber: 2, emotion: '温柔' });
    const before = (await listAssetsByType(PID, ACTIVE_TYPE)).find((x) => x.shot_number === 2)!;
    expect(before).toBeTruthy(); // 上个用例建过 → 走更新分支
    const adopted = await adoptTake(PID, r.takeId!);
    expect(adopted.ok).toBe(true);
    const after = (await listAssetsByType(PID, ACTIVE_TYPE)).find((x) => x.shot_number === 2)!;
    expect(JSON.parse(after.media_urls!)[0]).toBe(r.audioUrl);
  });

  it('listRetakeState:活动版 + takes 新→旧 + adopted 标记', async () => {
    const state = await listRetakeState(PID);
    const s1 = state.find((x) => x.shotNumber === 1)!;
    expect(s1.activeUrl).toBeTruthy();
    expect(s1.takes.length).toBe(4); // 愤怒/悲伤/激动/惊讶
    expect(s1.takes.some((t) => t.adopted)).toBe(true);
    expect(s1.takes.filter((t) => t.adopted)[0].emotion).toBe('惊讶'); // 最后一次采用
  });

  it('不存在的 take / 镜号 → 明确失败,不抛', async () => {
    expect((await adoptTake(PID, 'take-9-nope')).ok).toBe(false);
    expect((await synthesizeRetake({ projectId: PID, shotNumber: 99 })).ok).toBe(false);
  });
});

describe('v10.6.4 · 重录队列任务体', () => {
  it('批量逐句执行 + 进度事件;部分成功算完成', async () => {
    const events: Array<{ type: string; data: any }> = [];
    await runVoiceRetakeJob(
      { projectId: PID, shots: [{ shotNumber: 1, emotion: '紧张' }, { shotNumber: 99 }] },
      (type, data) => events.push({ type, data }),
    );
    expect(events.filter((e) => e.type === 'retakeProgress').length).toBe(2);
    const done = events.find((e) => e.type === 'retakeDone')!;
    expect(done.data.ok).toBe(1);
    expect(done.data.total).toBe(2);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('全军覆没 → 发 error(worker 据此判失败重试)', async () => {
    const events: Array<{ type: string; data: any }> = [];
    await runVoiceRetakeJob(
      { projectId: PID, shots: [{ shotNumber: 98 }, { shotNumber: 99 }] },
      (type, data) => events.push({ type, data }),
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'retakeDone')).toBe(false);
  });
});
