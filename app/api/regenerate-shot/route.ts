import { NextRequest } from 'next/server';
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';
import { db, now } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/regenerate-shot
 * 重新生成单个镜头视频 or 指定阶段
 * body: { projectId, shotNumber?, stage?, videoProvider? }
 *   - shotNumber: 重新生成某个镜头视频
 *   - stage: 'video' | 'editor' | 'storyboard' 等，重新执行某个阶段
 */
export async function POST(request: NextRequest) {
  const { projectId, shotNumber, stage, videoProvider } = await request.json();

  if (!projectId) {
    return new Response(JSON.stringify({ error: '缺少 projectId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch {}
      };

      try {
        const orchestrator = new HybridOrchestrator();
        orchestrator.onProgress = (type, data) => send(type, data);

        // v2.9: 项目已经存过 style_id —— 重生成时自动贯通,不依赖 client 传参
        // 没这行的话重生成的图会用 Director 自动检测的风格,和老镜头不一致
        try {
          const proj = db.prepare('SELECT style_id FROM projects WHERE id = ?').get(projectId) as { style_id?: string } | undefined;
          if (proj?.style_id) {
            orchestrator.setUserStyle(proj.style_id);
            console.log(`[Regenerate] Project style loaded: ${proj.style_id}`);
          }
        } catch (e) {
          console.warn('[Regenerate] style_id load failed:', e);
        }

        // ── 单镜头视频重新生成 ──
        if (shotNumber) {
          send('status', { message: `正在重新生成镜头 ${shotNumber} 视频...` });
          send('regenerateStart', { shotNumber, stage: 'video' });

          // 从DB获取该镜头的分镜信息
          const sbAsset = db.prepare(
            'SELECT * FROM project_assets WHERE project_id = ? AND type = ? AND shot_number = ?'
          ).get(projectId, 'storyboard', shotNumber) as any;

          const sceneAsset = db.prepare(
            'SELECT * FROM project_assets WHERE project_id = ? AND type = ? LIMIT 1'
          ).get(projectId, 'scene') as any;

          // v2.9: 优先拿持久化 URL,原 CDN 可能已 404
          const storyboard = {
            shotNumber,
            imageUrl: sceneAsset
              ? (sceneAsset.persistent_url || JSON.parse(sceneAsset.media_urls || '[]')[0] || '')
              : '',
            prompt: sbAsset ? JSON.parse(sbAsset.data || '{}').description || '' : `镜头 ${shotNumber}`,
          };

          try {
            const result = await orchestrator.regenerateShot(shotNumber, storyboard, {
              duration: 8,
              videoProvider: videoProvider || 'veo',
            });

            // 更新DB
            const existing = db.prepare(
              'SELECT id FROM project_assets WHERE project_id = ? AND type = ? AND shot_number = ?'
            ).get(projectId, 'video', shotNumber) as any;

            if (existing) {
              db.prepare('UPDATE project_assets SET media_urls = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ?')
                .run(JSON.stringify([result.videoUrl]), JSON.stringify({ duration: result.duration, status: 'completed' }), now(), existing.id);
            }

            send('regenerateComplete', {
              shotNumber,
              videoUrl: result.videoUrl,
              duration: result.duration,
              status: 'completed',
            });
            send('status', { message: `镜头 ${shotNumber} 重新生成完成!` });
          } catch (e) {
            console.error(`[Regenerate] Shot ${shotNumber} failed:`, e);
            send('regenerateError', { shotNumber, error: e instanceof Error ? e.message : '生成失败' });
          }
        }

        // ── 阶段级重做（制片人发起） ──
        if (stage && !shotNumber) {
          send('status', { message: `正在重做 ${stage} 阶段...` });
          send('redoStageStart', { stage });

          // 获取项目数据
          const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
          const scriptData = project?.script_data ? JSON.parse(project.script_data) : null;

          if (stage === 'video') {
            // 重做所有视频
            const storyboardAssets = db.prepare(
              'SELECT * FROM project_assets WHERE project_id = ? AND type = ? ORDER BY shot_number'
            ).all(projectId, 'storyboard') as any[];

            const charAssets = db.prepare(
              'SELECT * FROM project_assets WHERE project_id = ? AND type = ?'
            ).all(projectId, 'character') as any[];

            const sceneAssets = db.prepare(
              'SELECT * FROM project_assets WHERE project_id = ? AND type = ?'
            ).all(projectId, 'scene') as any[];

            // v2.9: 重做阶段同样优先用持久化 URL —— 几天后再重做,原 CDN 100% 已过期
            const pickUrl = (a: any) => a.persistent_url || JSON.parse(a.media_urls || '[]')[0] || '';

            const storyboards = storyboardAssets.map((a: any) => ({
              shotNumber: a.shot_number,
              imageUrl: pickUrl(a),
              prompt: JSON.parse(a.data || '{}').description || '',
              planData: JSON.parse(a.data || '{}').planData,
            }));

            const characters = charAssets.map((a: any) => ({
              character: a.name,
              name: a.name,
              imageUrl: pickUrl(a),
              description: JSON.parse(a.data || '{}').description || '',
            }));

            const scenes = sceneAssets.map((a: any) => ({
              name: a.name,
              imageUrl: pickUrl(a),
              description: JSON.parse(a.data || '{}').description || '',
            }));

            const videos = await orchestrator.runVideoProducer(
              storyboards, videoProvider || 'veo', characters, scenes, scriptData
            );

            // 更新DB
            for (const v of videos) {
              if (v.videoUrl && !v.videoUrl.startsWith('data:')) {
                const ex = db.prepare(
                  'SELECT id FROM project_assets WHERE project_id = ? AND type = ? AND shot_number = ?'
                ).get(projectId, 'video', v.shotNumber) as any;
                if (ex) {
                  db.prepare('UPDATE project_assets SET media_urls = ?, version = version + 1, updated_at = ? WHERE id = ?')
                    .run(JSON.stringify([v.videoUrl]), now(), ex.id);
                }
              }
            }

            send('videos', videos);
            send('redoStageComplete', { stage: 'video', data: videos });
          }

          if (stage === 'editor') {
            // 重做剪辑
            const videoAssets = db.prepare(
              'SELECT * FROM project_assets WHERE project_id = ? AND type = ? ORDER BY shot_number'
            ).all(projectId, 'video') as any[];

            const videos = videoAssets.map((a: any) => ({
              shotNumber: a.shot_number,
              // v2.9: 剪辑阶段喂给 ffmpeg 的 URL 必须稳定,持久版优先
              videoUrl: a.persistent_url || JSON.parse(a.media_urls || '[]')[0] || '',
              duration: JSON.parse(a.data || '{}').duration || 8,
              status: 'completed' as const,
            }));

            const editResult = await orchestrator.runEditor(videos, scriptData);
            send('editResult', editResult);
            send('redoStageComplete', { stage: 'editor', data: editResult });
          }
        }

        send('regenerateDone', { projectId });
      } catch (error) {
        console.error('[Regenerate] Fatal error:', error);
        send('error', { message: error instanceof Error ? error.message : '重新生成失败' });
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
