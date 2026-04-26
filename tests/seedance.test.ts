/**
 * Seedance (即梦) 服务单测 (v2.0 Sprint 0 D3)
 *
 * 测试策略：
 *  1. `buildPayload` 纯函数测试：req_key 选择、边界校验、字段映射
 *  2. `extractTaskId` / `parseTaskResult` 对多种响应结构的解析鲁棒性
 *  3. `submitTask` / `queryResult`：通过 mock fetch 验证请求构造（方法、URL、签名 header 存在）
 *  4. 不发真实网络请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SeedanceService,
  extractTaskId,
  parseTaskResult,
  SEEDANCE_REQ_KEYS,
  SEEDANCE_RESOLUTION_SIZE,
  hasSeedance,
  type SeedanceGenerateOptions,
} from '@/services/seedance.service';

const FAKE_CREDS = {
  accessKey: 'AKTESTFAKEKEY0001',
  secretKey: 'SKTESTFAKESECRET0001',
  region: 'cn-north-1',
  service: 'cv',
};

function makeService() {
  return new SeedanceService(FAKE_CREDS);
}

// ──────────────────────────────────────────────────────────
// buildPayload
// ──────────────────────────────────────────────────────────

describe('SeedanceService.buildPayload', () => {
  const svc = makeService();

  it('文生视频默认使用 t2v req_key', () => {
    const { reqKey, body } = svc.buildPayload({ prompt: 'a cat on the moon' });
    expect(reqKey).toBe(SEEDANCE_REQ_KEYS.t2v);
    expect(body.req_key).toBe(SEEDANCE_REQ_KEYS.t2v);
    expect(body.prompt).toBe('a cat on the moon');
  });

  it('带参考图时切换为 i2v req_key 并设置首帧', () => {
    const { reqKey, body } = svc.buildPayload({
      prompt: 'x',
      referenceImages: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    });
    expect(reqKey).toBe(SEEDANCE_REQ_KEYS.i2v);
    expect(body.image_urls).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
    expect(body.first_frame_image).toBe('https://example.com/a.jpg');
  });

  it('nativeAudio=true 切换为 av req_key', () => {
    const { reqKey, body } = svc.buildPayload({ prompt: 'x', nativeAudio: true });
    expect(reqKey).toBe(SEEDANCE_REQ_KEYS.av);
    expect(body.native_audio).toBe(true);
  });

  it('editMode 优先级最高，切换为 edit req_key', () => {
    const { reqKey, body } = svc.buildPayload({
      prompt: 'x',
      referenceImages: ['https://example.com/a.jpg'], // 不该被 i2v 抢占
      nativeAudio: true, // 也不该被 av 抢占
      editMode: {
        type: 'replace_character',
        sourceVideo: 'https://example.com/source.mp4',
        target: 'new character desc',
      },
    });
    expect(reqKey).toBe(SEEDANCE_REQ_KEYS.edit);
    expect(body.edit_mode).toBe('replace_character');
    expect(body.source_video_url).toBe('https://example.com/source.mp4');
    expect(body.edit_target).toBe('new character desc');
  });

  it('默认分辨率为 720p，尺寸正确', () => {
    const { body } = svc.buildPayload({ prompt: 'x' });
    expect(body.resolution).toBe('720p');
    expect(body.width).toBe(SEEDANCE_RESOLUTION_SIZE['720p'].width);
    expect(body.height).toBe(SEEDANCE_RESOLUTION_SIZE['720p'].height);
  });

  it('指定 360p / 480p 分辨率时尺寸正确', () => {
    const r360 = svc.buildPayload({ prompt: 'x', resolution: '360p' }).body;
    expect(r360.resolution).toBe('360p');
    expect(r360.width).toBe(640);
    expect(r360.height).toBe(360);

    const r480 = svc.buildPayload({ prompt: 'x', resolution: '480p' }).body;
    expect(r480.resolution).toBe('480p');
    expect(r480.width).toBe(854);
    expect(r480.height).toBe(480);
  });

  it('默认 duration=5', () => {
    const { body } = svc.buildPayload({ prompt: 'x' });
    expect(body.duration).toBe(5);
  });

  it('透传 negativePrompt / seed / cameraMotion', () => {
    const { body } = svc.buildPayload({
      prompt: 'x',
      negativePrompt: 'blurry, low-quality',
      seed: 42,
      cameraMotion: 'orbit',
    });
    expect(body.negative_prompt).toBe('blurry, low-quality');
    expect(body.seed).toBe(42);
    expect(body.camera_motion).toBe('orbit');
  });

  it('raw 字段可覆盖默认值', () => {
    const { body } = svc.buildPayload({
      prompt: 'x',
      raw: { duration: 15, custom_field: 'yes' },
    });
    expect(body.duration).toBe(15);
    expect(body.custom_field).toBe('yes');
  });

  it('空 prompt 抛错', () => {
    expect(() => svc.buildPayload({ prompt: '' } as SeedanceGenerateOptions)).toThrow(
      /prompt is required/,
    );
    expect(() => svc.buildPayload({ prompt: '   ' } as SeedanceGenerateOptions)).toThrow(
      /prompt is required/,
    );
  });

  it('referenceImages 超过 9 张抛错', () => {
    expect(() =>
      svc.buildPayload({
        prompt: 'x',
        referenceImages: Array.from({ length: 10 }, (_, i) => `https://ex.com/${i}.jpg`),
      }),
    ).toThrow(/max 9/);
  });

  it('referenceVideos 超过 3 段抛错', () => {
    expect(() =>
      svc.buildPayload({
        prompt: 'x',
        referenceVideos: ['v1', 'v2', 'v3', 'v4'],
      }),
    ).toThrow(/max 3/);
  });

  it('referenceAudios 超过 3 段抛错', () => {
    expect(() =>
      svc.buildPayload({
        prompt: 'x',
        referenceAudios: ['a1', 'a2', 'a3', 'a4'],
      }),
    ).toThrow(/max 3/);
  });
});

// ──────────────────────────────────────────────────────────
// extractTaskId
// ──────────────────────────────────────────────────────────

describe('extractTaskId', () => {
  it('从 Result.task_id 中提取', () => {
    expect(extractTaskId({ Result: { task_id: 'abc' } })).toBe('abc');
  });

  it('从 data.task_id 中提取', () => {
    expect(extractTaskId({ data: { task_id: 'xyz' } })).toBe('xyz');
  });

  it('从顶层 task_id 中提取', () => {
    expect(extractTaskId({ task_id: 'top' })).toBe('top');
  });

  it('大小写变体 TaskId', () => {
    expect(extractTaskId({ Result: { TaskId: 'big' } })).toBe('big');
  });

  it('无 task_id 返回 undefined', () => {
    expect(extractTaskId({ Result: {} })).toBeUndefined();
    expect(extractTaskId(null)).toBeUndefined();
    expect(extractTaskId(undefined)).toBeUndefined();
    expect(extractTaskId('foo')).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────
// parseTaskResult
// ──────────────────────────────────────────────────────────

describe('parseTaskResult', () => {
  it('done 状态 + video_url → success', () => {
    const r = parseTaskResult('t1', {
      Result: { status: 'done', video_url: 'https://cdn/v.mp4', cover_url: 'https://cdn/c.jpg' },
    });
    expect(r.status).toBe('success');
    expect(r.videoUrl).toBe('https://cdn/v.mp4');
    expect(r.coverUrl).toBe('https://cdn/c.jpg');
  });

  it('success 状态 (英文别名) 同样识别', () => {
    const r = parseTaskResult('t1', {
      data: { status: 'success', video_url: 'https://cdn/v.mp4' },
    });
    expect(r.status).toBe('success');
  });

  it('done 但无 video_url → failed', () => {
    const r = parseTaskResult('t1', { Result: { status: 'done' } });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/no video_url/);
  });

  it('in_queue → pending', () => {
    const r = parseTaskResult('t1', { Result: { status: 'in_queue' } });
    expect(r.status).toBe('pending');
  });

  it('generating → running', () => {
    const r = parseTaskResult('t1', { Result: { status: 'generating' } });
    expect(r.status).toBe('running');
  });

  it('failed 状态带错误原因', () => {
    const r = parseTaskResult('t1', {
      Result: { status: 'failed', fail_reason: 'quota exceeded' },
    });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('quota exceeded');
  });

  it('ResponseMetadata.Error.Code 判定业务错误', () => {
    const r = parseTaskResult('t1', {
      ResponseMetadata: { Error: { Code: 'SignatureDoesNotMatch' } },
    });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('SignatureDoesNotMatch');
  });

  it('video_urls 数组取第一个', () => {
    const r = parseTaskResult('t1', {
      Result: { status: 'done', video_urls: ['https://cdn/a.mp4', 'https://cdn/b.mp4'] },
    });
    expect(r.status).toBe('success');
    expect(r.videoUrl).toBe('https://cdn/a.mp4');
  });

  it('空响应 → failed', () => {
    const r = parseTaskResult('t1', null);
    expect(r.status).toBe('failed');
  });
});

// ──────────────────────────────────────────────────────────
// submitTask / queryResult (mock fetch)
// ──────────────────────────────────────────────────────────

describe('SeedanceService.submitTask (mocked fetch)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('构造正确的 URL / method / 签名 headers', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ Result: { task_id: 'TASK123' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const svc = makeService();
    const res = await svc.submitTask({ prompt: 'test prompt', resolution: '480p' });

    expect(res.taskId).toBe('TASK123');
    expect(res.reqKey).toBe(SEEDANCE_REQ_KEYS.t2v);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      'https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31',
    );
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Host']).toBe('visual.volcengineapi.com');
    expect(headers['X-Date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['X-Content-Sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['Authorization']).toMatch(/^HMAC-SHA256 Credential=/);
    expect(headers['Authorization']).toContain('SignedHeaders=');
    expect(headers['Authorization']).toContain('Signature=');

    // body 应是 JSON
    const bodyStr = init.body as string;
    const parsed = JSON.parse(bodyStr);
    expect(parsed.req_key).toBe(SEEDANCE_REQ_KEYS.t2v);
    expect(parsed.resolution).toBe('480p');
    expect(parsed.prompt).toBe('test prompt');
  });

  it('HTTP 非 2xx 时抛错', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    );
    const svc = makeService();
    await expect(svc.submitTask({ prompt: 'x' })).rejects.toThrow(/Submit HTTP 500/);
  });

  it('缺 task_id 时抛错', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ Result: {} }), { status: 200 }),
    );
    const svc = makeService();
    await expect(svc.submitTask({ prompt: 'x' })).rejects.toThrow(/no task_id/);
  });

  it('缺少凭证时抛错', async () => {
    const svc = new SeedanceService({ accessKey: '', secretKey: '' });
    await expect(svc.submitTask({ prompt: 'x' })).rejects.toThrow(/Missing credentials/);
  });
});

describe('SeedanceService.queryResult (mocked fetch)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('解析 done 响应为 success', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Result: { status: 'done', video_url: 'https://cdn/v.mp4' },
        }),
        { status: 200 },
      ),
    );

    const svc = makeService();
    const r = await svc.queryResult('TASK123', SEEDANCE_REQ_KEYS.t2v);
    expect(r.status).toBe('success');
    expect(r.videoUrl).toBe('https://cdn/v.mp4');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('Action=CVSync2AsyncGetResult');
  });

  it('HTTP 错误时返回 failed 而非抛错（便于轮询继续）', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ e: 'x' }), { status: 502 }),
    );
    const svc = makeService();
    const r = await svc.queryResult('T', SEEDANCE_REQ_KEYS.t2v);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/HTTP 502/);
  });
});

// ──────────────────────────────────────────────────────────
// hasSeedance (env 探测)
// ──────────────────────────────────────────────────────────

describe('hasSeedance', () => {
  it('未配置时返回 false', () => {
    const origAK = process.env.JIMENG_AK;
    const origSK = process.env.JIMENG_SK;
    delete process.env.JIMENG_AK;
    delete process.env.JIMENG_SK;
    expect(hasSeedance()).toBe(false);
    if (origAK) process.env.JIMENG_AK = origAK;
    if (origSK) process.env.JIMENG_SK = origSK;
  });

  it('配置完整时返回 true', () => {
    const origAK = process.env.JIMENG_AK;
    const origSK = process.env.JIMENG_SK;
    process.env.JIMENG_AK = 'AKTEST';
    process.env.JIMENG_SK = 'SKTEST';
    expect(hasSeedance()).toBe(true);
    if (origAK !== undefined) process.env.JIMENG_AK = origAK;
    else delete process.env.JIMENG_AK;
    if (origSK !== undefined) process.env.JIMENG_SK = origSK;
    else delete process.env.JIMENG_SK;
  });
});
