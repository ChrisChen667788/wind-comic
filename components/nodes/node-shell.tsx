'use client';

import { useState } from 'react';
import type { PipelineNodeStatus, AgentRole } from '@/types/agents';
import { CheckCircle, Check, MessageSquare, RefreshCw, X, Loader2 } from 'lucide-react';
import { useProjectWorkspaceStore } from '@/lib/store';
import { AnimatePresence, motion } from 'framer-motion';

interface Props {
  status: PipelineNodeStatus;
  color: string;
  children: React.ReactNode;
  className?: string;
  agentRole?: AgentRole; // 用于确认时关联角色
}

const COLOR_MAP: Record<string, { glow: string; border: string; bg: string; accent: string }> = {
  purple: { glow: 'shadow-[0_0_16px_rgba(232,197,71,0.25)]', border: 'border-[#E8C547]/40', bg: 'from-[#E8C547]/06', accent: '#E8C547' },
  amber: { glow: 'shadow-[0_0_16px_rgba(245,158,11,0.25)]', border: 'border-amber-500/40', bg: 'from-amber-500/06', accent: '#F59E0B' },
  emerald: { glow: 'shadow-[0_0_16px_rgba(16,185,129,0.25)]', border: 'border-emerald-500/40', bg: 'from-emerald-500/06', accent: '#10B981' },
  cyan: { glow: 'shadow-[0_0_16px_rgba(74,126,187,0.25)]', border: 'border-[#4A7EBB]/40', bg: 'from-[#4A7EBB]/06', accent: '#4A7EBB' },
  pink: { glow: 'shadow-[0_0_16px_rgba(200,67,42,0.25)]', border: 'border-[#C8432A]/40', bg: 'from-[#C8432A]/06', accent: '#C8432A' },
  orange: { glow: 'shadow-[0_0_16px_rgba(249,115,22,0.25)]', border: 'border-orange-500/40', bg: 'from-orange-500/06', accent: '#F97316' },
  blue: { glow: 'shadow-[0_0_16px_rgba(74,126,187,0.25)]', border: 'border-[#4A7EBB]/40', bg: 'from-[#4A7EBB]/06', accent: '#4A7EBB' },
};

export function NodeShell({ status, color, children, className = '', agentRole }: Props) {
  const c = COLOR_MAP[color] || COLOR_MAP.purple;
  const [confirmed, setConfirmed] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenMessage, setRegenMessage] = useState('');
  const confirmNodeAssets = useProjectWorkspaceStore(s => s.confirmNodeAssets);

  const statusClasses = (() => {
    switch (status) {
      case 'running':
        return `${c.border} ${c.glow} animate-pulse-slow bg-gradient-to-br ${c.bg} to-transparent`;
      case 'completed':
        return confirmed
          ? 'border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)] bg-gradient-to-br from-emerald-500/4 to-transparent'
          : 'border-[var(--border-hover)] shadow-[0_0_10px_rgba(74,126,187,0.1)] bg-gradient-to-br from-[#4A7EBB]/3 to-transparent';
      case 'reviewing':
        return `${c.border} ${c.glow} bg-gradient-to-br ${c.bg} to-transparent`;
      case 'error':
        return 'border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)] bg-gradient-to-br from-red-500/4 to-transparent';
      default:
        return 'border-[var(--border)] opacity-50';
    }
  })();

  const handleConfirm = async () => {
    if (agentRole) {
      confirmNodeAssets(agentRole);
    }
    setConfirmed(true);

    try {
      const s = useProjectWorkspaceStore.getState();
      const projectId = s.currentProject?.id;
      if (projectId && agentRole) {
        const roleAssets = s.assets.filter(a => a.confirmed);
        await fetch('/api/assets/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, agentRole, assets: roleAssets }),
        }).catch(() => {});
      }
    } catch {}
  };

  const handleRegenerate = async () => {
    if (!feedback.trim() || isRegenerating) return;

    setIsRegenerating(true);
    setRegenMessage('');

    try {
      const s = useProjectWorkspaceStore.getState();
      const projectId = s.currentProject?.id;

      if (!projectId || !agentRole) {
        setRegenMessage('无法获取项目信息');
        return;
      }

      const res = await fetch(`/api/projects/${projectId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole, feedback: feedback.trim() }),
      });

      const data = await res.json();
      setRegenMessage(data.message || '已提交修改意见');
      setFeedback('');
      setShowFeedback(false);
    } catch {
      setRegenMessage('提交失败，请重试');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className={`
      bg-[#141414]/95 backdrop-blur-2xl border-[1.5px] rounded-lg p-4 shadow-xl
      transition-all duration-500 ease-out
      ${statusClasses} ${className}
    `}>
      {children}

      {/* 确认按钮 + 微调区域 */}
      {status === 'completed' && agentRole && (
        <div className="mt-3 pt-2.5 border-t border-[var(--border)]">
          {confirmed ? (
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-emerald-400/80">
              <CheckCircle className="w-3 h-3" />
              已确认
            </div>
          ) : (
            <button
              onClick={handleConfirm}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#E8C547]/10 text-[#E8C547]/80 text-[10px] font-medium hover:bg-[#E8C547]/18 transition-colors"
            >
              <Check className="w-3 h-3" />
              确认保存
            </button>
          )}

          {/* 微调按钮 */}
          {!showFeedback && (
            <button
              onClick={() => setShowFeedback(true)}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#E8C547]/06 text-[#E8C547]/60 text-[10px] font-medium hover:bg-[#E8C547]/12 hover:text-[#E8C547]/80 transition-colors"
            >
              <MessageSquare className="w-3 h-3" />
              微调
            </button>
          )}

          {/* 反馈面板 */}
          <AnimatePresence>
            {showFeedback && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 space-y-1.5">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="输入修改意见..."
                    className="w-full bg-black/30 border border-[#E8C547]/20 rounded-md px-2.5 py-1.5 text-[10px] text-gray-300 placeholder:text-gray-600 resize-none max-h-[60px] custom-scrollbar focus:outline-none focus:border-[#E8C547]/40 transition-colors"
                    rows={2}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleRegenerate}
                      disabled={!feedback.trim() || isRegenerating}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-[#E8C547]/10 text-[#E8C547] text-[10px] font-medium hover:bg-[#E8C547]/18 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isRegenerating ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      重新生成
                    </button>
                    <button
                      onClick={() => {
                        setShowFeedback(false);
                        setFeedback('');
                        setRegenMessage('');
                      }}
                      className="px-2 py-1.5 rounded-md bg-white/5 text-gray-400 text-[10px] hover:bg-white/10 hover:text-gray-300 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 重新生成状态消息 */}
          <AnimatePresence>
            {regenMessage && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="mt-1.5 text-center text-[10px] text-[#E8C547]/70"
              >
                {regenMessage}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <style jsx global>{`
        @keyframes pulse-slow {
          0%, 100% { box-shadow: 0 0 8px rgba(232,197,71,0.1); }
          50% { box-shadow: 0 0 20px rgba(232,197,71,0.25); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
