import {
  IMG_LENS_BOX, IMG_RHYTHM, IMG_STYLE_GRID,
  IMG_AGENT_DIRECTOR, IMG_AGENT_STORYBOARD, IMG_AGENT_MOTION, IMG_AGENT_EDITOR,
  IMG_VIBE_FOREST, IMG_VIBE_NEON,
} from './placeholder-images';

/**
 * Homepage data source — v2.11 对齐版。
 *
 * 之前首页挂的是"12 协作智能体 / 240 镜头 / 镜头盒 / 节奏谱"这类没落地的营销文案,
 * 和实际产品能力脱节。本轮全量改成真实可点到的能力:
 *   - heroStats: 真实 Agent 数量(8 个,见 types/agents.ts AgentRole 枚举)
 *   - featureHighlights: v2.9 Cameo 锁脸 / v2.10 Keyframes 衔接 / v2.11 Writer-Editor 自进化
 *   - agentCards: 真实的中文 Agent 角色名(导演/编剧/角色/剪辑)
 */

export const heroStats = [
  { value: '8', label: '协作智能体' },      // Director/Writer/Character/Scene/Storyboard/VideoProducer/Editor/Producer
  { value: '7', label: '视频引擎' },         // seedance2/kling3/viduq3/veo31lite/minimax/vidu/kling (+ Sora cameo)
  { value: '3', label: '一致性守护' },       // Cameo 锁脸 / Keyframes 衔接 / Writer-Editor 闭环
];

export const featureHighlights = [
  {
    title: 'Cameo 主角锁脸',
    desc: '上传一张人脸, Sora 2 Cameo 全片保持同一个人, 跨镜不漂移',
    image: IMG_LENS_BOX,
  },
  {
    title: 'Keyframes 镜头衔接',
    desc: 'Luma Ray 3 首尾帧 + Seedance 多参考, 上一镜末帧 = 下一镜首帧',
    image: IMG_RHYTHM,
  },
  {
    title: 'Writer-Editor 自进化闭环',
    desc: '成片后 Editor 打分, Writer 下一轮针对弱项自动改写, 越练越准',
    image: IMG_STYLE_GRID,
  },
];

export const agentCards = [
  { title: 'AI 导演', desc: '总控节奏 · 审核返工 · McKee 11 维人设', image: IMG_AGENT_DIRECTOR },
  { title: 'AI 编剧', desc: '剧本结构 · 对白打磨 · 依 Editor 反馈自我迭代', image: IMG_AGENT_STORYBOARD },
  { title: 'AI 角色设计 / 分镜', desc: '角色视觉锚点 · 分镜拆解 · 跨镜动作钩子', image: IMG_AGENT_MOTION },
  { title: 'AI 剪辑 / 制片', desc: '成片拼接 · 三维评分(连贯/光影/脸) · 最终审核', image: IMG_AGENT_EDITOR },
];

export const vibeShots = [
  { title: '雾森晨光', image: IMG_VIBE_FOREST },
  { title: '霓虹夜航', image: IMG_VIBE_NEON },
];
