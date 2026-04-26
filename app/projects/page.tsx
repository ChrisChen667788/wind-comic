'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Sparkles, Plus, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { ProjectSearch } from '@/components/project-search';

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // 模拟项目数据
  const mockProjects = [
    {
      id: '1',
      title: '赛博朋克侦探',
      synopsis: '2077年的新东京，一位赛博侦探接到神秘委托...',
      coverImage: '/placeholder/project1.jpg',
      status: 'completed',
      createdAt: '2024-03-20',
      shots: 8
    },
    {
      id: '2',
      title: '古代宫廷',
      synopsis: '大唐盛世，一位才女入宫，凭借智慧在后宫中周旋...',
      coverImage: '/placeholder/project2.jpg',
      status: 'creating',
      createdAt: '2024-03-21',
      shots: 6
    },
    {
      id: '3',
      title: '末日废土',
      synopsis: '核战后的世界，幸存者们在废墟中寻找希望...',
      coverImage: '/placeholder/project3.jpg',
      status: 'completed',
      createdAt: '2024-03-19',
      shots: 10
    }
  ];

  // 筛选和搜索逻辑
  const filteredProjects = useMemo(() => {
    return mockProjects.filter((project) => {
      // 状态筛选
      if (statusFilter !== 'all' && project.status !== statusFilter) {
        return false;
      }

      // 搜索筛选
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          project.title.toLowerCase().includes(query) ||
          project.synopsis.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [searchQuery, statusFilter]);

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
              href="/create"
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#E8C547] to-[#D4A830] rounded-full font-medium hover:shadow-lg hover:shadow-[#E8C547]/40 transition-all"
            >
              <Plus className="w-5 h-5" />
              <span>新建项目</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="container mx-auto max-w-7xl">
          {/* 标题区域 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1 className="text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                我的项目
              </span>
            </h1>
            <p className="text-xl text-gray-400">
              管理你的所有 AI 漫剧创作
            </p>
          </motion.div>

          {/* 搜索和筛选 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <ProjectSearch
              onSearch={setSearchQuery}
              onFilterChange={setStatusFilter}
              currentFilter={statusFilter}
            />
          </motion.div>

          {/* 项目网格 */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Link href={`/projects/${project.id}`}>
                  <div className="group bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-[#E8C547]/50 transition-all cursor-pointer">
                    {/* 封面图 */}
                    <div className="aspect-video bg-gradient-to-br from-[#E8C547]/15 to-[#D4A830]/15 flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <Sparkles className="w-16 h-16 text-gray-600" />

                      {/* 状态标签 */}
                      <div className="absolute top-4 right-4">
                        {project.status === 'completed' ? (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-full text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            <span className="text-green-300">已完成</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/30 rounded-full text-sm">
                            <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                            <span className="text-yellow-300">创作中</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 项目信息 */}
                    <div className="p-6">
                      <h3 className="text-xl font-semibold mb-2 group-hover:text-[#E8C547] transition-colors">
                        {project.title}
                      </h3>
                      <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                        {project.synopsis}
                      </p>

                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-gray-500">
                          <Clock className="w-4 h-4" />
                          <span>{project.createdAt}</span>
                        </div>
                        <div className="text-gray-500">
                          {project.shots} 个镜头
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}

            {filteredProjects.length === 0 && (
              <div className="col-span-full text-center py-12">
                <p className="text-gray-400 text-lg">没有找到匹配的项目</p>
              </div>
            )}

            {/* 新建项目卡片 */}
            {filteredProjects.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: filteredProjects.length * 0.1 }}
              >
              <Link href="/create">
                <div className="group h-full bg-white/5 border-2 border-dashed border-white/10 rounded-2xl hover:border-[#E8C547]/50 transition-all cursor-pointer flex items-center justify-center min-h-[300px]">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-[#E8C547]/15 to-[#D4A830]/15 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <Plus className="w-8 h-8 text-[#E8C547]" />
                    </div>
                    <p className="text-gray-400 group-hover:text-white transition-colors">
                      创建新项目
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
