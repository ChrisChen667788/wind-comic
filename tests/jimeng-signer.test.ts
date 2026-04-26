/**
 * 即梦 / 火山引擎签名工具单测 (v2.0 Sprint 0 D2)
 *
 * 使用固定 AK/SK/时间戳验证签名算法的确定性与正确性。
 * 火山引擎签名协议是 AWS SigV4 衍生版，单测主要校验：
 *   1. 规范化请求字符串构造正确
 *   2. StringToSign 结构正确
 *   3. 派生签名密钥级联正确
 *   4. 最终 Authorization header 格式符合规范
 *   5. 幂等性（相同输入 → 相同签名）
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'crypto';
import {
  signRequest,
  deriveSigningKey,
  getJimengCredentials,
  hasJimengCredentials,
} from '@/services/jimeng-signer';

// 固定时间戳用于确定性测试
const FIXED_DATE = new Date(Date.UTC(2026, 3, 8, 12, 34, 56)); // 2026-04-08T12:34:56Z

// 公开测试用的假凭证
const AK = 'AKTESTFAKEKEY0001';
const SK = 'SKTESTFAKESECRET0001';

describe('jimeng-signer', () => {
  describe('deriveSigningKey', () => {
    it('逐级 HMAC 派生签名密钥', () => {
      const key = deriveSigningKey(SK, '20260408', 'cn-north-1', 'cv');
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32); // SHA256 → 32 字节
    });

    it('相同输入产生相同密钥（幂等）', () => {
      const a = deriveSigningKey(SK, '20260408', 'cn-north-1', 'cv');
      const b = deriveSigningKey(SK, '20260408', 'cn-north-1', 'cv');
      expect(a.equals(b)).toBe(true);
    });

    it('不同 secret 产生不同密钥', () => {
      const a = deriveSigningKey(SK, '20260408', 'cn-north-1', 'cv');
      const b = deriveSigningKey('different-secret', '20260408', 'cn-north-1', 'cv');
      expect(a.equals(b)).toBe(false);
    });

    it('手动级联验证算法正确性', () => {
      const expected = (() => {
        const kDate = createHmac('sha256', SK).update('20260408').digest();
        const kRegion = createHmac('sha256', kDate).update('cn-north-1').digest();
        const kService = createHmac('sha256', kRegion).update('cv').digest();
        const kSigning = createHmac('sha256', kService).update('request').digest();
        return kSigning;
      })();
      const actual = deriveSigningKey(SK, '20260408', 'cn-north-1', 'cv');
      expect(actual.equals(expected)).toBe(true);
    });
  });

  describe('signRequest', () => {
    const baseInput = {
      method: 'POST',
      host: 'visual.volcengineapi.com',
      path: '/',
      query: { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ req_key: 'jimeng_vgfm_i2v_l21', prompt: 'test' }),
      accessKey: AK,
      secretKey: SK,
      region: 'cn-north-1',
      service: 'cv',
      timestamp: FIXED_DATE,
    };

    it('返回完整签名产物', () => {
      const out = signRequest(baseInput);
      expect(out.authorization).toBeTruthy();
      expect(out.xDate).toBe('20260408T123456Z');
      expect(out.date).toBe('20260408');
      expect(out.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('Authorization header 格式符合 Volc4 规范', () => {
      const out = signRequest(baseInput);
      // 期望: "HMAC-SHA256 Credential=AK/date/region/service/request, SignedHeaders=..., Signature=..."
      expect(out.authorization).toMatch(/^HMAC-SHA256 /);
      expect(out.authorization).toContain(`Credential=${AK}/20260408/cn-north-1/cv/request`);
      expect(out.authorization).toContain('SignedHeaders=');
      expect(out.authorization).toContain(`Signature=${out.signature}`);
    });

    it('canonicalRequest 包含必要组成部分', () => {
      const out = signRequest(baseInput);
      const lines = out.canonicalRequest.split('\n');
      expect(lines[0]).toBe('POST');
      expect(lines[1]).toBe('/');
      // query 已排序（Action < Version）
      expect(lines[2]).toBe('Action=CVSync2AsyncSubmitTask&Version=2022-08-31');
      // 应包含 host: / x-date: / x-content-sha256: / content-type:
      expect(out.canonicalRequest).toContain('host:visual.volcengineapi.com');
      expect(out.canonicalRequest).toContain('x-date:20260408T123456Z');
      expect(out.canonicalRequest).toContain('content-type:application/json');
      // 最后一行是 payload SHA256
      const expectedPayloadHash = createHash('sha256').update(baseInput.body).digest('hex');
      expect(lines[lines.length - 1]).toBe(expectedPayloadHash);
    });

    it('stringToSign 格式为 4 行', () => {
      const out = signRequest(baseInput);
      const lines = out.stringToSign.split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('HMAC-SHA256');
      expect(lines[1]).toBe('20260408T123456Z');
      expect(lines[2]).toBe('20260408/cn-north-1/cv/request');
      expect(lines[3]).toMatch(/^[0-9a-f]{64}$/);
    });

    it('signedHeaders 按字典序排序且以分号分隔', () => {
      const out = signRequest(baseInput);
      const match = out.authorization.match(/SignedHeaders=([^,]+)/);
      expect(match).toBeTruthy();
      const signedHeaders = match![1].split(';');
      const sorted = [...signedHeaders].sort();
      expect(signedHeaders).toEqual(sorted);
      // 必须包含 host / x-date / x-content-sha256 / content-type
      expect(signedHeaders).toContain('host');
      expect(signedHeaders).toContain('x-date');
      expect(signedHeaders).toContain('x-content-sha256');
      expect(signedHeaders).toContain('content-type');
    });

    it('相同输入产生相同签名（确定性）', () => {
      const a = signRequest(baseInput);
      const b = signRequest(baseInput);
      expect(a.signature).toBe(b.signature);
      expect(a.authorization).toBe(b.authorization);
    });

    it('body 变更会改变签名', () => {
      const a = signRequest(baseInput);
      const b = signRequest({ ...baseInput, body: JSON.stringify({ diff: true }) });
      expect(a.signature).not.toBe(b.signature);
    });

    it('query 变更会改变签名', () => {
      const a = signRequest(baseInput);
      const b = signRequest({
        ...baseInput,
        query: { Action: 'OtherAction', Version: '2022-08-31' },
      });
      expect(a.signature).not.toBe(b.signature);
    });

    it('query 顺序无关紧要（会被排序）', () => {
      const a = signRequest({
        ...baseInput,
        query: { Action: 'Foo', Version: '2022-08-31' },
      });
      const b = signRequest({
        ...baseInput,
        query: { Version: '2022-08-31', Action: 'Foo' },
      });
      expect(a.signature).toBe(b.signature);
    });

    it('header key 大小写无关', () => {
      const a = signRequest({
        ...baseInput,
        headers: { 'Content-Type': 'application/json' },
      });
      const b = signRequest({
        ...baseInput,
        headers: { 'content-type': 'application/json' },
      });
      expect(a.signature).toBe(b.signature);
    });

    it('空 body 也能正确签名', () => {
      const out = signRequest({ ...baseInput, body: '' });
      expect(out.signature).toMatch(/^[0-9a-f]{64}$/);
      // 空字符串的 SHA256 是一个已知常量
      const emptyHash = createHash('sha256').update('').digest('hex');
      expect(out.canonicalRequest).toContain(emptyHash);
    });

    it('GET 请求（无 body）可签名', () => {
      const out = signRequest({
        ...baseInput,
        method: 'GET',
        body: undefined,
      });
      expect(out.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(out.canonicalRequest.startsWith('GET\n')).toBe(true);
    });

    it('默认 region 和 service 是 cn-north-1 / cv', () => {
      const out = signRequest({
        method: 'POST',
        host: 'visual.volcengineapi.com',
        path: '/',
        accessKey: AK,
        secretKey: SK,
        timestamp: FIXED_DATE,
      });
      expect(out.authorization).toContain('/20260408/cn-north-1/cv/request');
    });
  });

  describe('getJimengCredentials', () => {
    it('从 env 读取凭证', () => {
      const originalAK = process.env.JIMENG_AK;
      const originalSK = process.env.JIMENG_SK;
      process.env.JIMENG_AK = 'test-ak';
      process.env.JIMENG_SK = 'test-sk';
      const creds = getJimengCredentials();
      expect(creds.accessKey).toBe('test-ak');
      expect(creds.secretKey).toBe('test-sk');
      expect(creds.region).toBe('cn-north-1');
      expect(creds.service).toBe('cv');
      process.env.JIMENG_AK = originalAK;
      process.env.JIMENG_SK = originalSK;
    });
  });

  describe('hasJimengCredentials', () => {
    it('占位符返回 false', () => {
      const originalAK = process.env.JIMENG_AK;
      const originalSK = process.env.JIMENG_SK;
      process.env.JIMENG_AK = 'your_jimeng_ak';
      process.env.JIMENG_SK = 'your_jimeng_sk';
      expect(hasJimengCredentials()).toBe(false);
      process.env.JIMENG_AK = originalAK;
      process.env.JIMENG_SK = originalSK;
    });

    it('配置完整时返回 true', () => {
      const originalAK = process.env.JIMENG_AK;
      const originalSK = process.env.JIMENG_SK;
      process.env.JIMENG_AK = 'AKLI...';
      process.env.JIMENG_SK = 'secret...';
      expect(hasJimengCredentials()).toBe(true);
      process.env.JIMENG_AK = originalAK;
      process.env.JIMENG_SK = originalSK;
    });
  });
});
