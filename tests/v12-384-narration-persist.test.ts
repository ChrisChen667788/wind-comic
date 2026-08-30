/**
 * v12.384:解说音轨落盘全失败,接口报「已生成」,而且把上一次的成果删了。
 *
 * `/api/projects/:id/narration` POST 的流程是:
 *   TTS 合成 → 每段 persistAsset 落盘 → deleteAssetsByType('narration') → createAsset
 *
 * 两个问题叠在一起:
 *
 * ① **落盘失败是静默的**。persistAsset 返回 null 时,audioUrl 留 null、
 *    persistedAudio 不增,循环继续。而响应里的 `rendered` 取自 rendered.rendered ——
 *    那是 **TTS** 的成功标志,与落盘无关。于是「TTS 全成功、落盘全失败」会返回
 *    ok:true + rendered:true,库里躺着一条 mediaUrls 为空的静音轨。
 *    owner 看到「解说已生成」,合成成片,交片时才发现没声音;
 *    而 MiniMax 的音频外链几小时就过期,想补只能再花一次额度。
 *
 * ② **先 delete 再 create**。注释写着「失败可重跑」,可失败时旧的那条已经被删了 ——
 *    重跑一次失败,就把上一次成功的成果一起毁掉。
 *    「可重跑」的前提是失败不破坏现状。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const persistAsset = vi.fn();
const deleteAssetsByType = vi.fn(async () => {});
const createAsset = vi.fn(async () => ({}));
const synthesizeNarrationTrack = vi.fn();

vi.mock('@/lib/asset-storage', () => ({ persistAsset: (...a: any[]) => persistAsset(...a) }));
vi.mock('@/lib/repos/asset-repo', () => ({
  deleteAssetsByType: (...a: any[]) => deleteAssetsByType(...a),
  createAsset: (...a: any[]) => createAsset(...a),
}));
vi.mock('@/lib/narration-synth', () => ({ synthesizeNarrationTrack: (...a: any[]) => synthesizeNarrationTrack(...a) }));
vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: async () => ({ ok: true, userId: 'u' }) }));
vi.mock('@/lib/db', () => ({
  db: { prepare: () => ({ get: () => ({ id: 'p1', title: 't', script_data: '{"shots":[]}' }), all: () => [] }) },
}));
vi.mock('@/lib/narration-track', () => ({
  // enabled 必须为 true,否则路由在 plan 校验处就 400 早退 —— 那会让下面
  // 「不删旧的」这类否定式断言**因为根本没走到**而假绿
  buildNarrationTrack: () => ({ enabled: true, mode: 'narrator', voiceId: 'v', segments: [{ index: 0, text: 'a', start: 0, end: 2 }] }),
}));

import { POST } from '@/app/api/projects/[id]/narration/route';

/** text 必填 —— 少了它路由会 400 早退,测试就测不到落盘那段 */
const mkReq = (body: any = { text: '这是一段解说词' }) =>
  new Request('http://localhost/api/projects/p1/narration', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as any;
const params = { params: Promise.resolve({ id: 'p1' }) } as any;

/** TTS 成功产出 N 段带外链的音频 */
const ttsOk = (n: number) => ({
  mode: 'narrator', voiceId: 'v', voiceLabel: '旁白', totalDurationSec: n * 2,
  rendered: true, okCount: n,
  segments: Array.from({ length: n }, (_, i) => ({ index: i, text: `t${i}`, start: i * 2, end: i * 2 + 2, audioUrl: `https://cdn/x${i}.mp3` })),
  subtitle: [],
});

beforeEach(() => {
  persistAsset.mockReset(); deleteAssetsByType.mockClear(); createAsset.mockClear();
  synthesizeNarrationTrack.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('落盘全失败', () => {
  beforeEach(() => {
    synthesizeNarrationTrack.mockResolvedValue(ttsOk(5));
    persistAsset.mockResolvedValue(null);   // 每段都落盘失败
  });

  it('不报成功 —— 返回 502 且带上可诊断的原因', async () => {
    const res = await POST(mkReq(), params);
    expect(res.status).toBe(502);
    const d = await res.json();
    expect(d.ok).toBe(false);
    expect(d.error).toBe('audio_persist_failed');
    expect(d.ttsOk).toBe(5);
    expect(d.persistedAudio).toBe(0);
  });

  it('**不删旧的解说轨** —— 这是「失败可重跑」的前提', async () => {
    const res = await POST(mkReq(), params);
    // 自证:必须是真的走到了落盘那一步才失败的,而不是在入参校验处早退。
    // 否定式断言最容易这样假绿 —— 第一版就是 400 早退,却「通过」了。
    expect(res.status, '不是走到落盘才失败的话,下面两条断言毫无意义').toBe(502);
    expect(persistAsset).toHaveBeenCalled();
    expect(deleteAssetsByType, '重跑一次失败就毁掉上一次的成果').not.toHaveBeenCalled();
    expect(createAsset, '也不该写入空壳').not.toHaveBeenCalled();
  });

  it('文案告诉 owner「旧的还在」,而不是让他以为要从头再来', async () => {
    const d = await (await POST(mkReq(), params)).json();
    expect(d.message).toMatch(/保留|未做任何改动/);
  });
});

describe('部分落盘失败', () => {
  it('仍然落库(有总比没有强),但响应必须标明不完整', async () => {
    synthesizeNarrationTrack.mockResolvedValue(ttsOk(5));
    let n = 0;
    persistAsset.mockImplementation(async () => (++n <= 2 ? { url: `/api/serve-file?key=k${n}` } : null));
    const res = await POST(mkReq(), params);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.audioSegments, '有声音的段数').toBe(2);
    expect(d.partialAudio, '不标明的话,这和全成功长得一模一样').toBe(true);
    expect(deleteAssetsByType).toHaveBeenCalled();
    expect(createAsset).toHaveBeenCalled();
  });
});

describe('全部成功', () => {
  it('照常落库,partialAudio 为 false', async () => {
    synthesizeNarrationTrack.mockResolvedValue(ttsOk(3));
    let n = 0;
    persistAsset.mockImplementation(async () => ({ url: `/api/serve-file?key=k${++n}` }));
    const d = await (await POST(mkReq(), params)).json();
    expect(d.ok).toBe(true);
    expect(d.audioSegments).toBe(3);
    expect(d.partialAudio).toBe(false);
    expect(createAsset).toHaveBeenCalled();
    // 写进库的 mediaUrls 必须是真有音频的那些
    const arg = createAsset.mock.calls[0][0] as any;
    expect(arg.mediaUrls).toHaveLength(3);
  });
});

describe('守卫的位置(顺序错了等于没守)', () => {
  it('两道闸都排在 deleteAssetsByType 之前', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/narration/route.ts'), 'utf-8');
    const guardAt = src.indexOf("error: 'audio_persist_failed'");
    // 锚调用点而不是裸名字 —— 裸名字第一处是 import
    const deleteAt = src.indexOf("deleteAssetsByType(id, 'narration')");
    expect(guardAt).toBeGreaterThan(0);
    expect(deleteAt).toBeGreaterThan(0);
    expect(guardAt, '守卫排在 delete 之后 = 旧数据已经没了才发现失败').toBeLessThan(deleteAt);
  });
});
