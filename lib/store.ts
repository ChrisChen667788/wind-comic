import { create } from 'zustand';
import {
  Agent, AgentRole, ChatMessage, ProjectAsset,
  PipelineNodeData, DirectorReview, Project, Script
} from '@/types/agents';
import type { Node, Edge } from '@xyflow/react';

// ── 原有 Agent Store（保留兼容） ──
// v2.11 #1: 新增 consistency 切片,追踪 Cameo / Keyframe / 全局锚点的逐 shot 应用状态
export type ConsistencyEventType =
  | 'cameoApplied'         // v2.9 P0 Cameo: 主角脸锁在了本 shot
  | 'keyframeChained'      // v2.9 P1 Keyframes: 本 shot 用了上一 shot 末帧
  | 'globalAnchorSet'      // v2.11 #3: 刷新全局风格锚点(首次 or drift correction)
  | 'globalAnchorApplied'; // v2.11 #3: 本 shot 引用了全局锚点

export interface ConsistencyEvent {
  shotNumber: number;
  type: ConsistencyEventType;
  fromShot?: number;  // keyframeChained 专用,来自哪个 shot 的末帧
  at: number;         // 收到事件的时间戳
}

interface AgentStore {
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;
  updateAgent: (role: AgentRole, updates: Partial<Agent>) => void;
  resetAgents: () => void;

  // ── v2.11 #1: 连续性状态追踪 ──
  consistencyEvents: ConsistencyEvent[];
  /** 本次 run 一共有多少个 shot(创作初期 orchestrator 报出来时写入),用于算 X/N 比例 */
  totalShots: number;
  addConsistencyEvent: (ev: ConsistencyEvent) => void;
  setTotalShots: (n: number) => void;
  resetConsistency: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  setAgents: (agents) => set({ agents }),
  updateAgent: (role, updates) => set((state) => ({
    agents: state.agents.map((agent) =>
      agent.role === role ? { ...agent, ...updates } : agent
    ),
  })),
  resetAgents: () => set({ agents: [] }),

  consistencyEvents: [],
  totalShots: 0,
  addConsistencyEvent: (ev) => set((state) => {
    // 去重:同 shot 同 type 只保留最新一条
    const filtered = state.consistencyEvents.filter(
      (e) => !(e.shotNumber === ev.shotNumber && e.type === ev.type),
    );
    return { consistencyEvents: [...filtered, ev] };
  }),
  setTotalShots: (n) => set({ totalShots: n }),
  resetConsistency: () => set({ consistencyEvents: [], totalShots: 0 }),
}));

// ── 新增：项目工作台 Store ──
interface ProjectWorkspaceStore {
  // 当前项目
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;

  // React Flow 节点/边
  nodes: Node<PipelineNodeData>[];
  edges: Edge[];
  setNodes: (nodes: Node<PipelineNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodeData: (nodeId: string, data: Partial<PipelineNodeData>) => void;

  // 项目资产
  assets: ProjectAsset[];
  setAssets: (assets: ProjectAsset[]) => void;
  updateAsset: (assetId: string, updates: Partial<ProjectAsset>) => void;
  addAsset: (asset: ProjectAsset) => void;
  confirmAsset: (assetId: string) => void;
  confirmNodeAssets: (agentRole: AgentRole) => void;

  // Agent 对话
  chatMessages: Record<string, ChatMessage[]>; // key = AgentRole
  activeAgent: AgentRole;
  setActiveAgent: (role: AgentRole) => void;
  addChatMessage: (role: AgentRole, message: ChatMessage) => void;
  setChatMessages: (role: AgentRole, messages: ChatMessage[]) => void;

  // 导演审核
  directorReview: DirectorReview | null;
  setDirectorReview: (review: DirectorReview | null) => void;
  reviewHistory: DirectorReview[];
  addReviewToHistory: (review: DirectorReview) => void;

  // 创作状态
  isProducing: boolean;
  setIsProducing: (v: boolean) => void;

  // 重置
  resetWorkspace: () => void;
}

export const useProjectWorkspaceStore = create<ProjectWorkspaceStore>((set) => ({
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),

  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  updateNodeData: (nodeId, data) => set((state) => ({
    nodes: state.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    ),
  })),

  assets: [],
  setAssets: (assets) => set({ assets }),
  updateAsset: (assetId, updates) => set((state) => ({
    assets: state.assets.map((a) =>
      a.id === assetId ? { ...a, ...updates } : a
    ),
  })),
  addAsset: (asset) => set((state) => ({ assets: [...state.assets, asset] })),
  confirmAsset: (assetId) => set((state) => ({
    assets: state.assets.map(a => a.id === assetId ? { ...a, confirmed: true } : a),
  })),
  confirmNodeAssets: (agentRole) => {
    const roleTypeMap: Record<string, string[]> = {
      [AgentRole.WRITER]: ['script'],
      [AgentRole.CHARACTER_DESIGNER]: ['character'],
      [AgentRole.SCENE_DESIGNER]: ['scene'],
      [AgentRole.STORYBOARD]: ['storyboard'],
      [AgentRole.VIDEO_PRODUCER]: ['video'],
      [AgentRole.EDITOR]: ['timeline', 'final_video', 'music'],
      [AgentRole.PRODUCER]: ['final_video'],
    };
    const types = roleTypeMap[agentRole] || [];
    set((state) => ({
      assets: state.assets.map(a => types.includes(a.type) ? { ...a, confirmed: true } : a),
    }));
  },

  chatMessages: {},
  activeAgent: AgentRole.WRITER,
  setActiveAgent: (role) => set({ activeAgent: role }),
  addChatMessage: (role, message) => set((state) => ({
    chatMessages: {
      ...state.chatMessages,
      [role]: [...(state.chatMessages[role] || []), message],
    },
  })),
  setChatMessages: (role, messages) => set((state) => ({
    chatMessages: { ...state.chatMessages, [role]: messages },
  })),

  directorReview: null,
  setDirectorReview: (review) => set({ directorReview: review }),
  reviewHistory: [],
  addReviewToHistory: (review) => set((state) => ({ reviewHistory: [...state.reviewHistory, review] })),

  isProducing: false,
  setIsProducing: (v) => set({ isProducing: v }),

  resetWorkspace: () => set({
    currentProject: null,
    nodes: [],
    edges: [],
    assets: [],
    chatMessages: {},
    activeAgent: AgentRole.WRITER,
    directorReview: null,
    reviewHistory: [],
    isProducing: false,
  }),
}));
