import { db } from '@/lib/db';
import { notFound } from 'next/navigation';
import { toShareShots, shareShotsLabel } from '@/lib/share-shots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 公开只读共享页。凭 shareToken 匿名访问,不需要登录。
 * 展示:标题 / 简介 / 封面 / 分镜视频合集(如有)。
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return notFound();

  let project: any;
  try {
    project = db.prepare(
      'SELECT id, title, description, cover_urls, script_data, director_notes FROM projects WHERE share_token = ?'
    ).get(token);
  } catch {
    project = null;
  }

  if (!project) return notFound();

  const covers = safeJson<string[]>(project.cover_urls, []);
  const script = safeJson<any>(project.script_data, {});

  // 获取成片
  // v2.9: 分享页是用户把链接发给朋友的场景,CDN 过期最致命 —— 优先用持久化副本
  const finalRow = db.prepare(
    `SELECT media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type IN ('final_video','timeline') ORDER BY updated_at DESC LIMIT 1`
  ).get(project.id) as { media_urls: string; persistent_url: string | null } | undefined;
  const finalUrl = finalRow ? (finalRow.persistent_url || safeJson<string[]>(finalRow.media_urls, [])[0] || '') : '';

  // 获取所有视频片段
  const videoRows = db.prepare(
    `SELECT shot_number, media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'video' ORDER BY shot_number`
  ).all(project.id) as Array<{ shot_number: number; media_urls: string; persistent_url: string | null }>;

  /**
   * v12.432:标题以前写 `分镜 ({videoRows.length})`,用的是 DB 里的**行数**;
   * 但下面 `if (!url) return null` 会让没出片的镜头整格消失。于是外部访客看到
   * 「分镜 (10)」却只数得出 4 个播放器,不知道是没生成完还是页面坏了。
   * 分享页是拿给客户看的,这种账不能糊。数出片的,缺的也留一格说明白。
   */
  const shots = toShareShots(videoRows);

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white/90 py-10">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-[11px] text-white/30 mb-2 tracking-widest uppercase">
          Shared Project · Read Only
        </div>
        <h1 className="text-3xl font-bold mb-3">{project.title || '未命名作品'}</h1>
        {project.description && (
          <p className="text-white/60 mb-8 leading-relaxed">{project.description}</p>
        )}

        {finalUrl && (
          <div className="mb-8 rounded-xl overflow-hidden border border-white/[0.06] bg-black">
            <video src={finalUrl} controls className="w-full aspect-video" />
          </div>
        )}

        {!finalUrl && covers[0] && (
          <img loading="lazy" decoding="async" src={covers[0]} alt={project.title} className="w-full rounded-xl mb-8" />
        )}

        {script?.synopsis && (
          <section className="mb-8 p-5 rounded-xl border border-white/[0.05] bg-white/[0.02]">
            <h2 className="text-sm font-semibold text-[#E8C547] mb-2">简介</h2>
            <p className="text-sm text-white/70 leading-relaxed">{script.synopsis}</p>
          </section>
        )}

        {shots.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-[#E8C547] mb-3">
              分镜 ({shareShotsLabel(shots)})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {shots.map(x => (
                <div key={x.shotNumber} className="rounded-lg overflow-hidden border border-white/[0.05] bg-black">
                  {x.url ? (
                    <video src={x.url} controls muted className="w-full aspect-video" />
                  ) : (
                    <div className="w-full aspect-video grid place-items-center text-[10px] text-white/25 bg-white/[0.02]">
                      这镜还没出片
                    </div>
                  )}
                  <div className="text-[10px] text-white/40 px-2 py-1">镜头 {x.shotNumber}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="text-center text-[11px] text-white/20 pt-8 border-t border-white/[0.04]">
          由 AI Comic Studio 生成 · 仅作者可编辑
        </footer>
      </div>
    </div>
  );
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
