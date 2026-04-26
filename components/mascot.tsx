'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 吐槽词条库
const QUIPS = {
  waiting: [
    '太慢了吧...我都快睡着了💤',
    '进度条：我尽力了😭',
    '做完你的做你的，我先摸鱼🐟',
    '等一个亿年...不是，等一分钟',
    '我去泡杯咖啡先☕',
    '这进度条是不是卡住了🤔',
    '别急别急，好饭不怕晚🍚',
    '摸鱼时间到！🐠',
    '我数到三，进度条你给我动！',
    '在？说句话？进度条？',
  ],
  working: [
    '嘿嘿，正在努力中~💪',
    '别催别催，艺术需要时间🎨',
    '这波操作有点东西👀',
    'AI们正在疯狂输出中...',
    '创作灵感爆发！✨',
    '各位数字员工辛苦了~',
  ],
  completed: [
    '搞定！我就说我行吧✌️',
    '这波操作我给满分💯',
    '又是完美的一天~🌟',
    '大功告成！鼓掌👏',
    '这效果，绝了！🔥',
    '完美收工，下班下班~',
  ],
  error: [
    '啊这...翻车了🚗',
    '别慌，让我想想🤔',
    '重来重来，当无事发生',
    '出了点小状况，稳住！',
    '这个锅我不背😤',
  ],
};

type MascotMood = 'idle' | 'waiting' | 'working' | 'completed' | 'error';

interface Props {
  mood?: MascotMood;
  className?: string;
}

export function Mascot({ mood = 'idle', className = '' }: Props) {
  const [quip, setQuip] = useState('');
  const [showQuip, setShowQuip] = useState(false);

  // 根据 mood 定期弹出吐槽
  useEffect(() => {
    if (mood === 'idle') { setShowQuip(false); return; }

    const pool = QUIPS[mood] || QUIPS.waiting;
    setQuip(pool[Math.floor(Math.random() * pool.length)]);
    setShowQuip(true);

    const interval = setInterval(() => {
      setQuip(pool[Math.floor(Math.random() * pool.length)]);
      setShowQuip(true);
      setTimeout(() => setShowQuip(false), 4000);
    }, mood === 'waiting' ? 15000 : 20000);

    return () => clearInterval(interval);
  }, [mood]);

  const moodColors = {
    idle: '#a78bfa',
    waiting: '#fbbf24',
    working: '#34d399',
    completed: '#3b82f6',
    error: '#ef4444',
  };

  const color = moodColors[mood];

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}>
      {/* 吐槽气泡 - ★ 2026-04 改向上弹出（避免被下方的 OverallProgressBar 遮挡） */}
      <AnimatePresence>
        {showQuip && quip && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.9 }}
            className="absolute bottom-[calc(100%+12px)] left-1/2 -translate-x-1/2 whitespace-nowrap px-4 py-2 rounded-2xl bg-gradient-to-br from-[#E8C547] to-[#D4A830] border-2 border-white/30 text-xs font-medium text-white shadow-2xl z-[100] pointer-events-none"
            style={{
              boxShadow: '0 8px 32px rgba(232, 197, 71, 0.4), 0 0 0 3px rgba(255, 255, 255, 0.1)',
            }}
          >
            {quip}
            {/* 小三角 - 指向下方吉祥物 */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-gradient-to-br from-[#E8C547] to-[#D4A830] border-r-2 border-b-2 border-white/30 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 吉祥物 - 熊形象 */}
      <motion.div
        animate={mood === 'working' ? { rotate: [0, -5, 5, -5, 0] } : mood === 'waiting' ? { y: [0, -3, 0] } : {}}
        transition={{ repeat: Infinity, duration: mood === 'working' ? 0.8 : 2.5 }}
        className="cursor-pointer relative"
        onClick={() => {
          const pool = QUIPS[mood === 'idle' ? 'working' : mood] || QUIPS.working;
          setQuip(pool[Math.floor(Math.random() * pool.length)]);
          setShowQuip(true);
          setTimeout(() => setShowQuip(false), 3000);
        }}
      >
        <img src="/mascot-bear.svg" alt="mascot" width={44} height={44} className="rounded-xl" />
        {/* 心情指示环 */}
        <div
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0d0e14]"
          style={{ backgroundColor: color }}
        />
      </motion.div>
    </div>
  );
}

// ── Agent 头像 ──
const AGENT_AVATAR_MAP: Record<string, string> = {
  director: '/avatars/beaver-crown.jpg',       // 戴皇冠的河狸 → 导演
  writer: '/avatars/beaver-happy.jpg',          // 开心河狸 → 编剧
  character_designer: '/avatars/frog-3d.jpg',   // 3D青蛙 → 角色设计师
  scene_designer: '/avatars/beaver-sleepy.jpg', // 困困河狸 → 场景设计师
  storyboard: '/avatars/frog-cartoon.jpg',      // 卡通青蛙 → 分镜师
  video_producer: '/avatars/frog-3d.jpg',       // 3D青蛙 → 视频制作
  editor: '/avatars/beaver-crown.jpg',          // 戴皇冠河狸 → 剪辑师
};

export function AgentAvatar({ role, size = 32 }: { role: string; size?: number }) {
  const src = AGENT_AVATAR_MAP[role] || '/avatars/beaver-happy.jpg';

  return (
    <div
      className="rounded-full overflow-hidden shrink-0 border-2 border-white/10"
      style={{ width: size, height: size }}
    >
      <img src={src} alt={role} className="w-full h-full object-cover" />
    </div>
  );
}
