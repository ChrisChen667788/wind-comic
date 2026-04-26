'use client';

import { useHotkeys } from 'react-hotkeys-hook';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast-provider';
import { useProjectWorkspaceStore } from '@/lib/store';

/**
 * 全局工作区快捷键绑定。挂载在 CreationWorkspace 内，不渲染 UI。
 *
 *   Ctrl/Cmd + S  → 保存当前项目（触发 /api/projects/:id 持久化 — 实际已自动保存，这里只做确认提示）
 *   Ctrl/Cmd + Z  → 撤销最近一次节点数据修改（store.undo()，仅当 store 实现了撤销栈）
 *   Space         → 播放/暂停当前选中的视频（video-modal 监听全局 playRequested 事件）
 *   ?             → 弹出快捷键帮助
 */
export function WorkspaceHotkeys() {
  const { showToast } = useToast();
  const router = useRouter();
  const currentProject = useProjectWorkspaceStore(s => s.currentProject);

  // Ctrl/Cmd + S — 保存提示（自动保存已由 store 负责）
  useHotkeys('mod+s', (e) => {
    e.preventDefault();
    showToast({ title: '项目已自动保存', type: 'success', duration: 2000 });
  }, { enableOnFormTags: false });

  // Ctrl/Cmd + Z — 尝试撤销
  useHotkeys('mod+z', (e) => {
    e.preventDefault();
    const store: any = useProjectWorkspaceStore.getState();
    if (typeof store.undo === 'function') {
      store.undo();
      showToast({ title: '已撤销', type: 'info', duration: 1500 });
    } else {
      showToast({ title: '暂无可撤销操作', type: 'info', duration: 1500 });
    }
  }, { enableOnFormTags: false });

  // Space — 广播播放/暂停事件，由 VideoModal 等组件监听
  useHotkeys('space', (e) => {
    const target = e.target as HTMLElement | null;
    // 输入框里按空格不拦截
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('workspace:togglePlay'));
  }, { enableOnFormTags: false });

  // ? — 快捷键帮助
  useHotkeys('shift+/', (e) => {
    e.preventDefault();
    showToast({
      title: '快捷键',
      description: 'Ctrl/⌘+S 保存 · Ctrl/⌘+Z 撤销 · Space 播放 · ? 帮助',
      type: 'info', duration: 6000,
    });
  });

  // Ctrl/Cmd + E — 打开导出
  useHotkeys('mod+e', (e) => {
    e.preventDefault();
    if (!currentProject) return;
    window.open(`/api/projects/${currentProject.id}/export?type=mp4`, '_blank');
  }, { enableOnFormTags: false });

  // 无视 unused router — 预留后续"Ctrl+P 切换项目"等导航快捷键用
  void router;

  return null;
}
