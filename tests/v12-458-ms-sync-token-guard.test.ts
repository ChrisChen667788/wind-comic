/**
 * v12.458 · ModelScope 同步:令牌格式先在本地拦下,导出的临时副本成功失败都要删。
 *
 * 实际发生过:令牌位置放的是占位文字「你的令牌」,或首字符是 macOS ⌥V 打出的「√」。两次都一路走进
 * modelscope CLI,炸成几十行 `UnicodeEncodeError: 'latin-1'` traceback,看不出是令牌错了;
 * 每次还在临时目录留下一份 2000 多个文件的整仓副本。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tokenProblem } from '@/scripts/modelscope-sync.mjs';

const SCRIPT = path.resolve('scripts/modelscope-sync.mjs');

function run(token: string, extraPath?: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v12458-ms-'));
  const env = { ...process.env, MODELSCOPE_API_TOKEN: token, TMPDIR: tmp, PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH };
  const r = spawnSync('node', [SCRIPT], { env, encoding: 'utf-8', timeout: 120_000 });
  const leftovers = fs.readdirSync(tmp).filter((d) => d.startsWith('ms-sync-') || d.startsWith('ms-preview-'));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, leftovers };
}

describe('v12.458 · 令牌格式预检', () => {
  it('占位文字「你的令牌」→ 说清是占位文字', () => {
    const p = tokenProblem('你的令牌');
    expect(p).toMatch(/第 1 个字符/);
    expect(p).toMatch(/占位文字/);
  });

  it('首字符是 ⌥V 打出的「√」→ 提示用 ⌘V', () => {
    expect(tokenProblem('√ms-abcdef')).toMatch(/⌥V.*⌘V/);
  });

  it('中间混进空白 → 指出第几个字符', () => {
    expect(tokenProblem('ms-abc def')).toMatch(/第 7 个字符.*空白/);
  });

  it('缺失或全是空白 → 缺令牌', () => {
    expect(tokenProblem(undefined)).toMatch(/缺 MODELSCOPE_API_TOKEN/);
    expect(tokenProblem('   ')).toMatch(/缺 MODELSCOPE_API_TOKEN/);
  });

  it('正常令牌(含首尾空白/换行)→ 通过', () => {
    expect(tokenProblem('ms-0a1b2c3d-4e5f-6789-abcd-ef0123456789')).toBeNull();
    expect(tokenProblem('  ms-0a1b2c3d-4e5f\n')).toBeNull();
  });

  it('报错**绝不回显令牌本身**', () => {
    const p = tokenProblem('ms-TOPSECRET√xyz')!;
    expect(p).toBeTruthy();
    expect(p).not.toContain('TOPSECRET');
    expect(p).not.toContain('ms-');
  });
});

describe('v12.458 · 脚本行为', () => {
  it('占位令牌:退出 2、一句中文说明、没有 Python traceback、没导出任何东西', () => {
    const r = run('你的令牌');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/占位文字/);
    expect(r.out).not.toMatch(/Traceback|UnicodeEncodeError/);
    expect(r.leftovers).toEqual([]);
  });

  it('上传失败时,导出的整仓副本也被删掉(用一个必失败的假 modelscope 验)', () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'v12458-bin-'));
    fs.writeFileSync(path.join(bin, 'modelscope'), '#!/bin/sh\necho "fake upload failure" >&2\nexit 1\n', { mode: 0o755 });
    try {
      const r = run('ms-0a1b2c3d-4e5f-6789-abcd-ef0123456789', bin);
      expect(r.code, r.out.slice(-400)).toBe(1);
      expect(r.out, '确实走到了导出与上传这一步').toMatch(/导出 \d+ 个 git 跟踪文件/);
      expect(r.out).toMatch(/fake upload failure/);
      expect(r.leftovers, '失败后留下了整仓副本').toEqual([]);
      expect(r.out, '失败信息里不能带出令牌').not.toContain('0a1b2c3d');
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }, 120_000);
});
