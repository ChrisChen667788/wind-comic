/**
 * v12.460 · React 与 @react-three/fiber 同步升级。
 *
 * #48 #49(2026-09-17)因 r3f 9.7 的 peer 是 react「>=19 <19.3」被关掉,dependabot.yml 挡住了 >=19.3,
 * 并在**注释**里写下解锁条件。r3f 9.8.0 在 09-22 就支持了 19.3 —— 但这件事**没有任何东西会提醒**:
 * 挡板让 dependabot 不再开 PR,注释又没人去读,于是「已经能升了」静默躺了一周多。
 *
 * 这里把注释里的解锁条件变成测试:挡板必须**正好**等于已装 r3f 的 peer 上限。
 * r3f 放宽上限(能升了)或有人只升了一边(会 ERESOLVE),这条都会红,并告诉你该做什么。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parse } from 'yaml';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const r3f = JSON.parse(fs.readFileSync('node_modules/@react-three/fiber/package.json', 'utf-8'));
const installed = (name: string) => JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf-8')).version as string;
const minor = (v: string) => v.split('.').slice(0, 2).join('.');

/** r3f peer 里 react 的上限,如「>=19 <19.4」→ '19.4';没有上限 → null */
function peerCeiling(range: string): string | null {
  const m = range.match(/<\s*(\d+)\.(\d+)(?:\.0)?(?:\s|$)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

const dependabot = parse(fs.readFileSync('.github/dependabot.yml', 'utf-8')) as {
  updates: Array<{ 'package-ecosystem': string; ignore?: Array<{ 'dependency-name': string; versions?: string[] }> }>;
};
const npmIgnores = dependabot.updates.find((u) => u['package-ecosystem'] === 'npm')?.ignore ?? [];
const blockOf = (name: string) => npmIgnores.find((i) => i['dependency-name'] === name)?.versions ?? [];

const LOCKSTEP = ['react', 'react-dom', '@types/react', '@types/react-dom'];

describe('v12.460 · React 跟着 r3f 的 peer 上限走', () => {
  it('窗口自证:读到的是真的 r3f,且它对 react / react-dom 声明的是同一个区间', () => {
    expect(r3f.name).toBe('@react-three/fiber');
    expect(r3f.peerDependencies.react).toBe(r3f.peerDependencies['react-dom']);
  });

  it('已装的 react / react-dom / 两个类型包在同一个次版本上,且都在 r3f 的 peer 上限之下', () => {
    const ceiling = peerCeiling(r3f.peerDependencies.react);
    const minors = new Set(LOCKSTEP.map((n) => minor(installed(n))));
    expect([...minors], '四个包必须一起升,类型别跑到运行时前面').toHaveLength(1);
    if (ceiling) {
      const [cMaj, cMin] = ceiling.split('.').map(Number);
      const [maj, min] = [...minors][0].split('.').map(Number);
      expect(maj * 1000 + min, `react ${[...minors][0]} 超出了 r3f 的 peer 上限 <${ceiling}`).toBeLessThan(cMaj * 1000 + cMin);
    }
  });

  it('package.json 用 ~ 锁在当前次版本(^ 会被 npm 解析到下一个次版本,撞 r3f 的上限)', () => {
    for (const n of ['react', 'react-dom']) {
      expect(pkg.dependencies[n], n).toBe(`~${minor(installed(n))}.0`);
    }
  });

  it('**dependabot 的挡板正好等于 r3f 的 peer 上限** —— r3f 放宽了就红,提醒去升', () => {
    const ceiling = peerCeiling(r3f.peerDependencies.react);
    if (ceiling === null) {
      // r3f 不再设上限:挡板该整个删掉
      expect(LOCKSTEP.flatMap(blockOf), 'r3f 已不设 react 上限 —— 删掉 dependabot.yml 里这四条挡板,把 React 升上去').toEqual([]);
      return;
    }
    for (const n of LOCKSTEP) {
      expect(blockOf(n), `${n} 的挡板应为 >=${ceiling}.0(r3f peer 上限 <${ceiling});不相等说明 r3f 已放宽、可以升了,或挡板没跟着改`)
        .toEqual([`>=${ceiling}.0`]);
    }
  });
});
