'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentWorkspace } from '@/components/AgentWorkspace';
import { ConsistencyPanel } from '@/components/ConsistencyPanel';
import { CameoScoreBadge, type CameoScoreBadgeData } from '@/components/CameoScoreBadge';
import { useAgentStore } from '@/lib/store';
import { Sparkles, ArrowLeft, Wand2, Zap, Lightbulb, CheckCircle2, UserCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { validateIdea, sanitizeInput } from '@/lib/validation';
import { useToast } from '@/components/ui/toast-provider';

export default function CreatePage() {
  const [idea, setIdea] = useState('');
  const [videoProvider, setVideoProvider] = useState('minimax');
  const [isCreating, setIsCreating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  // v2.9 P0 Cameo: 主角脸参考图(可选,提交时作为 dataURI 一起发给后端)
  const [cameoFile, setCameoFile] = useState<File | null>(null);
  const [cameoPreview, setCameoPreview] = useState<string>('');
  // v2.11 #2: 试穿评分(vision LLM),上传后立刻给用户"这张脸能不能锁死"的反馈
  const [cameoScoreLoading, setCameoScoreLoading] = useState(false);
  const [cameoScoreError, setCameoScoreError] = useState<string | null>(null);
  const [cameoScoreData, setCameoScoreData] = useState<CameoScoreBadgeData | null>(null);
  const { agents, setAgents } = useAgentStore();
  // v2.11 #1: 连续性状态追踪
  const addConsistencyEvent = useAgentStore((s) => s.addConsistencyEvent);
  const setTotalShots = useAgentStore((s) => s.setTotalShots);
  const resetConsistency = useAgentStore((s) => s.resetConsistency);
  const router = useRouter();
  const { showToast } = useToast();

  const handleCameoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast({ title: '只能上传图片文件', type: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ title: '图片太大(上限 10MB)', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setCameoFile(file);
      setCameoPreview(dataUri);
      // v2.11 #2: 提交前就跑一次评分,让用户在按"开始创作"之前就能看到适配度
      runCameoPreviewScore(dataUri);
    };
    reader.readAsDataURL(file);
  };

  const clearCameo = () => {
    setCameoFile(null);
    setCameoPreview('');
    setCameoScoreData(null);
    setCameoScoreError(null);
    setCameoScoreLoading(false);
  };

  /** v2.11 #2: 用 dataURI 打分,不落盘不阻塞主流程 */
  const runCameoPreviewScore = async (imageUrl: string) => {
    setCameoScoreLoading(true);
    setCameoScoreError(null);
    setCameoScoreData(null);
    try {
      const res = await fetch('/api/cameo/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.status === 503) {
        setCameoScoreError('vision 服务暂未启用');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCameoScoreError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setCameoScoreData(data);
      if (data.verdict === 'poor') {
        showToast({
          title: `照片评分偏低 (${data.score}),建议优化后再锁脸`,
          type: 'warning',
        });
      }
    } catch (e) {
      setCameoScoreError(e instanceof Error ? e.message : '评分失败');
    } finally {
      setCameoScoreLoading(false);
    }
  };

  const handleSubmit = async () => {
    // 验证输入
    const validation = validateIdea(idea);
    if (!validation.valid) {
      showToast({ title: validation.error || '输入无效', type: 'error' });
      return;
    }

    // 清理输入
    const sanitizedIdea = sanitizeInput(idea);

    setIsCreating(true);
    setStatusMessage('正在连接 AI 团队...');
    resetConsistency();  // v2.11 #1: 新 run 前清掉上次的连续性统计

    try {
      const response = await fetch('/api/create-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idea: sanitizedIdea,
          videoProvider,
          // v2.9 P0 Cameo: 如果用户上传了主角脸,以 data URI 形式发给后端
          // 后端会 persistAsset 落盘并写入 projects.primary_character_ref
          primaryCharacterRef: cameoPreview || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('创作失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'agents':
                  setAgents(data.data);
                  break;
                case 'status':
                  setStatusMessage(data.data.message);
                  break;
                // v2.11 #1: 连续性事件
                case 'consistencyStatus':
                  addConsistencyEvent({
                    shotNumber: data.data.shotNumber,
                    type: data.data.type,
                    fromShot: data.data.fromShot,
                    at: Date.now(),
                  });
                  break;
                case 'runMeta':
                  if (typeof data.data?.totalShots === 'number') {
                    setTotalShots(data.data.totalShots);
                  }
                  break;
                case 'complete':
                  setResult(data.data);
                  setStatusMessage('创作完成！');
                  setTimeout(() => {
                    // 可以跳转到结果页面
                    // router.push('/projects/new');
                  }, 2000);
                  break;
                case 'error':
                  throw new Error(data.data.message);
              }
            } catch (e) {
              console.error('解析 SSE 数据失败:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('创作错误:', error);
      setStatusMessage('创作失败，请重试');
      alert(error instanceof Error ? error.message : '创作失败，请重试');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* 导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#E8C547] to-[#D4A830] rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold">AI 漫剧工作室</span>
            </Link>

            <Link
              href="/"
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>返回首页</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        {!isCreating && !result ? (
          <div className="container mx-auto max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {/* 标题区域 */}
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#E8C547]/10 border border-[#E8C547]/20 rounded-full text-sm">
                  <Wand2 className="w-4 h-4 text-[#E8C547]" />
                  <span className="text-[#D4A830]">AI 创作工作台</span>
                </div>

                <h1 className="text-5xl font-bold">
                  <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                    开始你的创作之旅
                  </span>
                </h1>

                <p className="text-gray-400 text-lg">
                  描述你的故事创意，AI 团队将为你打造完整的漫剧作品
                </p>
              </div>

              {/* 创作表单 */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
                <div className="space-y-6">
                  {/* 创意输入 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                      故事创意
                    </label>
                    <textarea
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      placeholder={"支持两种输入方式：\n\n方式一：简短创意（50-500字）\n例如：一个关于时间旅行者的爱情故事，主角是一位物理学家...\n\n方式二：完整剧本（直接粘贴）\n支持标准剧本格式：场景标头、角色对白、△画面描述等，系统将自动解析并忠实改编"}
                      className="w-full min-h-[200px] bg-black/50 border border-white/10 rounded-2xl p-6 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E8C547]/50 focus:border-[#E8C547]/50 transition-all resize-y"
                      rows={12}
                    />
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className={`${idea.length > 500 ? 'text-[#E8C547]' : 'text-gray-500'}`}>
                        {idea.length} 字符 {idea.length > 500 ? '(剧本模式)' : ''}
                      </span>
                      <span className="text-gray-500">
                        简短创意 50-500 字 / 完整剧本可达 100000 字
                      </span>
                    </div>
                  </div>

                  {/* v2.9 P0 Cameo: 主角脸上传(可选)*/}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                        <UserCircle2 className="w-4 h-4 text-[#E8C547]" />
                        主角脸参考图（可选）
                        <span className="px-2 py-0.5 bg-[#E8C547]/10 text-[#E8C547] text-xs rounded-full">Cameo 锁脸</span>
                      </label>
                      <span className="text-xs text-gray-500">上传后全片所有镜头锁定同一张脸</span>
                    </div>
                    {!cameoPreview ? (
                      <label className="block border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-[#E8C547]/50 hover:bg-white/5 transition-all">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCameoSelect}
                          className="hidden"
                        />
                        <UserCircle2 className="w-10 h-10 mx-auto mb-2 text-gray-500" />
                        <div className="text-sm text-gray-400">
                          点击上传主角脸照片（JPG / PNG，≤10MB）
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          不上传也可以 — 系统会自动生成一个锁定的形象
                        </div>
                      </label>
                    ) : (
                      <div>
                        <div className="relative inline-flex items-center gap-4 bg-white/5 border border-[#E8C547]/30 rounded-xl p-4 w-full">
                          <img
                            src={cameoPreview}
                            alt="主角脸预览"
                            className="w-20 h-20 rounded-lg object-cover border border-white/10"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-[#E8C547]">✓ 已锁定主角脸</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {cameoFile?.name} · {cameoFile ? (cameoFile.size / 1024).toFixed(0) : 0} KB
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={clearCameo}
                            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                            aria-label="清除主角脸"
                          >
                            <X className="w-4 h-4 text-gray-400" />
                          </button>
                        </div>
                        {/* v2.11 #2: Cameo 试穿评分 —— 按开始创作前就能看到 */}
                        <CameoScoreBadge
                          loading={cameoScoreLoading}
                          error={cameoScoreError}
                          data={cameoScoreData}
                        />
                      </div>
                    )}
                  </div>

                  {/* 视频引擎选择 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                      视频生成引擎
                    </label>
                    <div className="grid grid-cols-3 gap-4">
                      <button
                        onClick={() => setVideoProvider('minimax')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          videoProvider === 'minimax'
                            ? 'border-[#E8C547] bg-[#E8C547]/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="text-center">
                          <Zap className={`w-6 h-6 mx-auto mb-2 ${
                            videoProvider === 'minimax' ? 'text-[#E8C547]' : 'text-gray-400'
                          }`} />
                          <div className="font-semibold mb-1">Minimax</div>
                          <div className="text-xs text-gray-400">速度快</div>
                        </div>
                      </button>

                      <button
                        onClick={() => setVideoProvider('vidu')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          videoProvider === 'vidu'
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="text-center">
                          <Sparkles className={`w-6 h-6 mx-auto mb-2 ${
                            videoProvider === 'vidu' ? 'text-blue-400' : 'text-gray-400'
                          }`} />
                          <div className="font-semibold mb-1">Vidu</div>
                          <div className="text-xs text-gray-400">质量高</div>
                        </div>
                      </button>

                      <button
                        onClick={() => setVideoProvider('keling')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          videoProvider === 'keling'
                            ? 'border-orange-500 bg-orange-500/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="text-center">
                          <Lightbulb className={`w-6 h-6 mx-auto mb-2 ${
                            videoProvider === 'keling' ? 'text-orange-400' : 'text-gray-400'
                          }`} />
                          <div className="font-semibold mb-1">可灵 AI</div>
                          <div className="text-xs text-gray-400">中文好</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* 提交按钮 */}
                  <button
                    onClick={handleSubmit}
                    disabled={!idea.trim()}
                    className="w-full h-14 bg-gradient-to-r from-[#E8C547] to-[#D4A830] rounded-xl font-semibold text-lg hover:shadow-2xl hover:shadow-[#E8C547]/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all flex items-center justify-center gap-2"
                  >
                    <Wand2 className="w-5 h-5" />
                    开始创作
                  </button>
                </div>
              </div>

              {/* 示例创意 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Lightbulb className="w-4 h-4" />
                  <span>试试这些创意灵感</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {exampleIdeas.map((example, i) => (
                    <button
                      key={i}
                      onClick={() => setIdea(example.content)}
                      className="group p-4 bg-white/5 border border-white/10 rounded-xl hover:border-[#E8C547]/50 hover:bg-white/10 transition-all text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-[#E8C547]/15 to-[#D4A830]/15 rounded-lg flex items-center justify-center flex-shrink-0">
                          <example.icon className="w-5 h-5 text-[#E8C547]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium mb-1 group-hover:text-[#E8C547] transition-colors">
                            {example.title}
                          </div>
                          <div className="text-sm text-gray-400 line-clamp-2">
                            {example.content}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        ) : result ? (
          <div className="container mx-auto max-w-4xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-8"
            >
              <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-12 h-12 text-white" />
              </div>

              <div>
                <h2 className="text-4xl font-bold mb-4">
                  <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                    创作完成！
                  </span>
                </h2>
                <p className="text-xl text-gray-400">
                  你的 AI 漫剧已经准备好了
                </p>
              </div>

              <div className="flex items-center justify-center gap-4">
                <Link
                  href="/projects/1"
                  className="px-8 py-4 bg-gradient-to-r from-[#E8C547] to-[#D4A830] rounded-full font-semibold text-lg hover:shadow-2xl hover:shadow-[#E8C547]/40 transition-all"
                >
                  查看作品
                </Link>
                <Link
                  href="/create"
                  className="px-8 py-4 bg-white/5 border border-white/10 rounded-full font-semibold text-lg hover:bg-white/10 transition-all"
                >
                  创作新作品
                </Link>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="container mx-auto max-w-6xl">
            <div className="mb-8 text-center space-y-4">
              <h2 className="text-3xl font-bold">
                <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  AI 团队正在为你创作
                </span>
              </h2>
              <p className="text-gray-400">
                {statusMessage}
              </p>
            </div>

            {/* v2.11 #1: 连续性监控面板 —— 实时显示"锁了几张脸 + 接了几条镜头线" */}
            <div className="mb-6 max-w-md mx-auto">
              <ConsistencyPanel />
            </div>

            <AgentWorkspace agents={agents} />
          </div>
        )}
      </main>
    </div>
  );
}

const exampleIdeas = [
  {
    title: '赛博朋克侦探',
    content: '2077年的新东京，一位赛博侦探接到神秘委托，调查连环失踪案，却发现背后隐藏着惊天阴谋',
    icon: Zap
  },
  {
    title: '古代宫廷',
    content: '大唐盛世，一位才女入宫，凭借智慧在后宫中周旋，最终成为影响朝政的关键人物',
    icon: Sparkles
  },
  {
    title: '末日废土',
    content: '核战后的世界，幸存者们在废墟中寻找希望，一个神秘信号指引他们前往传说中的避难所',
    icon: Wand2
  },
  {
    title: '魔法学院',
    content: '魔法学院新生入学，发现自己拥有罕见��魔法天赋，却也因此卷入了一场古老的魔法战争',
    icon: Lightbulb
  }
];
