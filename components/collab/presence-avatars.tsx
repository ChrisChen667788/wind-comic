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
  maxVisible?: number;
}

export function PresenceAvatars({ projectId, currentUser, maxVisible = 5 }: PresenceAvatarsProps) {
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
        arr.push({
          clientId,
          id: String(user.id),
          name: String(user.name || '匿名'),
          avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
          color: String(user.color || '#999'),
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
        return (
          <div
            key={u.clientId}
            className={`w-7 h-7 rounded-full border-2 grid place-items-center overflow-hidden ${
              isSelf ? 'border-[var(--cinema-amber)]' : 'border-[var(--cinema-surface)]'
            }`}
            style={{ background: u.color }}
            title={isSelf ? `${u.name} (你)` : u.name}
          >
            {u.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
            ) : (
              <span className="cinema-mono text-[10px] font-bold text-black">
                {u.name.slice(0, 1)}
              </span>
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
