'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentRole, type ChatMessage } from '@/types/agents';
import { useProjectWorkspaceStore } from '@/lib/store';
import { AgentAvatar } from '@/components/mascot';
import {
  Send, ChevronDown, ChevronUp, Loader2,
  FileText, Users, Mountain, Film, Video, Eye, Scissors,
  ImageIcon, Paperclip, Clapperboard, Megaphone
} from 'lucide-react';

const AGENT_CONFIG: Record<string, { label: string; icon: any; color: string; desc: string; avatar: string }> = {
  [AgentRole.WRITER]: { label: '编剧', icon: FileText, color: 'text-[#E8C547]', desc: '剧本 · 对白 · 世界观', avatar: '/avatars/beaver-happy.jpg' },
  [AgentRole.CHARACTER_DESIGNER]: { label: '角色设计', icon: Users, color: 'text-amber-400', desc: '角色资产 · 多视角', avatar: '/avatars/beaver-happy.jpg' },
  [AgentRole.SCENE_DESIGNER]: { label: '场景设计', icon: Mountain, color: 'text-emerald-400', desc: '场景概念图', avatar: '/avatars/frog-3d.jpg' },
  [AgentRole.STORYBOARD]: { label: '分镜', icon: Film, color: 'text-[#4A7EBB]', desc: '分镜 · 镜头规划', avatar: '/avatars/beaver-crown.jpg' },
  [AgentRole.VIDEO_PRODUCER]: { label: '视频制作', icon: Video, color: 'text-[#C8432A]', desc: '逐段视频', avatar: '/avatars/frog-cartoon.jpg' },
  [AgentRole.DIRECTOR]: { label: '导演', icon: Megaphone, color: 'text-[#E8C547]', desc: '全局监控 · 协调', avatar: '/avatars/beaver-crown.jpg' },
  [AgentRole.EDITOR]: { label: '剪辑师', icon: Scissors, color: 'text-[#4A7EBB]', desc: '剪辑 · 配乐 · 合成', avatar: '/avatars/beaver-sleepy.jpg' },
  [AgentRole.PRODUCER]: { label: '制片人', icon: Clapperboard, color: 'text-orange-400', desc: '质量审核 · 成片', avatar: '/avatars/frog-cartoon.jpg' },
};

export function AgentChat() {
  const {
    chatMessages, activeAgent, setActiveAgent, addChatMessage,
    currentProject, isProducing,
  } = useProjectWorkspaceStore();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = chatMessages[activeAgent] || [];
  const agentCfg = AGENT_CONFIG[activeAgent] || AGENT_CONFIG[AgentRole.WRITER];
  const AgentIcon = agentCfg.icon;

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const projectId = currentProject?.id;
    if (!projectId) return;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      projectId,
      agentRole: activeAgent,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    addChatMessage(activeAgent, userMsg);
    setInput('');
    setIsStreaming(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole: activeAgent, message: text }),
      });

      if (!response.ok) throw new Error('请求失败');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('无法读取响应流');

      let assistantContent = '';
      let thinkingContent = '';
      const assistantMsgId = `msg-${Date.now()}-assistant`;

      // 先添加空的 assistant 消息
      addChatMessage(activeAgent, {
        id: assistantMsgId,
        projectId,
        agentRole: activeAgent,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'thinking') {
              thinkingContent += data.content || '';
            } else if (data.type === 'content') {
              assistantContent += data.content || '';
            } else if (data.type === 'action') {
              // Agent 执行了操作（如重生成分镜）
              // 由 store 的其他 listener 处理
            }
          } catch { /* skip malformed */ }
        }

        // 更新 assistant 消息（通过替换最后一条）
        const currentMsgs = useProjectWorkspaceStore.getState().chatMessages[activeAgent] || [];
        const updated = currentMsgs.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: assistantContent, thinking: thinkingContent || undefined }
            : m
        );
        useProjectWorkspaceStore.getState().setChatMessages(activeAgent, updated);
      }
    } catch (error) {
      addChatMessage(activeAgent, {
        id: `msg-${Date.now()}-error`,
        projectId,
        agentRole: activeAgent,
        role: 'assistant',
        content: `出错了: ${error instanceof Error ? error.message : '未知错误'}`,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, activeAgent, currentProject, addChatMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0C0C0C]/90 backdrop-blur-xl">
      {/* Header: Agent 选择 */}
      <div className="shrink-0 border-b border-white/[0.04]">
        <button
          onClick={() => setShowAgentPicker(!showAgentPicker)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
        >
          <AgentAvatar role={activeAgent} size={32} />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-white">{agentCfg.label}</div>
            <div className="text-[10px] text-gray-500">{agentCfg.desc}</div>
          </div>
          {showAgentPicker ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>

        {/* Agent 选择下拉 */}
        <AnimatePresence>
          {showAgentPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-white/[0.04]"
            >
              <div className="p-2 grid grid-cols-2 gap-1">
                {Object.entries(AGENT_CONFIG).map(([role, cfg]) => {
                  const Icon = cfg.icon;
                  const isActive = role === activeAgent;
                  return (
                    <button
                      key={role}
                      onClick={() => { setActiveAgent(role as AgentRole); setShowAgentPicker(false); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${
                        isActive ? 'bg-white/[0.07] border border-white/[0.08]' : 'hover:bg-white/[0.03] border border-transparent'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                      <span className="text-xs text-white">{cfg.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-500 text-xs">
            和{agentCfg.label}开始对话...
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} agentConfig={agentCfg} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{agentCfg.label}正在思考...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/[0.04] p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              rows={2}
              className="w-full bg-transparent px-3 py-2.5 text-[13px] text-white placeholder:text-white/20 resize-none outline-none"
            />
            <div className="flex items-center gap-1 px-2 pb-1.5">
              <button className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors" title="上传图片">
                <ImageIcon className="w-3.5 h-3.5 text-white/20" />
              </button>
              <button className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors" title="附件">
                <Paperclip className="w-3.5 h-3.5 text-white/20" />
              </button>
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-2.5 rounded-lg bg-[#E8C547] text-[#0C0C0C] disabled:opacity-20 hover:bg-[#F0CE55] transition-all shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// 消息气泡
function MessageBubble({ message, agentConfig }: { message: ChatMessage; agentConfig: { label: string; icon: any; color: string } }) {
  const [showThinking, setShowThinking] = useState(false);
  const isUser = message.role === 'user';
  const AgentIcon = agentConfig.icon;

  const timestamp = new Date(message.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      {!isUser && (
        <div className={`w-7 h-7 rounded-lg bg-white/5 grid place-items-center shrink-0 ${agentConfig.color}`}>
          <AgentIcon className="w-3.5 h-3.5" />
        </div>
      )}

      <div className={`max-w-[85%] ${isUser ? 'ml-auto' : ''}`}>
        {/* Agent name */}
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[11px] font-medium ${agentConfig.color}`}>{agentConfig.label}</span>
            <span className="text-[10px] text-gray-500">{timestamp}</span>
          </div>
        )}

        {/* Content */}
        <div className={`rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? 'bg-[#E8C547]/08 border border-[#E8C547]/12 text-[var(--text)]'
            : 'bg-white/[0.03] border border-white/[0.04] text-white/75'
        }`}>
          {message.content || <span className="text-gray-500">...</span>}
          {isUser && <div className="text-[10px] text-gray-400 mt-1.5 opacity-60">{timestamp}</div>}
        </div>

        {/* Thinking 折叠 */}
        {!isUser && message.thinking && (
          <div className="mt-1.5">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
            >
              {showThinking ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              展示思考过程
            </button>
            <AnimatePresence>
              {showThinking && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1 p-2.5 bg-black/20 border border-white/5 rounded-xl text-[11px] text-gray-400 leading-relaxed">
                    {message.thinking}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
