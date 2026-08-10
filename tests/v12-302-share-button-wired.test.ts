/**
 * v12.302 — 创作工坊顶栏的「分享」是个**没有 onClick 的死按钮**。
 *
 * 它有 hover 高亮、看着完全正常,点下去毫无反应 —— 没有弹框、没有跳转、没有任何反馈。
 * 而这是**最核心的创作路径**上的按钮:用户会认为分享功能坏了,或这个项目不可分享。
 *
 * 查证时发现更值得记的一点:**这个能力仓里早就有,而且是完整可用的** ——
 * `components/project/invite-project-button.tsx`(建邀请 token、出链接、管协作者角色、
 * 配套 `POST /api/projects/[id]/invite` 与 `/project-invite/[token]` 落地页),
 * 只是**只有项目详情页在用,创作工坊这条主路径没接**。
 *
 * 所以修法是「接现成的」,不是「新造一套分享」—— 这正是本仓反复犯的
 * 「能力造好但没接线」,只不过这次的表现形式是一个空壳按钮。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const WS = strip(fs.readFileSync('components/creation-workspace.tsx', 'utf-8'));

describe('v12.302 · 死按钮换成真能力', () => {
  it('顶栏用的是既有的 InviteProjectButton,而不是自己画一个按钮', () => {
    expect(WS).toContain('<InviteProjectButton');
    expect(WS).toMatch(/import \{ InviteProjectButton \} from '@\/components\/project\/invite-project-button'/);
  });

  it('**不得再有没有 onClick 的「分享」按钮**(死按钮必须消失)', () => {
    // 原来那个是 <button ...>…<Share2/>分享</button>,没有任何 onClick
    const m = WS.match(/<button[^>]*>[\s\S]{0,200}?分享[\s\S]{0,40}?<\/button>/);
    expect(m, `仍存在裸的分享按钮:\n${m?.[0] ?? ''}`).toBeNull();
  });

  it('传了 projectId 与 isOwner(缺任一都会让邀请建不出来或权限判错)', () => {
    const i = WS.indexOf('<InviteProjectButton');
    const block = WS.slice(i, i + 260);
    expect(block).toContain('projectId={project.id}');
    expect(block).toMatch(/isOwner=\{/);
    expect(block, 'isOwner 必须真的比对当前用户').toContain('user.id');
  });

  it('拿到了 user(否则 isOwner 恒假,所有者也点不了)', () => {
    expect(WS).toContain('const { user } = useAuth()');
    expect(WS).toMatch(/import \{ useAuth \} from '@\/components\/auth-provider'/);
  });

  it('顺手清掉不再使用的 Share2 图标 import', () => {
    expect(fs.readFileSync('components/creation-workspace.tsx', 'utf-8')).not.toContain('Share2');
  });
});

describe('v12.302 · 接的确实是一条完整可用的链路', () => {
  it('邀请组件本体存在,且真的会去建 token', () => {
    const s = fs.readFileSync('components/project/invite-project-button.tsx', 'utf-8');
    expect(s).toContain('export function InviteProjectButton');
    expect(s).toMatch(/\/invite/);
  });

  it('后端建邀请与落地页两端都在(不是接了个半截功能)', () => {
    expect(fs.existsSync('app/api/projects/[id]/invite/route.ts')).toBe(true);
    expect(fs.existsSync('app/project-invite/[token]/page.tsx')).toBe(true);
    const api = fs.readFileSync('app/api/projects/[id]/invite/route.ts', 'utf-8');
    expect(api).toContain('export async function POST');
  });

  it('这条能力此前只有项目详情页在用 —— 记录下来,免得又被当成「没人用」删掉', () => {
    const detail = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(detail).toContain('<InviteProjectButton');
    // 现在至少两个消费方
    const users = ['app/projects/[id]/page.tsx', 'components/creation-workspace.tsx']
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('InviteProjectButton'));
    expect(users.length).toBe(2);
  });
});
