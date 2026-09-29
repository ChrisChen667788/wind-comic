/**
 * v12.456 · 对外文案里的「v2.0 → v12.x」必须整个替换,补丁段不许残留。
 *
 * 旧规则 `v12\.\d+` 只吃前两段:`v2.0 → v12.455.1.1.1` 被改成 `v2.0 → v12.456.1.1.1`,
 * 尾巴原样留着(v12.370.x 补丁版留下的 `.1`,每次发版都被保住)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { syncVersionRefs } from '../scripts/sync-doc-stats.mjs';

describe('v12.456 · 版本自述位置整段替换', () => {
  it('补丁段残留被整段换掉', () => {
    expect(syncVersionRefs('8 个月, v2.0 → v12.455.1.1.1, 6102 个单测', 'v12.456'))
      .toBe('8 个月, v2.0 → v12.456, 6102 个单测');
  });

  it('正常的两段版本号照常替换', () => {
    expect(syncVersionRefs('- v2.0 → v12.455', 'v12.456')).toBe('- v2.0 → v12.456');
  });

  it('幂等:同步两次与一次结果相同', () => {
    const once = syncVersionRefs('v2.0 → v12.370.1.1', 'v12.456');
    expect(syncVersionRefs(once, 'v12.456')).toBe(once);
    expect(once).toBe('v2.0 → v12.456');
  });

  it('不在「v2.0 →」后面的版本号不动(历史引用如 v12.315)', () => {
    const line = '片段重拍 *(v12.315)* 起,v12.370.1 修过脚本';
    expect(syncVersionRefs(line, 'v12.456')).toBe(line);
  });

  it('真实对外文档里没有三段以上的尾巴', () => {
    for (const f of ['docs/MARKETING-zh.md', 'docs/MARKETING-en.md', 'docs/modelscope-profile.md', 'README.md', 'README.zh-CN.md']) {
      const text = fs.readFileSync(f, 'utf-8');
      expect(text.length, `${f} 读到空文件`).toBeGreaterThan(1000);
      expect(text, f).not.toMatch(/v2\.0 → v12(?:\.\d+){2,}/);
    }
  });
});
