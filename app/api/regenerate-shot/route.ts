import { NextRequest } from 'next/server';
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';
import { db, now } from '@/lib/db';
import { updateAssetBySelector } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/regenerate-shot
 * 重新生成单个镜头视频 or 指定阶段
 * body: { projectId, shotNumber?, stage?, videoProvider? }
 *   - shotNumber: 重新生成某个镜头视频
 *   - stage: 'video' | 'editor' | 'storyboard' 等，重新执行某个阶段
 */
/**
 * v12.385:重生出来的视频**必须落盘**,再把持久 URL 一起写进资产。
 *
 * 项目级路由 `app/api/projects/[id]/regenerate-shot` 在 v12.343 就这么做了,
 * 而**本文件(顶层路由)一直没跟上** —— 它才是最高频的重生入口:
 * video-node / editor-node / review-node / pull-sheet-table 点「重生此镜」
 * 走的都是这里。
 *
 * 后果:DB 里 media_urls 存的是引擎的 CDN 外链、persistent_url 是 null。
 * 那种链接三五天就 403。owner 花了真金白银重生一镜、看到「完成」,
 * 几天后视频消失;而下一次 recompose 的 fullUrl() 取的正是 media_urls[0],
 * 于是自动重合成静默地拿到一条死链。
 *
 * 落盘失败不阻塞(至少把外链存下来还能救几天),但要留下痕迹。
 */
async function persistRegenerated(videoUrl: string): Promise<{ url: string } | null> {
  try {
    const { persistAsset } = await import('@/lib/asset-storage');
    const p = await persistAsset(videoUrl).catch(() => null);
    if (!p?.url) {
      console.warn(`[Regenerate] 落盘失败,回退外链(会过期):${String(videoUrl).slice(0, 80)}`);
      return null;
    }
    // 刻意返回**对象**而不是裸字符串:调用处于是能写成 `_saved?.url ?? null`,
    // 落进 v12.347 门禁认可的安全形态 —— 那道门禁要求 persistentUrl 的赋值
    // 一眼能看出「这是落盘结果,不是外链」。第一版我返回 string,门禁当场拦下,
    // 拦得对:函数名叫 persistRegenerated 是我知道,门禁只看得见形态。
    return { url: p.url };
  } catch (e) {
    console.warn('[Regenerate] 落盘异常:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { projectId, shotNumber, stage, videoProvider, cameraMovement, dryRun, force, tailFrameUrl: bodyTailFrameUrl } = await request.json();

  if (!projectId) {
    return new Response(JSON.stringify({ error: '缺少 projectId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // v12.172:预算护栏 —— 此前本路由(单镜重生/批量补渲/阶段重做)完全绕过 assertBudget,
  // force 反复补渲可无上限烧钱。dryRun 免检(零成本)。
  // v12.232(对抗复检 CRITICAL 补漏):两处缺陷一并修 ——
  //  ① 预算检查此前裹在 `if (uid)` 里,**匿名请求跳过护栏**直接跑完整重渲管线(MJ+Kling/Minimax+ffmpeg);
  //  ② 全程**不校验 projectId 归属**,已登录用户可对他人项目触发重渲、烧对方额度。
  // dryRun 仍免检(零成本),但归属校验对 dryRun 也要做 —— 否则可拿它探测他人项目是否存在。
  {
    const { requireProjectAccess } = await import('@/lib/auth-guard');
    const g = await requireProjectAccess(request, projectId, 'edit');
    if (!g.ok) {
      return new Response(JSON.stringify({ error: g.message, code: 'forbidden' }), { status: g.status, headers: { 'Content-Type': 'application/json' } });
    }
    if (dryRun !== true) {
      const { assertBudget } = await import('@/lib/budget-enforce');
      const { estimatePipelineCostCny } = await import('@/lib/budget-estimate');
      const pending = shotNumber
        ? estimatePipelineCostCny({ shotCount: 1, videoShots: 1, videoProvider, secondsPerShot: 8, skipImages: true })
        : estimatePipelineCostCny({ videoProvider, skipImages: stage === 'failed-videos' });
      const b = await assertBudget({ userId: g.userId, pendingCostCny: pending });
      if (!b.allow) {
        return new Response(JSON.stringify({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }), { status: 402, headers: { 'Content-Type': 'application/json' } });
      }
    }
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

        // v2.9 + v12.132(issue #2 Bug B):贯通画风 + 角色参考(primary_character_ref /
        // locked_characters)。此前只读 style_id → 单镜重生的视频拿不到主体参考、丢角色 DNA。
        try {
          const { parseProjectContext, applyProjectContext, PROJECT_CONTEXT_COLUMNS } = await import('@/lib/orchestrator-project-context');
          const row = db.prepare(`SELECT ${PROJECT_CONTEXT_COLUMNS} FROM projects WHERE id = ?`).get(projectId) as any;
          const applied = applyProjectContext(orchestrator, parseProjectContext(row));
          console.log(`[Regenerate] v12.132 项目上下文贯通: style=${applied.style} ref=${applied.primaryRef} locked=${applied.locked}`);
        } catch (e) {
          console.warn('[Regenerate] project context load failed:', e);
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

          // v12.154:引擎首帧统一走 pickEngineImageUrl(http CDN 优先;站内由 toEngineImage 转 base64);
          // 分镜图优先于场景图(该镜构图 > 通用场景)。
          const { pickEngineImageUrl: pickEng } = await import('@/lib/first-frame');
          const storyboard = {
            shotNumber,
            imageUrl: (sbAsset && pickEng(sbAsset)) || (sceneAsset && pickEng(sceneAsset)) || '',
            prompt: sbAsset ? JSON.parse(sbAsset.data || '{}').description || '' : `镜头 ${shotNumber}`,
          };
          // v12.141(P0-1):每镜运镜覆盖(preset id/自由文本 → 专业运镜指令)
          {
            const { resolveCameraMovementPrompt } = await import('@/lib/prompt-templates');
            const cameraPrompt = resolveCameraMovementPrompt(cameraMovement);
            if (cameraPrompt) {
              storyboard.prompt = [storyboard.prompt, cameraPrompt].filter(Boolean).join('. ');
              console.log(`[regenerate-shot] v12.141 运镜覆盖: ${String(cameraMovement).slice(0, 30)}`);
            }
          }

          try {
            // v12.197:尾帧锁定 —— body 显式传入优先,否则读剧本该镜的 tailFrameUrl
            let tailFrameUrl: string | undefined = typeof bodyTailFrameUrl === 'string' && bodyTailFrameUrl.trim() ? bodyTailFrameUrl.trim() : undefined;
            if (!tailFrameUrl) {
              try {
                const sd = JSON.parse((db.prepare('SELECT script_data FROM projects WHERE id = ?').get(projectId) as any)?.script_data || '{}');
                const sh = (sd?.shots || []).find((x: any) => x?.shotNumber === shotNumber);
                if (typeof sh?.tailFrameUrl === 'string' && sh.tailFrameUrl.trim()) tailFrameUrl = sh.tailFrameUrl.trim();
              } catch { /* 剧本读不出就不带尾帧 */ }
            }
            if (tailFrameUrl) console.log(`[regenerate-shot] v12.197 尾帧锁定: ${tailFrameUrl.slice(0, 60)}`);
            const result = await orchestrator.regenerateShot(shotNumber, storyboard, {
              duration: 8,
              videoProvider: videoProvider || 'veo',
              tailFrameUrl,
            });

            // 更新DB(v12.154:如实存降级标记)
            const _saved = await persistRegenerated(result.videoUrl);
            await updateAssetBySelector(
              projectId, { type: 'video', shotNumber },
              { mediaUrls: [_saved?.url || result.videoUrl], persistentUrl: _saved?.url ?? null, data: { duration: result.duration, status: 'completed', isAnimatic: !!(result as any).isAnimatic }, bumpVersion: true },
            );

            send('regenerateComplete', {
              shotNumber,
              videoUrl: _saved?.url || result.videoUrl,
              duration: result.duration,
              status: 'completed',
              // v12.385:批量路径(下面那处)一直带着这个标记,单镜路径漏了 ——
              // 于是引擎全挂、回落 Ken Burns 占位片时,前端照样显示「重新生成完成!」
              // 加绿勾。owner 以为补渲成功,直接合成,成片里混进静止图缓推。
              isAnimatic: !!(result as any).isAnimatic,
            });
            send('status', { message: `镜头 ${shotNumber} 重新生成完成!` });
          } catch (e) {
            console.error(`[Regenerate] Shot ${shotNumber} failed:`, e);
            send('regenerateError', { shotNumber, error: e instanceof Error ? e.message : '生成失败' });
          }
        }

        // ── v12.150:失败/降级镜头批量补渲(余额恢复后一键补,不整片重跑)──
        // 识别:video 资产 data.isAnimatic === true(Ken Burns 降级)或 mediaUrls 为空。
        // 逐镜重生(分镜图优先作首帧)→ 成功即更新资产;有成功镜则自动重做 editor 合成。
        if (stage === 'failed-videos' && !shotNumber) {
          // v12.153 修正:走 asset-repo(双驱动)—— db.prepare 直查 sqlite 在双驱动环境读 0 行,
          // 同一项目 health API(asset-repo)能识别 4 降级镜而本分支识别 0(live 实测抓到)。
          const { listAssetsByType } = await import('@/lib/repos/asset-repo');
          const videoAssets = await listAssetsByType(projectId, 'video') as any[];
          const isDegraded = (a: any) => {
            try {
              const d = JSON.parse(a.data || '{}');
              const urls = JSON.parse(a.media_urls || '[]');
              // isAnimatic 标记 v12.150 才落库 —— 旧项目兜底认 Ken Burns 产物文件名。
              // 注意 persistent_url 会被洗成 ?key=hash(无文件名特征),原始 media_urls[0] 常保留
              // ?path=...animatic-<ts>.mp4 —— 两个都测,任一命中即认降级。
              const candidates = [a.persistent_url, urls[0]].map((x) => String(x || ''));
              return d.isAnimatic === true || candidates.every((x) => !x) || candidates.some((x) => /animatic-\d+\.mp4/.test(x));
            } catch { return false; }
          };
          // force:跳过降级识别,全部镜重渲(资产被历史 bug 污染/想整体升质量时用)
          const targets = force === true ? videoAssets : videoAssets.filter(isDegraded);
          send('batchStart', { total: targets.length, shots: targets.map((a) => a.shot_number) });
          // dryRun:只回识别清单不真跑(UI 预览/验证用)
          if ((await Promise.resolve(dryRun)) === true) {
            send('batchDone', { total: targets.length, ok: 0, fail: 0, dryRun: true });
            send('regenerateDone', { projectId });
            controller.close();
            return;
          }
          if (targets.length === 0) {
            send('status', { message: '没有失败/降级镜头,无需补渲 ✅' });
          }

          let okCount = 0; let animaticCount = 0; // v12.154:真视频与降级分开统计,不再谎报
          // v12.161:有界并发 2 —— Kling/MiniMax 双通道时并行补渲,时长近似减半;
          // 每引擎自身的排队/限流由其 service 内处理,2 并发不至于打爆单引擎配额。
          const { mapPool } = await import('@/lib/film-health-io');
          let started = 0;
          await mapPool(targets, 2, async (asset: any) => {
            const sn = asset.shot_number;
            send('status', { message: `补渲镜头 ${sn}(${++started}/${targets.length})...` });
            try {
              const sbAll = await listAssetsByType(projectId, 'storyboard') as any[];
              const sbAsset = sbAll.find((x) => x.shot_number === sn);
              const sceneAsset = ((await listAssetsByType(projectId, 'scene')) as any[])[0];
              // v12.154:引擎首帧 http CDN 优先(persistent 站内路径由 toEngineImage 转 base64)
              const { pickEngineImageUrl } = await import('@/lib/first-frame');
              const storyboard = {
                shotNumber: sn,
                imageUrl: (sbAsset && pickEngineImageUrl(sbAsset)) || (sceneAsset && pickEngineImageUrl(sceneAsset)) || '',
                prompt: sbAsset ? JSON.parse(sbAsset.data || '{}').description || '' : `镜头 ${sn}`,
              };
              const result = await orchestrator.regenerateShot(sn, storyboard, {
                duration: 8,
                videoProvider: videoProvider || 'veo',
              }) as any;
              const _savedBatch = await persistRegenerated(result.videoUrl);
              await updateAssetBySelector(
                projectId, { type: 'video', shotNumber: sn },
                { mediaUrls: [_savedBatch?.url || result.videoUrl], persistentUrl: _savedBatch?.url ?? null, data: { duration: result.duration, status: 'completed', isAnimatic: !!result.isAnimatic }, bumpVersion: true },
              );
              if (!result.isAnimatic) okCount++; else animaticCount++;
              send('regenerateComplete', { shotNumber: sn, videoUrl: result.videoUrl, duration: result.duration, status: 'completed', isAnimatic: !!result.isAnimatic });
            } catch (e) {
              send('regenerateError', { shotNumber: sn, error: e instanceof Error ? e.message.slice(0, 120) : '生成失败' });
            }
          });
          send('batchDone', { total: targets.length, ok: okCount, animatic: animaticCount, fail: targets.length - okCount - animaticCount });

          // 有成功镜 → 自动重做剪辑合成(与 stage==='editor' 同逻辑)
          if (okCount + animaticCount > 0) {
            send('status', { message: `补渲完成:${okCount} 镜真视频${animaticCount ? `、${animaticCount} 镜仍降级(引擎未通)` : ''},自动重新合成成片...` });
            try {
              const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
              const scriptData = project?.script_data ? JSON.parse(project.script_data) : null;
              const freshRows = (await listAssetsByType(projectId, 'video')) as any[];
              const freshVideos = freshRows.sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0)).map((a: any) => ({
                shotNumber: a.shot_number,
                videoUrl: a.persistent_url || JSON.parse(a.media_urls || '[]')[0] || '',
                duration: JSON.parse(a.data || '{}').duration || 8,
                status: 'completed' as const,
              }));
              const editResult = await orchestrator.runEditor(freshVideos, scriptData);
              send('editResult', editResult);
            } catch (e) {
              send('status', { message: `重合成失败(镜头视频已更新,可稍后手动重做剪辑):${e instanceof Error ? e.message.slice(0, 80) : ''}` });
            }
          }
        }

        // ── 阶段级重做（制片人发起） ──
        if (stage && !shotNumber && stage !== 'failed-videos') {
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
                const _savedStage = await persistRegenerated(v.videoUrl);
                await updateAssetBySelector(
                  projectId, { type: 'video', shotNumber: v.shotNumber },
                  { mediaUrls: [_savedStage?.url || v.videoUrl], persistentUrl: _savedStage?.url ?? null, bumpVersion: true },
                );
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
