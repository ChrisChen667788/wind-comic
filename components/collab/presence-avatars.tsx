'use client';

/**
 * v3.0 P0.2 — PresenceAvatars: "现在谁在看这个项目".
 *
 * 走 Yjs awareness:
 *   - 本地 setLocalStateField('user', {id, name, avatarUrl, color})
 *   - 接收 awareness change → 列出所有 state.user
 *   - 用户离开 (close tab / network) → 30s 后 awareness 自动 timeout, 头像消失
 *
 * 显示规则:
 *   - 最多 5 个头像并排, 超出显示 "+N"
 *   - 自己用蓝边框标识
 *   - hover 显示名字
 */

import { useEffect, useState } from 'react';
import { useYjs } from '@/hooks/use-yjs';

interface PresenceUser {
  clientId: number;
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  /** v3.1.3 P3: 用户当前所在 tab (script/characters/.../comments). 未设时 undefined. */
  activeTab?: string;
}

const AVATAR_COLORS = [
  '#E8C547', '#4DE0C2', '#F472B6', '#A78BFA',
  '#FB7185', '#34D399', '#60A5FA', '#FBBF24',
];

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface PresenceAvatarsProps {
  projectId: string;
  currentUser: { id: string; name: string; avatarUrl: string | null };
  /** v3.1.3 P3: 当前用户激活的 tab key — 写入 awareness 让别人看到 */
  activeTab?: string;
  maxVisible?: number;
}

const TAB_LABEL: Record<string, string> = {
  script: '剧本',
  characters: '角色',
  scenes: '场景',
  storyboard: '分镜',
  videos: '视频',
  workshop: '镜头工坊',
  pacing: '节奏',
  comments: '评论',
  play: '完整播放',
  timeline: '时间线',
};

export function PresenceAvatars({ projectId, currentUser, activeTab, maxVisible = 5 }: PresenceAvatarsProps) {
  const yjs = useYjs(`project-${projectId}`);
  const [users, setUsers] = useState<PresenceUser[]>([]);

  // 设本地状态
  useEffect(() => {
    if (!yjs) return;
    const aw = yjs.provider.awareness;
    aw.setLocalStateField('user', {
      id: currentUser.id,
      name: currentUser.name,
      avatarUrl: currentUser.avatarUrl,
      color: pickColor(currentUser.id),
    });
    return () => {
      // unmount 时清掉自己 (避免幽灵头像挂 30s)
      aw.setLocalState(null);
    };
  }, [yjs, currentUser.id, currentUser.name, currentUser.avatarUrl]);

  // v3.1.3 P3: 切 tab 时更新 awareness — 别人看到"alice 在 镜头工坊"
  useEffect(() => {
    if (!yjs || !activeTab) return;
    const aw = yjs.provider.awareness;
    aw.setLocalStateField('activeTab', activeTab);
  }, [yjs, activeTab]);

  // 监听 awareness 变化
  useEffect(() => {
    if (!yjs) return;
    const aw = yjs.provider.awareness;
    const onChange = () => {
      const states = Array.from(aw.getStates().entries());
      const arr: PresenceUser[] = [];
      for (const [clientId, state] of states) {
        const user = (state as any)?.user;
        if (!user || !user.id) continue;
        const tabFromState = (state as any)?.activeTab;
        arr.push({
          clientId,
          id: String(user.id),
          name: String(user.name || '匿名'),
          avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
          color: String(user.color || '#999'),
          activeTab: typeof tabFromState === 'string' ? tabFromState : undefined,
        });
      }
      // 同一 user 多端 (例如多 tab) 都算 1 个 — 按 id dedupe
      const seen = new Set<string>();
      const dedupe: PresenceUser[] = [];
      for (const u of arr) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        dedupe.push(u);
      }
      setUsers(dedupe);
    };
    aw.on('change', onChange);
    onChange();
    return () => aw.off('change', onChange);
  }, [yjs]);

  if (users.length === 0) return null;
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center -space-x-2" title={`${users.length} 人在线`}>
      {visible.map((u) => {
        const isSelf = u.id === currentUser.id;
        const tabLabel = u.activeTab ? TAB_LABEL[u.activeTab] || u.activeTab : null;
        const tooltip = isSelf
          ? `${u.name} (你)${tabLabel ? ` · ${tabLabel}` : ''}`
          : `${u.name}${tabLabel ? ` · 在 ${tabLabel}` : ''}`;
        return (
          <div key={u.clientId} className="relative">
            <div
              className={`w-7 h-7 rounded-full border-2 grid place-items-center overflow-hidden ${
                isSelf ? 'border-[var(--cinema-amber)]' : 'border-[var(--cinema-surface)]'
              }`}
              style={{ background: u.color }}
              title={tooltip}
            >
              {u.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img loading="lazy" decoding="async" src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
              ) : (
                <span className="cinema-mono text-[10px] font-bold text-black">
                  {u.name.slice(0, 1)}
                </span>
              )}
            </div>
            {/* v3.1.3 P3: 头像底下 mini tab chip 显示对方在哪 — 自己不显示 */}
            {!isSelf && tabLabel && (
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 cinema-mono text-[8px] px-1 py-0.5 rounded whitespace-nowrap pointer-events-none"
                style={{ background: u.color, color: '#000' }}
              >
                {tabLabel}
              </div>
            )}
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className="w-7 h-7 rounded-full border-2 border-[var(--cinema-surface)] bg-black/60 grid place-items-center cinema-mono text-[10px]"
          title={`还有 ${overflow} 人`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
