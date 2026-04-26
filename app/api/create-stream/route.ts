import { NextRequest } from 'next/server';
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import { storyTemplates } from '@/lib/story-templates';
import { toSsePayload, normalizeError } from '@/lib/pipeline-error';
import { persistAsset } from '@/lib/asset-storage';
import { scoreFinalVideo } from '@/lib/editor-score';
import { insertQualityScore } from '@/lib/quality-scores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared map of active orchestrator instances, keyed by projectId.
// Exported so the gate route can resolve gates.
export const activeOrchestrators: Map<string, HybridOrchestrator> = new Map();

export async function POST(request: NextRequest) {
  const { idea, videoProvider, style, duration, aspect, projectId: clientProjectId, isPreset, enableGates, templateId, primaryCharacterRef, lockedCharacters } = await request.json();

  if (!idea || !idea.trim()) {
    return new Response(JSON.stringify({ error: '请提供故事创意' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)); } catch {}
      };

      const projectId = clientProjectId || nanoid();
      const ts = now();

      // 各阶段结果（用 let 以便后续阶段即使前面失败也能继续）
      let plan: any = null;
      let script: any = null;
      let characters: any[] = [];
      let scenes: any[] = [];
      let storyboards: any[] = [];
      let videos: any[] = [];
      let editResult: any = null;
      let review: any = null;

      try {
        const orchestrator = new HybridOrchestrator();
        orchestrator.onProgress = (type, data) => send(type, data);

        // Register orchestrator so the gate route can resolve intervention gates
        activeOrchestrators.set(projectId, orchestrator);

        // Inject story template if provided
        if (templateId) {
          const template = storyTemplates.find(t => t.id === templateId);
          if (template) {
            orchestrator.setTemplate(template);
          }
        }

        // ── 注入用户选定画风（覆盖自动检测）──
        if (style) {
          orchestrator.setUserStyle(style);
        }

        // ── v2.9 P0 Cameo: 注入项目级主角脸参考图(锁死全片 IP)──
        // 优先级: primaryCharacterRef > lockedCharacters[0] > projects.primary_character_ref
        // 必须在 runCharacterDesigner 之前锁,否则会被自动首帧覆盖
        //
        // v2.12 Phase 1 多角色锁脸:
        //   如果请求体带了 lockedCharacters[],把第一个有 imageUrl 的角色当作 primary
        //   (兜底现有单角色编排链路;Phase 2 会做 per-shot 角色路由,根据
        //    Writer 标的角色名匹配对应 cref)
        let effectiveCameoRef = primaryCharacterRef || '';
        const sanitizedLocked = Array.isArray(lockedCharacters)
          ? lockedCharacters
              .filter((c: any) => c && typeof c.imageUrl === 'string' && c.imageUrl && typeof c.name === 'string' && c.name.trim())
              .slice(0, 3) // 硬上限 3 个,与前端 UI 一致
              .map((c: any) => ({
                name: String(c.name).trim().slice(0, 40),
                role: ['lead', 'antagonist', 'supporting', 'cameo'].includes(c.role) ? c.role : 'lead',
                cw: Number.isFinite(c.cw) ? Math.max(25, Math.min(125, Math.round(c.cw))) : 100,
                imageUrl: String(c.imageUrl),
              }))
          : [];
        if (!effectiveCameoRef && sanitizedLocked.length > 0) {
          effectiveCameoRef = sanitizedLocked[0].imageUrl;
        }
        if (!effectiveCameoRef && clientProjectId) {
          try {
            const row = db.prepare('SELECT primary_character_ref FROM projects WHERE id = ?').get(clientProjectId) as { primary_character_ref?: string } | undefined;
            if (row?.primary_character_ref) effectiveCameoRef = row.primary_character_ref;
          } catch {}
        }
        if (effectiveCameoRef) {
          orchestrator.setPrimaryCharacterRef(effectiveCameoRef);
        }

        // v2.11 #4 Writer-Editor 闭环: 把 projectId 注入 orchestrator,
        // 让 runWriter 能查历史评分、runEditor 完成后能写回评分。
        orchestrator.setProjectId(projectId);

        // 获取第一个可用用户ID（如果没有用户则创建一个）—— 提到 try 外, 后续阶段也要用
        let userId = 'WM-U2zcG9DmjuJ06NS9D9'; // 默认使用已存在的用户
        try {
          const user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
          if (user) {
            userId = user.id;
          } else {
            // 如果没有用户，创建一个默认用户
            const defaultUserId = 'demo-user-' + Date.now();
            db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
              .run(defaultUserId, 'demo@qfmanju.ai', 'dummy', '演示用户', 'user', ts);
            userId = defaultUserId;
            console.log(`[DB] Created default user: ${userId}`);
          }

          const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
          // v2.12 Phase 1: 把 lockedCharacters[] 持久化到 projects.locked_characters
          // (单一角色仍同步进 primary_character_ref,见上方 effectiveCameoRef 逻辑)
          const lockedJson = sanitizedLocked.length > 0 ? JSON.stringify(sanitizedLocked) : '[]';
          if (!existing) {
            // v2.9: 把用户选择的 style 持久化到 projects.style_id
            // v2.12: + 持久化 locked_characters + primary_character_ref(兜底)
            db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, style_id, primary_character_ref, locked_characters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(projectId, userId, idea.slice(0, 30), idea, '[]', 'active', style || null, effectiveCameoRef || null, lockedJson, ts, ts);
            console.log(`[DB] Project created: ${projectId}${style ? ` (style=${style})` : ''}${sanitizedLocked.length ? ` lockedChars=${sanitizedLocked.length}` : ''}`);
          } else {
            // 已存在就 UPDATE —— 用户可能在同一个 projectId 下换了风格重跑
            try {
              db.prepare('UPDATE projects SET style_id = COALESCE(?, style_id), locked_characters = ?, updated_at = ? WHERE id = ?')
                .run(style || null, lockedJson, ts, projectId);
              if (effectiveCameoRef) {
                db.prepare('UPDATE projects SET primary_character_ref = ? WHERE id = ?')
                  .run(effectiveCameoRef, projectId);
              }
            } catch (e) {
              console.warn(`[DB] style/locked_characters update failed for ${projectId}:`, e);
            }
            console.log(`[DB] Project exists: ${projectId}${style ? ` (style updated=${style})` : ''}${sanitizedLocked.length ? ` lockedChars=${sanitizedLocked.length}` : ''}`);
          }
        } catch (e) {
          console.error('[DB] Project creation failed:', e);
          send('error', { message: '项目创建失败，请重试' });
          controller.close();
          return;
        }

        send('agents', orchestrator.getAllAgents());
        send('projectId', { projectId });

        // ── 1. Director ──
        try {
          send('status', { message: 'AI 导演正在分析创意...' });
          plan = await orchestrator.runDirector(idea);
          send('agents', orchestrator.getAllAgents());
          send('plan', plan);
        } catch (e) {
          console.error('[Stream] Director failed:', e);
          send('status', { message: '导演分析出错，使用默认计划...' });
        }

        if (!plan) { send('error', { message: '导演计划生成失败' }); controller.close(); return; }

        // ── 2. Writer ──
        try {
          send('status', { message: 'AI 编剧正在运用麦基方法论创作剧本...' });
          script = await orchestrator.runWriter(plan);
          send('agents', orchestrator.getAllAgents());
          send('script', script);
          saveAsset(projectId, 'script', '剧本', { synopsis: script.synopsis, title: script.title, shots: script.shots, theme: (script as any).theme });
        } catch (e) {
          console.error('[Stream] Writer failed:', e);
          send('status', { message: '编剧创作出错，继续下一步...' });
        }

        if (!script) { send('error', { message: '剧本生成失败' }); controller.close(); return; }

        // ── Gate: after-script ──
        if (enableGates) {
          const gateResult = await orchestrator.waitForGate('after-script', { script, plan });
          if (gateResult?.action === 'edit' && gateResult.editedData) {
            script = gateResult.editedData;
            send('script', script);
          }
        }

        // ── 3. Character Designer ──
        try {
          send('status', { message: 'AI 角色设计师正在绘制角色三视图...' });
          characters = await orchestrator.runCharacterDesigner(plan.characters);
          send('agents', orchestrator.getAllAgents());
          send('characters', characters);
          // 保存角色图片到资产库（直接带上 mediaUrls，不依赖二次 UPDATE）
          characters.forEach((c: any) => {
            const mediaUrls = c.imageUrl && !c.imageUrl.startsWith('data:') ? [c.imageUrl] : [];
            saveAsset(projectId, 'character', c.character || c.name, {
              description: c.description || c.prompt || '',
              appearance: c.appearance || '',
            }, mediaUrls);
          });
          // v2.11 #2: 同时写入用户的全局角色库 (global_assets)
          // 跨项目复用 — 同名角色去重(用户视角更直观), 多个项目用过同一个角色, 累加到 referenced_by_projects
          try {
            const { listGlobalAssets, createGlobalAsset, updateGlobalAsset, recordAssetUsage } = await import('@/lib/global-assets');
            const existing = listGlobalAssets({ userId, type: 'character', limit: 200, offset: 0 });
            let saved = 0;
            for (const c of characters) {
              const charName = c.character || c.name;
              if (!charName) continue;
              const thumbUrl = c.imageUrl && !c.imageUrl.startsWith('data:') ? c.imageUrl : '';
              const found = existing.find((a: any) => a.name === charName);
              if (found) {
                // 同名 — 仅当新有图且旧无图时升级缩略图; 描述若新版更长就覆盖
                const updates: any = {};
                if (!found.thumbnail && thumbUrl) updates.thumbnail = thumbUrl;
                if (c.description && c.description.length > (found.description || '').length) {
                  updates.description = c.description;
                }
                if (Object.keys(updates).length > 0) {
                  updateGlobalAsset(found.id, userId, updates);
                }
                // 当前项目登记到引用集
                recordAssetUsage(found.id, userId, projectId);
              } else {
                createGlobalAsset({
                  userId,
                  type: 'character',
                  name: charName,
                  description: c.description || '',
                  thumbnail: thumbUrl,
                  visualAnchors: [c.appearance].filter(Boolean) as string[],
                  metadata: { firstProjectId: projectId, prompt: c.prompt || '' },
                  tags: [],
                });
                saved++;
              }
            }
            if (saved > 0) {
              send('status', { message: `已把 ${saved} 个新角色登记到角色库` });
            }
          } catch (e) {
            console.warn('[Stream] global_assets character save failed:', e);
          }
        } catch (e) {
          console.error('[Stream] Character Designer failed:', e);
          send('status', { message: '角色设计出错，继续下一步...' });
        }

        // ── Gate: after-characters ──
        if (enableGates) {
          const gateResult = await orchestrator.waitForGate('after-characters', { characters });
          if (gateResult?.action === 'edit' && gateResult.editedData) {
            characters = gateResult.editedData;
            send('characters', characters);
          }
        }

        // ── 4. Scene Designer ──
        try {
          send('status', { message: 'AI 场景设计师正在设计场景概念图...' });
          scenes = await orchestrator.runSceneDesigner(plan.scenes);
          send('agents', orchestrator.getAllAgents());
          send('scenes', scenes);
          // 保存场景图片到资产库（过滤 mock data URI）
          scenes.forEach((s: any) => {
            const mediaUrls = s.imageUrl && !s.imageUrl.startsWith('data:') ? [s.imageUrl] : [];
            saveAsset(projectId, 'scene', s.name, { description: s.description, location: s.name }, mediaUrls);
          });
          // v2.11 #2: 场景同步登记到全局场景库 (跨项目复用 — 同地点不同时间可重复用)
          try {
            const { listGlobalAssets, createGlobalAsset, updateGlobalAsset, recordAssetUsage } = await import('@/lib/global-assets');
            const existing = listGlobalAssets({ userId, type: 'scene', limit: 300, offset: 0 });
            for (const s of scenes) {
              const sceneName = s.name;
              if (!sceneName) continue;
              const thumbUrl = s.imageUrl && !s.imageUrl.startsWith('data:') ? s.imageUrl : '';
              const found = existing.find((a: any) => a.name === sceneName);
              if (found) {
                const updates: any = {};
                if (!found.thumbnail && thumbUrl) updates.thumbnail = thumbUrl;
                if (s.description && s.description.length > (found.description || '').length) {
                  updates.description = s.description;
                }
                if (Object.keys(updates).length > 0) updateGlobalAsset(found.id, userId, updates);
                recordAssetUsage(found.id, userId, projectId);
              } else {
                createGlobalAsset({
                  userId, type: 'scene', name: sceneName,
                  description: s.description || '',
                  thumbnail: thumbUrl,
                  metadata: { firstProjectId: projectId },
                  tags: [],
                });
              }
            }
          } catch (e) {
            console.warn('[Stream] global_assets scene save failed:', e);
          }
        } catch (e) {
          console.error('[Stream] Scene Designer failed:', e);
          send('status', { message: '场景设计出错，继续下一步...' });
        }

        // ── 5a. Storyboard Planning（纯文本分镜规划）──
        let storyboardPlans: any[] = [];
        try {
          send('status', { message: 'AI 分镜师正在规划分镜描述...' });
          storyboardPlans = await orchestrator.runStoryboardArtist(script, characters, scenes);
          send('agents', orchestrator.getAllAgents());
          send('storyboardPlans', storyboardPlans);
          // 保存分镜（含图片 URL，如果有的话）
          storyboardPlans.forEach((sb: any) => {
            const mediaUrls = sb.imageUrl && !sb.imageUrl.startsWith('data:') ? [sb.imageUrl] : [];
            saveAsset(projectId, 'storyboard', `镜头 ${sb.shotNumber}`, {
              description: sb.prompt,
              planData: (sb as any).planData,
              duration: 10,
            }, mediaUrls, sb.shotNumber);
          });
        } catch (e) {
          console.error('[Stream] Storyboard Planning failed:', e);
          send('status', { message: '分镜规划出错，继续下一步...' });
        }

        // ── 5b. 分镜图渲染（2路并发，每张3分钟超时）──
        // 生成每个镜头的分镜图，作为视频生成的 first_frame_image
        // 这是"角色+场景+分镜脚本→镜头"一致性管线的关键环节
        try {
          send('status', { message: 'AI 分镜师正在渲染分镜图（角色+场景一致性）...' });
          storyboards = await orchestrator.runStoryboardRenderer(storyboardPlans, script, characters, scenes);
          send('agents', orchestrator.getAllAgents());
          send('storyboards', storyboards);
          // 更新分镜资产（添加渲染后的图片URL + Sprint A.1 cameo 痕迹, A.4 仪表盘消费）
          storyboards.forEach((sb: any) => {
            const mediaUrls = sb.imageUrl && !sb.imageUrl.startsWith('data:') ? [sb.imageUrl] : [];
            saveAsset(projectId, 'storyboard', `镜头 ${sb.shotNumber}`, {
              description: sb.prompt,
              planData: (sb as any).planData,
              duration: 10,
              // v2.12 Sprint A.4: cameo retry 痕迹落库, 详情页"分镜" tab 直接读 data 渲染徽章
              cameoScore: sb.cameoScore,
              cameoRetried: sb.cameoRetried,
              cameoAttempts: sb.cameoAttempts,
              cameoFinalCw: sb.cameoFinalCw,
              cameoReason: sb.cameoReason,
            }, mediaUrls, sb.shotNumber);
          });
        } catch (e) {
          console.error('[Stream] Storyboard Rendering failed:', e);
          send('status', { message: '分镜图渲染出错，使用文本分镜继续...' });
          storyboards = storyboardPlans;
          send('storyboards', storyboards);
        }

        // ── 6. Video Producer（角色图+场景图+分镜脚本→Veo，增强一致性）──
        // SSE 心跳：视频生成耗时长，定期发送心跳防止连接超时
        const heartbeatInterval = setInterval(() => {
          try { send('heartbeat', { ts: Date.now() }); } catch {}
        }, 15000); // 每15秒一次心跳

        try {
          const activeProvider = videoProvider || 'veo';
          const providerLabel = activeProvider === 'veo' || activeProvider === 'veo3.1' ? 'Veo 3.1' : 'Minimax';
          send('status', { message: `AI 视频制作正在逐条生成视频（${providerLabel}，共 ${storyboards.length} 个镜头）...` });
          videos = await orchestrator.runVideoProducer(storyboards, activeProvider, characters, scenes, script);
          send('agents', orchestrator.getAllAgents());
          send('videos', videos); // 发送完整视频列表（前端可能已通过 videoClip 逐条收到）
          // 保存镜头视频和封面图到资产库
          videos.forEach((v: any) => {
            if (v.videoUrl && !v.videoUrl.startsWith('data:')) {
              const mediaUrls = [v.videoUrl];
              if (v.coverImageUrl) mediaUrls.push(v.coverImageUrl);
              saveAsset(projectId, 'video', `视频 ${v.shotNumber}`, {
                duration: v.duration || 5,
                status: v.status,
                coverImageUrl: v.coverImageUrl || null,
              }, mediaUrls, v.shotNumber);
            }
          });
        } catch (e) {
          console.error('[Stream] Video Producer failed:', e);
          send('status', { message: '视频生成出错，继续下一步...' });
        } finally {
          clearInterval(heartbeatInterval);
        }

        // ── 7. Editor（含配乐生成）──
        try {
          send('status', { message: 'AI 剪辑师正在剪辑合成完整视频并生成配乐...' });
          editResult = await orchestrator.runEditor(videos, script);
          send('agents', orchestrator.getAllAgents());
          send('editResult', editResult);
          saveAsset(projectId, 'timeline', '剪辑时间线', editResult);
          // 保存最终成片视频URL
          if (editResult.finalVideoUrl) {
            saveAsset(projectId, 'final_video', '最终成片', { duration: editResult.totalDuration }, [editResult.finalVideoUrl]);
          }
          // 保存配乐
          if (editResult.musicUrl) {
            saveAsset(projectId, 'music', '背景配乐', { duration: editResult.totalDuration }, [editResult.musicUrl]);
          }

          // ── v2.11 #4 Writer-Editor 闭环: Editor 成片后对最终视频打 3 维分 ──
          // 异步跑(fire-and-forget),不阻塞下一步的 Producer Review
          // 结果会写进 project_quality_scores,下次 runWriter 时自动读取
          if (editResult.finalVideoUrl) {
            scoreFinalVideo(editResult.finalVideoUrl, 4)
              .then((score) => {
                if (!score) return;
                try {
                  const row = insertQualityScore({
                    projectId,
                    overall: score.overall,
                    continuity: score.continuity,
                    lighting: score.lighting,
                    face: score.face,
                    narrative: score.narrative,
                    sampleFrames: score.sampleFrames,
                    suggestions: score.suggestions,
                  });
                  console.log(`[EditorScore] project=${projectId} overall=${row.overall} continuity=${row.continuity} lighting=${row.lighting} face=${row.face}`);
                  // 推给前端,让 UI 可以展示本轮评分 + 迭代历史
                  send('qualityScore', {
                    overall: row.overall,
                    continuity: row.continuity,
                    lighting: row.lighting,
                    face: row.face,
                    narrative: row.narrative,
                    suggestions: row.suggestions,
                    sampleFrames: row.sampleFrames,
                    createdAt: row.createdAt,
                  });
                } catch (e) {
                  console.warn('[EditorScore] persist failed:', e instanceof Error ? e.message : e);
                }
              })
              .catch((e) => {
                console.warn('[EditorScore] scoreFinalVideo failed:', e instanceof Error ? e.message : e);
              });
          }
        } catch (e) {
          console.error('[Stream] Editor failed:', e);
          send('status', { message: '剪辑出错，继续审核...' });
        }

        // ── 8. Producer Review（制片人审核，替代原导演审核角色）──
        try {
          send('status', { message: 'AI 制片人正在进行100分制全面审核...' });
          review = await orchestrator.runDirectorReview(script, videos, editResult);
          send('agents', orchestrator.getAllAgents());
          send('review', review);
        } catch (e) {
          console.error('[Stream] Producer Review failed:', e);
          send('status', { message: '制片人审核出错...' });
        }

        // ── 9. 闭环：不通过则自动改进 ──
        let finalVideos = videos;
        let finalStoryboards = storyboards;

        if (review && !review.passed) {
          try {
            send('status', { message: '导演审核未通过，正在自动优化...' });
            const improved = await orchestrator.executeReviewFeedback(review, script, storyboards, videos);
            finalStoryboards = improved.storyboards;
            finalVideos = improved.videos;
            send('agents', orchestrator.getAllAgents());
            send('videos', finalVideos);
            send('storyboards', finalStoryboards);
            finalVideos.forEach((v: any) => { updateAssetMedia(projectId, 'video', `视频 ${v.shotNumber}`, [v.videoUrl], v.shotNumber); });

            // 二次审核
            send('status', { message: 'AI 导演正在进行二次审核...' });
            const review2 = await orchestrator.runDirectorReview(script, finalVideos, editResult);
            send('review', review2);
            try { db.prepare('UPDATE projects SET director_notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(review2), now(), projectId); } catch {}
          } catch (e) {
            console.error('[Stream] Review feedback failed:', e);
          }
        } else if (review) {
          try { db.prepare('UPDATE projects SET director_notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(review), now(), projectId); } catch {}
        }

        // ── 10. 完成 ──
        try {
          const coverUrl = finalStoryboards[0]?.imageUrl || '';
          db.prepare('UPDATE projects SET status = ?, cover_urls = ?, script_data = ?, updated_at = ? WHERE id = ?')
            .run('completed', JSON.stringify([coverUrl]), JSON.stringify(script), now(), projectId);
        } catch {}

        send('complete', { projectId, plan, script, characters, scenes, storyboards: finalStoryboards, videos: finalVideos, editResult, review });

      } catch (error) {
        console.error('[Stream] Fatal error:', error);
        const payload = toSsePayload(error);
        // 兼容旧客户端: 同时发 { message } 与结构化 {code,userMsg,retryable,stage}
        send('error', { ...payload, message: payload.userMsg });
      } finally {
        // Clean up the orchestrator from the active map
        activeOrchestrators.delete(projectId);
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

/**
 * v2.9: 对一组 URL 异步做持久化,返回第一张成功落盘的 persistent_url。
 * 失败不抛错 —— 持久化是兜底,原始 URL 仍会写进 media_urls。
 */
async function persistFirstValid(urls?: string[]): Promise<string | null> {
  if (!urls || urls.length === 0) return null;
  for (const u of urls) {
    if (!u || u.startsWith('data:image/svg')) continue; // 跳过 seed svg
    try {
      const persisted = await persistAsset(u);
      if (persisted) return persisted.url;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * v2.9: 同步落库 + 后台持久化。
 *
 * 旧实现(错的): await persistFirstValid 再 INSERT —— 外链下载 30s/张
 * 超时,~15 个镜头串起来能把 SSE 流拖到 5-10min 才出 complete 事件,
 * 客户端早超时了。
 *
 * 新实现: 先立刻 INSERT (persistent_url = null),然后后台 fetch+写盘,
 * 成功后 UPDATE persistent_url。这样 UI 能立刻看到资产卡片,持久化
 * 在背面慢慢跑,即使失败也不影响主流程。
 */
function saveAsset(projectId: string, type: string, name: string, data: any, mediaUrls?: string[], shotNumber?: number) {
  try {
    // 先检查项目是否存在
    const projectExists = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) {
      console.error(`[DB] Cannot save asset: project ${projectId} does not exist`);
      return;
    }

    const assetId = nanoid();

    // 同步落库, persistent_url 先留空
    db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, shot_number, version, persistent_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(assetId, projectId, type, name, JSON.stringify(data || {}), JSON.stringify(mediaUrls || []), shotNumber || null, 1, null, now(), now());
    console.log(`[DB] Asset saved: ${type}/${name}`);

    // 后台持久化第一张有效 URL, 不 await —— 慢 fetch 不能阻塞 SSE 流
    if (mediaUrls && mediaUrls.length > 0) {
      void persistFirstValid(mediaUrls).then(url => {
        if (!url) return;
        try {
          db.prepare('UPDATE project_assets SET persistent_url = ?, updated_at = ? WHERE id = ?')
            .run(url, now(), assetId);
          console.log(`[DB] Asset persisted: ${type}/${name} → ${url.slice(0, 60)}`);
        } catch (e) {
          console.warn(`[DB] persistent_url update failed (${type}/${name}):`, e);
        }
      }).catch(() => { /* swallow — persistFirstValid 已内部捕获 */ });
    }
  } catch (e) {
    console.error(`[DB] Asset save failed (${type}/${name}):`, e);
  }
}

function updateAssetMedia(projectId: string, type: string, name: string, mediaUrls: string[], shotNumber?: number) {
  try {
    let result;
    if (shotNumber) {
      result = db.prepare('UPDATE project_assets SET media_urls = ?, updated_at = ? WHERE project_id = ? AND type = ? AND shot_number = ?')
        .run(JSON.stringify(mediaUrls), now(), projectId, type, shotNumber);
    } else {
      result = db.prepare('UPDATE project_assets SET media_urls = ?, updated_at = ? WHERE project_id = ? AND type = ? AND name = ?')
        .run(JSON.stringify(mediaUrls), now(), projectId, type, name);
    }

    if (result.changes > 0) {
      console.log(`[DB] Asset media updated: ${type}/${name}`);
    } else {
      console.log(`[DB] Asset not found for update: ${type}/${name}`);
      return;
    }

    // 后台刷新 persistent_url (新 URL 可能是不同的 CDN, 重新抓一份)
    if (mediaUrls.length > 0) {
      void persistFirstValid(mediaUrls).then(url => {
        if (!url) return;
        try {
          if (shotNumber) {
            db.prepare('UPDATE project_assets SET persistent_url = ?, updated_at = ? WHERE project_id = ? AND type = ? AND shot_number = ?')
              .run(url, now(), projectId, type, shotNumber);
          } else {
            db.prepare('UPDATE project_assets SET persistent_url = ?, updated_at = ? WHERE project_id = ? AND type = ? AND name = ?')
              .run(url, now(), projectId, type, name);
          }
          console.log(`[DB] Asset persisted (update): ${type}/${name}`);
        } catch (e) {
          console.warn(`[DB] persistent_url update failed (${type}/${name}):`, e);
        }
      }).catch(() => {});
    }
  } catch (e) {
    console.error(`[DB] Asset update failed (${type}/${name}):`, e);
  }
}
