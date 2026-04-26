'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ScriptNode } from '@/components/nodes/script-node';
import { CharacterNode } from '@/components/nodes/character-node';
import { SceneNode } from '@/components/nodes/scene-node';
import { StoryboardNode } from '@/components/nodes/storyboard-node';
import { VideoNode } from '@/components/nodes/video-node';
import { EditorNode } from '@/components/nodes/editor-node';
import { ReviewNode } from '@/components/nodes/review-node';
import { AgentRole, type PipelineNodeData, type ProjectAsset, type PipelineNodeStatus } from '@/types/agents';
import { useProjectWorkspaceStore } from '@/lib/store';

const nodeTypes: NodeTypes = {
  script: ScriptNode,
  character: CharacterNode,
  scene: SceneNode,
  storyboard: StoryboardNode,
  video: VideoNode,
  editor: EditorNode,
  review: ReviewNode,
};

// 数据流连线颜色（暖色调、漫画印刷风）
const EDGE_COLORS: Record<string, string> = {
  'e-writer-character': '#E8C547',
  'e-writer-scene': '#E8C547',
  'e-character-storyboard': '#D97706',
  'e-scene-storyboard': '#059669',
  'e-storyboard-video': '#4A7EBB',
  'e-video-editor': '#C8432A',
  'e-editor-producer': '#4A7EBB',
  // 导演监控线（金色统一）
  'e-director-writer': '#E8C547',
  'e-director-character': '#E8C547',
  'e-director-scene': '#E8C547',
  'e-director-storyboard': '#E8C547',
  'e-director-video': '#E8C547',
  'e-director-editor': '#E8C547',
};

// 连线样式计算
function getEdgeStyle(edgeId: string, sourceStatus: PipelineNodeStatus, targetStatus: PipelineNodeStatus, isDirectorEdge: boolean): Partial<Edge> {
  const color = EDGE_COLORS[edgeId] || '#7C3AED';

  // ═══ 导演监控线：优雅的虚线 ═══
  if (isDirectorEdge) {
    if (targetStatus === 'running') {
      return {
        animated: true,
        className: 'director-edge-active',
        style: {
          stroke: '#E8C547',
          strokeWidth: 1.5,
          strokeDasharray: '6 4',
          filter: 'drop-shadow(0 0 4px rgba(232,197,71,0.35))',
        },
      };
    }
    if (targetStatus === 'completed') {
      return {
        animated: false,
        className: 'director-edge-done',
        style: {
          stroke: '#E8C547',
          strokeWidth: 1,
          opacity: 0.2,
          strokeDasharray: '3 6',
        },
      };
    }
    return {
      animated: false,
      className: 'director-edge-idle',
      style: {
        stroke: '#E8C547',
        strokeWidth: 0.5,
        opacity: 0.06,
        strokeDasharray: '2 8',
      },
    };
  }

  // ═══ 数据流连线 ═══
  if (targetStatus === 'running') {
    return {
      animated: true,
      className: 'data-edge-active',
      style: { stroke: color, strokeWidth: 2, filter: `drop-shadow(0 0 4px ${color}50)` },
    };
  }
  if (sourceStatus === 'completed' && (targetStatus === 'completed' || targetStatus === 'reviewing')) {
    return {
      animated: false,
      className: 'data-edge-done',
      style: { stroke: color, strokeWidth: 2, opacity: 0.8 },
    };
  }
  if (sourceStatus === 'completed' && targetStatus === 'pending') {
    return {
      animated: false,
      style: { stroke: color, strokeWidth: 1.5, opacity: 0.3 },
    };
  }
  return {
    animated: false,
    style: { stroke: color, strokeWidth: 1, opacity: 0.1, strokeDasharray: '5 5' },
  };
}

// 初始节点布局
export function buildInitialNodes(assets: ProjectAsset[]): Node<PipelineNodeData>[] {
  const getAssets = (type: string) => assets.filter(a => a.type === type);

  return [
    {
      id: 'node-director',
      type: 'review',
      position: { x: 850, y: -300 },
      data: {
        id: 'node-director',
        agentRole: AgentRole.DIRECTOR,
        label: '导演',
        status: 'pending',
        progress: 0,
        assets: [],
        isDirector: true,
      } as any,
    },
    {
      id: 'node-writer',
      type: 'script',
      position: { x: 0, y: 0 },
      data: { id: 'node-writer', agentRole: AgentRole.WRITER, label: '编剧', status: 'pending', progress: 0, assets: [...getAssets('script'), ...getAssets('character')] },
    },
    {
      id: 'node-character',
      type: 'character',
      position: { x: 480, y: -120 },
      data: { id: 'node-character', agentRole: AgentRole.CHARACTER_DESIGNER, label: '角色设计', status: 'pending', progress: 0, assets: getAssets('character') },
    },
    {
      id: 'node-scene',
      type: 'scene',
      position: { x: 480, y: 220 },
      data: { id: 'node-scene', agentRole: AgentRole.SCENE_DESIGNER, label: '场景设计', status: 'pending', progress: 0, assets: getAssets('scene') },
    },
    {
      id: 'node-storyboard',
      type: 'storyboard',
      position: { x: 960, y: 0 },
      data: { id: 'node-storyboard', agentRole: AgentRole.STORYBOARD, label: '分镜', status: 'pending', progress: 0, assets: getAssets('storyboard') },
    },
    {
      id: 'node-video',
      type: 'video',
      position: { x: 1440, y: 0 },
      data: { id: 'node-video', agentRole: AgentRole.VIDEO_PRODUCER, label: '视频生成', status: 'pending', progress: 0, assets: getAssets('video') },
    },
    {
      id: 'node-editor',
      type: 'editor',
      position: { x: 1920, y: 0 },
      data: { id: 'node-editor', agentRole: AgentRole.EDITOR, label: '剪辑师', status: 'pending', progress: 0, assets: [] },
    },
    {
      id: 'node-producer',
      type: 'review',
      position: { x: 2400, y: 0 },
      data: { id: 'node-producer', agentRole: AgentRole.PRODUCER, label: '制片人', status: 'pending', progress: 0, assets: [] },
    },
  ];
}

const EDGE_DEFS = [
  { id: 'e-writer-character', source: 'node-writer', target: 'node-character', isDirector: false },
  { id: 'e-writer-scene', source: 'node-writer', target: 'node-scene', isDirector: false },
  { id: 'e-character-storyboard', source: 'node-character', target: 'node-storyboard', isDirector: false },
  { id: 'e-scene-storyboard', source: 'node-scene', target: 'node-storyboard', isDirector: false },
  { id: 'e-storyboard-video', source: 'node-storyboard', target: 'node-video', isDirector: false },
  { id: 'e-video-editor', source: 'node-video', target: 'node-editor', isDirector: false },
  { id: 'e-editor-producer', source: 'node-editor', target: 'node-producer', isDirector: false },
  { id: 'e-director-writer', source: 'node-director', target: 'node-writer', isDirector: true },
  { id: 'e-director-character', source: 'node-director', target: 'node-character', isDirector: true },
  { id: 'e-director-scene', source: 'node-director', target: 'node-scene', isDirector: true },
  { id: 'e-director-storyboard', source: 'node-director', target: 'node-storyboard', isDirector: true },
  { id: 'e-director-video', source: 'node-director', target: 'node-video', isDirector: true },
  { id: 'e-director-editor', source: 'node-director', target: 'node-editor', isDirector: true },
];

export const initialEdges: Edge[] = EDGE_DEFS.map(e => ({
  id: e.id,
  source: e.source,
  target: e.target,
  animated: false,
  style: {
    stroke: EDGE_COLORS[e.id] || '#7C3AED',
    strokeWidth: e.isDirector ? 0.5 : 1,
    opacity: e.isDirector ? 0.06 : 0.1,
    strokeDasharray: e.isDirector ? '2 8' : '5 5',
  },
}));

function buildEdges(nodes: Node<PipelineNodeData>[]): Edge[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n.data]));

  return EDGE_DEFS.map(e => {
    const sourceData = nodeMap.get(e.source);
    const targetData = nodeMap.get(e.target);
    const sourceStatus = (sourceData?.status || 'pending') as PipelineNodeStatus;
    const targetStatus = (targetData?.status || 'pending') as PipelineNodeStatus;
    const edgeStyle = getEdgeStyle(e.id, sourceStatus, targetStatus, e.isDirector);

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.isDirector ? 'smoothstep' : 'default',
      ...edgeStyle,
    };
  });
}

export function PipelineCanvas() {
  const storeNodes = useProjectWorkspaceStore(s => s.nodes);
  const assets = useProjectWorkspaceStore(s => s.assets);
  const setActiveAgent = useProjectWorkspaceStore(s => s.setActiveAgent);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PipelineNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (storeNodes.length === 0) return;
    setNodes(prev => {
      const posMap = new Map(prev.map(n => [n.id, n.position]));
      return storeNodes.map(sn => ({
        ...sn,
        position: posMap.get(sn.id) || sn.position,
      }));
    });
  }, [storeNodes, setNodes]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const newEdges = buildEdges(nodes as Node<PipelineNodeData>[]);
    setEdges(newEdges);
  }, [nodes, setEdges]);

  const setStoreNodes = useProjectWorkspaceStore(s => s.setNodes);
  const onNodeDragStop = useCallback(() => {
    setStoreNodes(nodes as Node<PipelineNodeData>[]);
  }, [nodes, setStoreNodes]);

  const onNodeClick = useCallback((_event: any, node: Node<PipelineNodeData>) => {
    if (node.data.agentRole) {
      setActiveAgent(node.data.agentRole);
    }
  }, [setActiveAgent]);

  return (
    <div className="w-full h-full pipeline-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={0.8}
          color="rgba(255,255,255,0.03)"
        />
        <Controls
          className="!bg-[#141414]/90 !backdrop-blur-xl !border-white/[0.06] !rounded-lg !shadow-xl [&>button]:!bg-transparent [&>button]:!border-white/[0.06] [&>button]:!text-white/50 [&>button:hover]:!bg-white/[0.06] [&>button:hover]:!text-white/80"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-[#141414]/90 !backdrop-blur-xl !border-white/[0.06] !rounded-lg !shadow-xl"
          nodeColor={(node) => {
            const data = node.data as PipelineNodeData;
            if (data?.status === 'running') return '#10B981';
            if (data?.status === 'completed') return '#3B82F6';
            if (data?.status === 'error') return '#EF4444';
            return '#374151';
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      <style jsx global>{`
        /* ═══ 数据流连线动画 ═══ */
        .pipeline-canvas .react-flow__edge.animated path {
          animation: flowDash 1.2s linear infinite;
        }
        .pipeline-canvas .react-flow__edge.data-edge-active path {
          animation: flowDash 0.8s linear infinite, dataEdgePulse 2.5s ease-in-out infinite;
        }
        .pipeline-canvas .react-flow__edge.data-edge-done path {
          transition: all 0.6s ease;
        }

        /* ═══ 导演监控连线动画 ═══ */
        .pipeline-canvas .react-flow__edge.director-edge-active path {
          animation: directorFlowDash 1.8s linear infinite, directorPulse 3s ease-in-out infinite;
        }
        .pipeline-canvas .react-flow__edge.director-edge-done path {
          animation: directorBreath 5s ease-in-out infinite;
        }
        .pipeline-canvas .react-flow__edge.director-edge-idle path {
          transition: all 0.8s ease;
        }

        @keyframes flowDash {
          to { stroke-dashoffset: -20; }
        }
        @keyframes directorFlowDash {
          to { stroke-dashoffset: -20; }
        }
        @keyframes directorPulse {
          0%, 100% {
            filter: drop-shadow(0 0 2px rgba(232,197,71,0.2));
            stroke-width: 1.5;
          }
          50% {
            filter: drop-shadow(0 0 6px rgba(232,197,71,0.4));
            stroke-width: 2;
          }
        }
        @keyframes directorBreath {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.3; }
        }
        @keyframes dataEdgePulse {
          0%, 100% { filter: drop-shadow(0 0 3px currentColor); }
          50% { filter: drop-shadow(0 0 8px currentColor); }
        }

        /* ═══ 节点优化 ═══ */
        .pipeline-canvas .react-flow__node {
          transition: filter 0.3s ease, transform 0.2s ease;
        }
        .pipeline-canvas .react-flow__node:hover {
          filter: brightness(1.04);
        }
      `}</style>
    </div>
  );
}
