/**
 * v12.300 — 四处「只 console、不告诉用户」的静默失败,一次性堵住。
 *
 * 缺口审计的四条(都是 medium,但合起来是同一种产品伤害:**用户不知道自己失败了**):
 *   · `DropZone`         上传抛错 → 指示器消失、组件恢复初始态,零提示
 *   · 项目详情页保存分镜  4xx/5xx → 弹框保持打开、loading 消失,零提示
 *   · 风格库保存         非 2xx → 弹框停留、spinner 消失,零提示
 *   · 模板克隆           非 2xx → 同上
 *
 * 关键取舍:**不各写各的**。仓里已有 `components/ui/toast-provider`(根 layout 里已挂),
 * 三个应用层组件直接接它;而 `DropZone` 是低层通用组件 —— `useToast` 在 Provider 外会抛错,
 * 给它自带内联错误 + 可选 `onError`,不引入 provider 依赖这个地雷。
 *
 * 顺带记一笔:`DropZone` 目前**生产零消费方**(全仓只有它自己)。修了不亏,但这属于
 * 「造好没接线」那一类,已记在缺口清单里,不在本版处理。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (p: string) => strip(fs.readFileSync(p, 'utf-8'));

const TOAST_SITES = [
  { file: 'components/create/style-lora-library.tsx', what: '风格库保存' },
  { file: 'components/create/template-library-picker.tsx', what: '模板克隆' },
  { file: 'app/projects/[id]/page.tsx', what: '保存分镜' },
];

describe('v12.300 · 三处应用层失败接现有 toast(不造第五套)', () => {
  for (const { file, what } of TOAST_SITES) {
    it(`${what}:失败时 showToast('error'),不是只有 console`, () => {
      const s = read(file);
      expect(s, '没接 toast').toContain('showToast(');
      expect(s).toMatch(/type:\s*'error'/);
      // hook 必须在组件内取到,否则运行时直接崩
      expect(s, '缺 useToast() 取值').toContain('const { showToast } = useToast()');
      expect(s).toMatch(/import \{ useToast \} from '@\/components\/ui\/toast-provider'/);
    });

    it(`${what}:提示里带上具体原因,而不是一句「失败了」`, () => {
      const s = read(file);
      const i = s.indexOf('showToast(');
      const call = s.slice(i, i + 300);
      expect(call).toContain('description');
      expect(call, '要么带服务端 error,要么带异常 message')
        .toMatch(/body\?\.error|body\.error|e instanceof Error/);
    });
  }

  it('用的是仓里既有的 toast,没有新造一套通知机制', () => {
    expect(fs.existsSync('components/ui/toast-provider.tsx')).toBe(true);
    // 根 layout 已挂 Provider —— 否则 useToast 会抛
    expect(fs.readFileSync('app/layout.tsx', 'utf-8')).toContain('<ToastProvider>');
  });
});

describe('v12.300 · DropZone 自带内联错误(低层组件不依赖 Provider)', () => {
  const s = read('components/ui/DropZone.tsx');

  it('失败时记下原因并渲染出来,而不是静默恢复初始态', () => {
    expect(s).toContain('setUploadError');
    expect(s).toContain('上传失败');
    expect(s).toMatch(/role="alert"/);
  });

  it('**不引入 useToast** —— 它在 Provider 外会抛,通用组件不该有这个地雷', () => {
    expect(s).not.toContain('useToast');
  });

  it('提供 onError 让外层可以接管(想走 toast 的话)', () => {
    expect(s).toContain('onError?: (error: unknown) => void');
    expect(s).toContain('onError?.(error)');
  });

  it('重试前清掉上次的错误(否则成功后仍挂着旧报错)', () => {
    const i = s.indexOf('setUploadError(null)');
    const j = s.indexOf('await onFilesAccepted(files)');
    expect(i, '未清理').toBeGreaterThan(0);
    expect(i, '必须在重试之前清').toBeLessThan(j);
  });

  it('错误态优先于「拖拽文件到这里」的空态文案', () => {
    const iErr = s.indexOf('uploadError ? (');
    const iIdle = s.indexOf('拖拽文件到这里');
    expect(iErr).toBeGreaterThan(0);
    expect(iErr).toBeLessThan(iIdle);
  });
});

/**
 * 门禁:防「第五处又只写 console」。
 *
 * 只扫本版点名的四个文件 —— 全仓扫会把大量合理的 console(纯日志、非用户动作)也拖进来,
 * 那种噪声大的门禁最后一定被关掉。新增此类交互时应把文件加进 WATCHED。
 */
describe('v12.300 · 这四处不得退回「只 console」', () => {
  const WATCHED = [...TOAST_SITES.map((t) => t.file), 'components/ui/DropZone.tsx'];

  it('哨兵:四个文件都在(路径改名时不能空跑变假绿)', () => {
    for (const f of WATCHED) expect(fs.existsSync(f), `${f} 不存在`).toBe(true);
    expect(WATCHED.length).toBe(4);
  });

  it('每个失败分支旁边都必须有用户可见的反馈', () => {
    const bad: string[] = [];
    for (const f of WATCHED) {
      const s = read(f);
      const hasUserFeedback = s.includes('showToast(') || s.includes('setUploadError');
      if (!hasUserFeedback) bad.push(f);
    }
    expect(bad, `这些文件的失败仍然只进 console:\n${bad.join('\n')}`).toEqual([]);
  });
});
