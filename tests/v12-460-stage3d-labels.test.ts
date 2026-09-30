/**
 * v12.460 · 导演台 3D 视口的名字标签不再用 drei `<Html>`。
 *
 * 真浏览器 A/B(e2e/stage3d.spec.ts):@react-three/fiber 9.7 干净;9.8.0 / 9.8.1 每次从 3D 切回平面、
 * 或关掉导演台,控制台都报「Attempted to synchronously unmount a root while React was already rendering」,
 * 紧跟一条未捕获的 `removeChild` NotFoundError;只拿掉 `<Html>` 就干净。
 * 原因:`<Html>` 在 3D 场景里另起一个 ReactDOM 根,卸载时同步 `root.unmount()`;r3f 9.8 把场景拆除挪到
 * React 提交卸载的那一刻同步执行,两者撞在一起。React 19.3 要求 r3f ≥ 9.8,所以这条路必须换掉。
 *
 * 那条 e2e 要真 WebGL,不进 CI;这里锁住 CI 能锁的两件事:
 *   ① 全仓不许再从 drei 引 `Html`(按 TypeScript 语法树取 import,不 grep 原文 —— 注释里提到它不算);
 *   ② 替代它的投影与 drei `<Html center>` 同一套算法:画面中心、左右方向、身后/近裁剪面不显示。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectLabel } from '@/components/project/stage3d-viewport';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...sourceFiles(p)); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 从某个模块具名导入的名字(含 `Html as X` 里的原名) */
function namedImportsFrom(file: string, moduleName: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== moduleName) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push((el.propertyName ?? el.name).text);
    // `import * as drei` 之后再 drei.Html —— 也算
    if (nb && ts.isNamespaceImport(nb) && /\bdrei\.Html\b|\.Html\b/.test(sf.text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) names.push('Html');
  }
  return names;
}

describe('v12.460 · 3D 视口名字标签', () => {
  const files = ['app', 'components', 'lib', 'hooks'].filter((d) => fs.existsSync(d)).flatMap(sourceFiles);

  it('窗口自证:解析器真的能认出从 drei 导入的名字', () => {
    expect(namedImportsFrom('components/project/stage3d-viewport.tsx', '@react-three/drei')).toEqual(
      expect.arrayContaining(['OrbitControls', 'PerspectiveCamera', 'Grid', 'Line']),
    );
  });

  it('**全仓不从 @react-three/drei 引 Html**(它在场景里另起 ReactDOM 根,r3f 9.8 下卸载必报错)', () => {
    const offenders = files.filter((f) => namedImportsFrom(f, '@react-three/drei').includes('Html'));
    expect(offenders, `这些文件又用上了 drei 的 Html:\n${offenders.join('\n')}\n改用 stage3d-viewport 里画布外 DOM + LabelProjector 的做法`).toEqual([]);
  });

  describe('projectLabel 与 drei <Html center> 同一套投影', () => {
    // 相机在原点、看向 −z(three 默认),与机位视角同一约定
    const cam = new PerspectiveCamera(50, 16 / 9, 0.05, 200);
    cam.updateMatrixWorld();
    const size = { width: 1600, height: 900 };

    it('正前方的点落在画面中心', () => {
      const p = projectLabel(new Vector3(0, 0, -5), cam, size);
      expect(p.visible).toBe(true);
      expect(p.x).toBeCloseTo(800, 6);
      expect(p.y).toBeCloseTo(450, 6);
    });

    it('右上方的点:x 往右、y 往上(屏幕 y 向下)', () => {
      const p = projectLabel(new Vector3(1, 1, -5), cam, size);
      expect(p.x).toBeGreaterThan(800);
      expect(p.y).toBeLessThan(450);
    });

    it('与 three 的 project() 逐点一致(drei 的 calculatePosition 就是这个)', () => {
      for (const [x, y, z] of [[0.3, -0.2, -3], [-2, 1.5, -8], [4, 0.1, -20]]) {
        const v = new Vector3(x, y, z).project(cam);
        const p = projectLabel(new Vector3(x, y, z), cam, size);
        expect(p.x).toBeCloseTo((v.x * size.width) / 2 + size.width / 2, 6);
        expect(p.y).toBeCloseTo(-(v.y * size.height) / 2 + size.height / 2, 6);
      }
    });

    it('**相机身后**、近裁剪面以内的点不显示(否则标签会镜像到画面里)', () => {
      expect(projectLabel(new Vector3(0, 1, 5), cam, size).visible).toBe(false);
      expect(projectLabel(new Vector3(0, 0, -0.01), cam, size).visible).toBe(false);
    });

    it('不改传入的坐标(每帧复用同一个 Vector3)', () => {
      const w = new Vector3(1, 2, -5);
      projectLabel(w, cam, size);
      expect(w.toArray()).toEqual([1, 2, -5]);
    });
  });
});
