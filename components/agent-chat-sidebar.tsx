'use client';

/**
 * ProjectChatSidebar — 项目详情页右侧滑出的"AI 助手聊天侧栏"。
 *
 * 为什么独立做一个 (而不是复用 components/agent-chat.tsx):
 *   原 AgentChat 强依赖 useProjectWorkspaceStore 的 currentProject / chatMessages,
 *   是给 CreationWorkspace 节点画布用的。在项目详情页 /projects/[id] 上,
 *   store 里通常没有当前 project, 直接复用要么得改 store, 要么得做空 store fallback,
 *   不如独立一份只接 `projectId: string` 的瘦身版。
 *
 * 复用的部分:
 *   · 后端 /api/projects/[id]/chat 的 SSE 协议 (一致)
 *   · agent 角色枚举 (从 @/types/agents 直接 import)
 *   · 视觉语言 (相同的暗色 / 圆角风)
 *
 * 形态:
 *   · 右侧滑出 drawer, 宽 380px, 全高
 *   · 顶部 agent 切换 (默认 WRITER), 中间消息流, 底部输入
 *   · 关闭时不卸载, 只透明度 / 位移过渡, 保留对话上下文
 *
 * roadmap §3.2 "AI 助手侧栏改稿 — 后续 Sprint(chat 已支持,只缺 UI)" 这里就把它接上了。
 */

import { useEffect, useRef, useState } from 'react';
import { AgentRole } from '@/types/agents';
import {
  Send, X, Loader2, FileText, Users, Mountain, Film, Megaphone, Scissors,
  Clapperboard, Sparkles, MessageCircle, Trash2,
} from 'lucide-react';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

const AGENTS: Array<{ role: AgentRole; label: string; icon: any; color: string; hint: string }> = [
  { role: AgentRole.WRITER,            label: '编剧',     icon: FileText,    color: 'text-[#E8C547]',  hint: '剧本 · 对白' },
  { role: AgentRole.CHARACTER_DESIGNER,label: '角色设计', icon: Users,       color: 'text-amber-300',  hint: '人物 · 锁脸' },
  { role: AgentRole.SCENE_DESIGNER,    label: '场景设计', icon: Mountain,    color: 'text-emerald-300', hint: '场景 · 美术' },
  { role: AgentRole.STORYBOARD,        label: '分镜',     icon: Film,        color: 'text-sky-300',     hint: '镜头规划' },
  { role: AgentRole.DIRECTOR,          label: '导演',     icon: Megaphone,   color: 'text-[#E8C547]',  hint: '全局把控' },
  { role: AgentRole.EDITOR,            label: '剪辑',     icon: Scissors,    color: 'text-blue-300',   hint: '剪辑 · 配乐' },
  { role: AgentRole.PRODUCER,          label: '制片',     icon: Clapperboard,color: 'text-orange-300', hint: '审核 · 成片' },
];

export default function ProjectChatSidebar({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [agentRole, setAgentRole] = useState<AgentRole>(AgentRole.WRITER);
  // 每个 agent 维持自己的消息流, 用 Record 索引
  const [messagesMap, setMessagesMap] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = messagesMap[agentRole] || [];
  const cfg = AGENTS.find((a) => a.role === agentRole) || AGENTS[0];
  const Icon = cfg.icon;

  // 自动滚到底部 — 只在新消息或 agent 切换时
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, agentRole]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pushMsg = (role: AgentRole, msg: Msg) => {
    setMessagesMap((prev) => ({
      ...prev,
      [role]: [...(prev[role] || []), msg],
    }));
  };

  const updateLastAssistant = (role: AgentRole, content: string) => {
    setMessagesMap((prev) => {
      const arr = [...(prev[role] || [])];
      const lastIdx = arr.findLastIndex?.((m) => m.role === 'assistant')
        ?? arr.map((m) => m.role).lastIndexOf('assistant');
      if (lastIdx < 0) return prev;
      arr[lastIdx] = { ...arr[lastIdx], content };
      return { ...prev, [role]: arr };
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming || !projectId) return;

    const now = new Date().toISOString();
    pushMsg(agentRole, { id: `u-${Date.now()}`, role: 'user', content: text, at: now });
    setInput('');
    setStreaming(true);

    // 占位 assistant 消息, 流式更新它
    pushMsg(agentRole, { id: `a-${Date.now()}`, role: 'assistant', content: '', at: now });

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole, message: text }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content' && typeof data.content === 'string') {
              acc += data.content;
              updateLastAssistant(agentRole, acc);
            }
            // thinking / action 暂忽略, 后续可加 thinking 折叠
          } catch { /* malformed line, skip */ }
        }
      }

      if (!acc) {
        updateLastAssistant(agentRole, '_(无回应, 可能是后端配置缺 OPENAI_API_KEY)_');
      }
    } catch (e: any) {
      updateLastAssistant(agentRole, `❌ 出错了: ${e?.message || '未知错误'}`);
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearCurrent = () => {
    if (messages.length === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`清空与「${cfg.label}」的本地对话? (服务端历史不受影响)`)) return;
    setMessagesMap((prev) => ({ ...prev, [agentRole]: [] }));
  };

  return (
    <>
      {/* 背景遮罩 */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      {/* 抽屉 */}
      <aside
        className={`fixed top-0 right-0 z-50 h-screen w-[380px] max-w-[100vw] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col transform transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        role="dialog"
        aria-label="AI 助手侧栏"
      >
        {/* header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-black/30 flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-violet-300" />
          <div className="flex-1 leading-tight">
            <p className="text-sm font-semibold text-white">AI 助手</p>
            <p className="text-[10px] text-white/40">基于本项目上下文 · 与 {cfg.label} 对话</p>
          </div>
          <button
            onClick={handleClearCurrent}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
            title="清空本地视图(不影响服务端历史)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* agent 切换 */}
        <div className="shrink-0 px-2 py-2 border-b border-[var(--border)] bg-black/20 overflow-x-auto">
          <div className="flex gap-1.5 min-w-max">
            {AGENTS.map((a) => {
              const ActiveIcon = a.icon;
              const isActive = a.role === agentRole;
              return (
                <button
                  key={a.role}
                  onClick={() => setAgentRole(a.role)}
                  className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[11.5px] transition-all whitespace-nowrap border ${
                    isActive
                      ? 'bg-white/10 border-white/15 text-white'
                      : 'bg-transparent border-transparent text-white/55 hover:text-white/85 hover:bg-white/5'
                  }`}
                  title={a.hint}
                >
                  <ActiveIcon className={`w-3.5 h-3.5 ${a.color}`} />
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 py-8 text-center">
              <Icon className={`w-10 h-10 ${cfg.color} opacity-40`} />
              <p className="text-[12px] text-white/55">开始和「{cfg.label}」对话</p>
              <div className="text-[10.5px] text-white/35 leading-relaxed max-w-[260px]">
                这里的回复会基于该项目的剧本/角色/分镜上下文。试试:
                <br />
                <span className="text-white/45 italic">"把第 3 镜的对白改得更克制一点"</span>
                <br />
                <span className="text-white/45 italic">"林小满的服装该怎么定?"</span>
              </div>
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} agentColor={cfg.color} agentLabel={cfg.label} agentIcon={Icon} />)
          )}

          {streaming ? (
            <div className="flex items-center gap-2 text-[11px] text-white/45">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{cfg.label}思考中...</span>
            </div>
          ) : null}
        </div>

        {/* input */}
        <div className="shrink-0 border-t border-[var(--border)] p-3 bg-black/20">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={`Enter 发送 · Shift+Enter 换行`}
              className="flex-1 bg-black/30 border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-white placeholder:text-white/25 resize-none outline-none focus:border-violet-500/40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-rose-500 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all shrink-0"
              title="发送"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-white/30">
            服务端会保留最近 10 条对话作为上下文 · 切换 agent 是不同的话题线
          </p>
        </div>
      </aside>
    </>
  );
}

/** 项目详情页右下角的浮动入口按钮 (受控可见性, 默认渲染) */
export function ChatLauncherButton({
  open, onClick, hasUnread,
}: {
  open: boolean;
  onClick: () => void;
  hasUnread?: boolean;
}) {
  if (open) return null;
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-rose-500 text-white shadow-xl shadow-violet-500/30 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
      title="打开 AI 助手 (alt+/)"
      aria-label="打开 AI 助手聊天"
    >
      <MessageCircle className="w-5 h-5" />
      {hasUnread ? (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[var(--surface)]" />
      ) : null}
    </button>
  );
}

function Bubble({
  msg, agentColor, agentLabel, agentIcon: AIcon,
}: {
  msg: Msg;
  agentColor: string;
  agentLabel: string;
  agentIcon: any;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {isUser ? null : (
        <div className={`w-6 h-6 rounded-md bg-white/5 grid place-items-center shrink-0 ${agentColor}`}>
          <AIcon className="w-3 h-3" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? 'ml-auto' : ''}`}>
        {!isUser ? (
          <p className={`text-[10px] mb-0.5 ${agentColor}`}>{agentLabel}</p>
        ) : null}
        <div
          className={`rounded-xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-violet-500/15 border border-violet-500/25 text-violet-50'
              : 'bg-white/5 border border-white/8 text-white/80'
          }`}
        >
          {msg.content || <span className="text-white/30 italic">…</span>}
        </div>
      </div>
    </div>
  );
}
