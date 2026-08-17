/**
 * v12.327 — 审计透镜②:**一句类型断言抹掉了信任边界**。
 *
 * ── 怎么找到的 ────────────────────────────────────────────────────
 * 全仓有 406 处 `as any`、615 处 `: any` —— 一把梭清理既不现实也没价值。
 * 有价值的是**挑出那些骑在信任边界上的断言**,所以只看信号最强的两类:
 * `as unknown as`(TS 拒绝直接转换才会写的双重断言,23 处)和唯一那个 `@ts-ignore`。
 * 其中绝大多数是惯用写法(`webkitAudioContext` 兼容、React Flow 的 `PipelineNodeData`、
 * ffmpeg-static 的类型与实际导出不符)。真正有问题的是这一处。
 *
 * ── 病象:不是「类型不整齐」,是冒名与篡改 ────────────────────────
 * `components/collab/comment-thread.tsx` 里:
 *   const all = arr.toArray() as unknown as FetchedComment[];
 *   byId.set(yc.id, { ...byId.get(yc.id), ...yc });     // Yjs 版整体覆盖服务端版
 *
 * `arr` 是 **Yjs 共享数组**。Yjs 是 CRDT,**没有逐字段权限** —— 项目内任何协作者
 * 都能往里写任意对象。于是:
 *   ① 推一个带**已存在 id** 的对象 → 覆盖掉服务端那条评论的 `authorName` /
 *      `content`,在**所有人**的界面上把别人的话改掉、或让一段话看起来是别人写的;
 *   ② `content` 推成对象 → React 渲染抛错,整条评论区挂掉;
 *   ③ 缺 `id` → `byId.set(undefined, …)`,排序键 `createdAt` 也不存在。
 *
 * 那句 `as unknown as` 告诉读代码的人「这些是评论」,而它们其实是网络对端提供的
 * 任意数据 —— **断言把「不可信」这件事藏掉了**,这才是它的真正代价。
 *
 * ── 修法:分清「新增」与「更新」 ──────────────────────────────────
 * Yjs 在这里的正当用途只有两个(`broadcastNewComment` / `broadcastDeleteComment`
 * 也只做这两件事):别人刚发的新评论、软删标记。所以:
 *   · id 已存在 → 只接受可变字段白名单(deletedAt/updatedAt),作者/正文/时间
 *     一律以服务端为准;
 *   · id 是新的 → 必须整体过校验才收。
 * 实时性一点没丢,攻击面没了。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { sanitizeYjsComment, mergeYjsComments, type MinimalComment } from '@/lib/comment-merge';

const server = (over: Partial<MinimalComment> = {}): MinimalComment => ({
  id: 'c1', targetType: 'shot', targetId: '3',
  authorUserId: 'u-alice', authorName: '爱丽丝', content: '这一镜的构图偏了',
  createdAt: '2026-08-01T10:00:00Z', deletedAt: null, ...over,
});
const acceptAll = () => true;

describe('v12.327 · 冒名与篡改(本版核心)', () => {
  it('**已存在的评论,作者名不可被 Yjs 覆盖**', () => {
    const prev = [server()];
    const forged = { ...server(), authorName: '鲍勃', authorUserId: 'u-bob' };
    const [merged] = mergeYjsComments(prev, [forged], acceptAll);
    expect(merged.authorName, '别人能改掉这条评论的署名').toBe('爱丽丝');
    expect(merged.authorUserId).toBe('u-alice');
  });

  it('**已存在的评论,正文不可被 Yjs 覆盖**', () => {
    const prev = [server()];
    const tampered = { ...server(), content: '我觉得这镜很完美' };
    const [merged] = mergeYjsComments(prev, [tampered], acceptAll);
    expect(merged.content, '别人能改掉这条评论的内容').toBe('这一镜的构图偏了');
  });

  it('createdAt 也不可被覆盖(否则能把一条评论挪到时间线任意位置)', () => {
    const prev = [server()];
    const [merged] = mergeYjsComments(prev, [{ ...server(), createdAt: '1999-01-01T00:00:00Z' }], acceptAll);
    expect(merged.createdAt).toBe('2026-08-01T10:00:00Z');
  });

  it('**但软删要照常生效** —— 修安全不能把功能修没了', () => {
    const prev = [server()];
    const del = { ...server(), deletedAt: '2026-08-02T00:00:00Z' };
    const [merged] = mergeYjsComments(prev, [del], acceptAll);
    expect(merged.deletedAt, '删除同步失效了').toBe('2026-08-02T00:00:00Z');
    expect(merged.content, '删除不该顺带改内容').toBe('这一镜的构图偏了');
  });

  it('**别人刚发的新评论照常实时出现**(新 id 走完整校验后接受)', () => {
    const fresh = server({ id: 'c2', authorUserId: 'u-bob', authorName: '鲍勃', content: '同意', createdAt: '2026-08-01T10:05:00Z' });
    const out = mergeYjsComments([server()], [fresh], acceptAll);
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(out[1].authorName).toBe('鲍勃');
  });
});

describe('v12.327 · 校验:任意对象不再被当成评论', () => {
  it('必填字段缺失/类型不对 → 丢弃', () => {
    for (const bad of [
      null, undefined, 42, 'str', [], {},
      { ...server(), id: undefined },
      { ...server(), id: 123 },
      { ...server(), authorName: null },
      { ...server(), content: { evil: true } },      // ← 会让 React 渲染抛错的那种
      { ...server(), createdAt: '' },
      { ...server(), deletedAt: 5 },
    ]) {
      expect(sanitizeYjsComment(bad as unknown), `不该接受: ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('合法的照常通过;空正文允许(带附件的评论)', () => {
    expect(sanitizeYjsComment(server())).not.toBeNull();
    expect(sanitizeYjsComment(server({ content: '' })), '带附件无文字的评论被误杀').not.toBeNull();
  });

  it('脏数据不会污染列表,也不会把好数据带崩', () => {
    const out = mergeYjsComments([server()], [null, 'x', { id: 1 }, server({ id: 'c9', createdAt: '2026-08-01T11:00:00Z' })], acceptAll);
    expect(out.map((c) => c.id)).toEqual(['c1', 'c9']);
  });

  it('只收当前线程的(targetType/targetId 过滤仍生效)', () => {
    const other = server({ id: 'c3', targetId: '99' });
    const out = mergeYjsComments([server()], [other], (c) => c.targetId === '3');
    expect(out.map((c) => c.id)).toEqual(['c1']);
  });

  it('按 createdAt 升序(排序行为未被改坏)', () => {
    const out = mergeYjsComments(
      [server({ id: 'b', createdAt: '2026-08-01T12:00:00Z' })],
      [server({ id: 'a', createdAt: '2026-08-01T09:00:00Z' })],
      acceptAll,
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('v12.327 · 接线与留痕', () => {
  const TSX = fs.readFileSync('components/collab/comment-thread.tsx', 'utf-8');

  it('组件改用了 mergeYjsComments', () => {
    expect(TSX).toContain('mergeYjsComments');
  });

  it('**那句整体覆盖的写法已消失**', () => {
    const code = TSX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '仍在用 Yjs 版整体覆盖服务端版').not.toMatch(/\.\.\.byId\.get\([^)]*\),\s*\.\.\.yc/);
    expect(code, '仍把 Yjs 数组直接断言成评论数组').not.toMatch(/as unknown as FetchedComment\[\]/);
  });

  it('病因写在代码里(否则后人只会看到一次「多余的」校验)', () => {
    expect(TSX).toMatch(/CRDT|任何协作者/);
    expect(TSX).toMatch(/作者名|篡改|冒名/);
  });

  it('白名单是显式的,新增可变字段必须有意识地加', () => {
    const lib = fs.readFileSync('lib/comment-merge.ts', 'utf-8');
    expect(lib).toMatch(/MUTABLE_FROM_YJS/);
    expect(lib).toMatch(/deletedAt/);
  });
});
