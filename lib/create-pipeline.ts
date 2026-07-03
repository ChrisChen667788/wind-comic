/**
 * lib/create-pipeline (v10.4.1) — create-stream 主流水线本体(从 route 原样提取)。
 *
 * 动机:此前整条流水线跑在 HTTP 请求生命周期里(SSE start() 闭包内),
 * 客户端断开/部署重启 = 进度黑箱/孤儿进程。提取成纯函数后:
 *   - 旧路径(默认):route 在请求内调用,行为与提取前逐字节一致
 *   - 队列路径(PIPELINE_QUEUE=1):worker 在请求外调用,emit 进事件总线 + 任务表回放
 *
 * emit(type, data) 即原 SSE send;新增 'step' 标记事件(阶段边界,任务表记录,
 * v10.4.2 幂等续跑消费;create 页 switch 无 default,未知事件天然忽略)。
 */
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';
import { db, now } from '@/lib/db';
import { updateAssetBySelector, listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { getProject, insertProjectFull, updateProjectById, upsertLockedCharacters } from '@/lib/repos/project-repo';
import { createUser } from '@/lib/repos/user-repo';
import { storyTemplates } from '@/lib/story-templates';
import { toSsePayload } from '@/lib/pipeline-error';
import { persistAsset } from '@/lib/asset-storage';
import { scoreFinalVideo } from '@/lib/editor-score';
import { insertQualityScore } from '@/lib/quality-scores';
import { enrichScenesFromWriterScript } from '@/lib/scene-enrich';
import { bindElements } from '@/lib/reference-elements';
import { loadCheckpoints, emptyCheckpoints, checkpointSummary, type PipelineCheckpoints } from '@/lib/pipeline-checkpoints';
import { StageTimer, summarizeTiming } from '@/lib/stage-timing'; // v12.32.0 阶段耗时归因

// 活跃编排器注册表 — gate 路由 / rerun / regenerate 据此找到运行中的编排器
// (原在 route 模块;route 仍 re-export 以保持既有 import 路径不变)
export const activeOrchestrators: Map<string, HybridOrchestrator> = new Map();

export interface CreatePipelineInput {
  /** 已过 normalize + 安全闸门 + prompt 增强的最终创意 */
  idea: string;
  /** 调用方预先确定(队列路径 enqueue 时就要把 id 告诉客户端) */
  projectId: string;
  videoProvider?: string;
  style?: string;
  aspect?: string;
  enableGates?: boolean;
  templateId?: string;
  primaryCharacterRef?: string;
  lockedCharacters?: any[];
  cameraDefault?: string;
  previewSeedImage?: string;
  references?: any[];
  /** v11.1.2 拉片复刻:预构脚本 → 跳过 Writer 创意,保结构起片 */
  replicaScript?: any;
  /** v12.0.4 一句指令调剪辑风格(「快节奏燃向」/「慢叙抒情」),空 → 默认中速 */
  editStyle?: string;
}

export type PipelineEmit = (type: string, data: unknown) => void;

export async function runCreatePipeline(input: CreatePipelineInput, emit: PipelineEmit, opts?: { resume?: boolean }): Promise<void> {
  const { idea, projectId, videoProvider, style, aspect, enableGates, templateId, primaryCharacterRef, lockedCharacters, cameraDefault, previewSeedImage, references, replicaScript, editStyle } = input as CreatePipelineInput & Record<string, any>;
  // v12.32.0:阶段耗时归因 —— 各阶段边界本就发 send('step',{step}),顺手用它做计时埋点(零额外侵入)。
  const _stageTimer = new StageTimer();
  let _curStage: string | null = null;
  const send: PipelineEmit = (type, data) => {
    if (type === 'step' && data && typeof (data as { step?: unknown }).step === 'string') {
      const step = (data as { step: string }).step;
      if (_curStage) _stageTimer.end(_curStage);
      _curStage = step;
      _stageTimer.start(step);
    }
    return emit(type, data); // 原文 send() 调用零改动
  };


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
    orchestrator.onProgress = (type, data) => {
      send(type, data);
      // v2.23 P0.3: 持久化 character DNA 到 character asset 的 data 字段, 让项目页能拿到
      // v9.0.1b: 走 asset-repo (双驱动). onProgress 是同步回调, DNA 持久化是 best-effort —
      // 用 fire-and-forget async IIFE (与 saveAsset 后台落盘同款), 不阻塞编排进度推送。
      if (type === 'characterDna' && data?.perCharacter && Array.isArray(data.perCharacter)) {
        const perCharacter = data.perCharacter as Array<{ name: string; signature: any; filledCount: number; totalCount: number; missing: string[] }>;
        void (async () => {
          try {
            const chars = await listAssetsByType(projectId, 'character');
            for (const entry of perCharacter) {
              // 读旧 data 合并 — 不丢之前的 description/appearance
              const row = chars.find((c) => c.name === entry.name);
              if (!row) continue;
              let mergedData: any = {};
              try { mergedData = row.data ? JSON.parse(row.data) : {}; } catch { /* ignore */ }
              mergedData.dna = {
                signature: entry.signature,
                filledCount: entry.filledCount,
                totalCount: entry.totalCount,
                missing: entry.missing,
                extractedAt: now(),
              };
              await updateAssetBySelector(projectId, { type: 'character', name: entry.name }, { data: mergedData });
            }
          } catch (e) {
            console.warn('[create-stream] DNA persist failed:', e);
          }
        })();
      }
    };

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

    // ── v12.0.4 注入剪辑风格指令(一句话调 pacing/转场)──
    if (editStyle && typeof editStyle === 'string') {
      orchestrator.setEditStyle(editStyle);
    }

    // v2.14 P1.1: 全局默认镜头语言 — 影响所有镜头的运镜默认值。
    // 用户在 chip picker 选了某个预设, 透到 orchestrator, runComposeOrders 会
    // 把对应的专业 prompt 拼进每个 shot 的 cameraMovement / visualPrompt 后段。
    if (cameraDefault && typeof cameraDefault === 'string') {
      orchestrator.setCameraDefault(cameraDefault);
    }

    // v2.20 P0.1: 项目级宽高比 — 漫剧场景应 '9:16', 横屏剧用 '16:9'
    if (aspect && typeof aspect === 'string') {
      orchestrator.setAspect(aspect);
    }

    // v2.19 P0.2: 试拍图复用 — 用户在 create 页 "试拍 1 镜" 接受了某张图,
    // 直接当第 1 镜的 storyboard 渲染结果, 跳一次 MJ 调用 + 把整片画风锚定到那张图。
    // setter 内部校验 http(s) URL, 非法值会被忽略, 不阻塞主流程。
    // v9.4.6: 多参元素 → 路由进既有 cref/seed 通道。只取 http(s)(data:URI 上传由 setter 自然忽略),
    // 且只在用户没显式给时兜底, 不覆盖用户选择。元素角色由货架标 / inferElementRole 推断。
    const elementBinding = bindElements(Array.isArray(references) ? references : []);
    const isHttpRef = (u?: string) => typeof u === 'string' && /^https?:\/\//i.test(u);
    const boundCref = elementBinding.crefImages.find(isHttpRef);
    const boundSref = elementBinding.srefImages.find(isHttpRef);

    const effectiveSeed = (previewSeedImage && typeof previewSeedImage === 'string' ? previewSeedImage : '') || boundSref || '';
    if (effectiveSeed) {
      orchestrator.setPreviewSeedImage(effectiveSeed);
      if (!previewSeedImage && boundSref) send('status', { message: '多参:风格元素已锚定整片画风 (sref)' });
    }

    // v9.4.6 收尾: 多参「场景/道具」元素 → 分镜构图附加参考(低优先, 不挤占角色/画风锚)
    const boundSceneRefs = [...elementBinding.sceneImages, ...elementBinding.propImages].filter(isHttpRef);
    if (boundSceneRefs.length) {
      orchestrator.setSceneReferences(boundSceneRefs);
      send('status', { message: `多参:${boundSceneRefs.length} 个场景/道具元素已挂为构图参考` });
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
          .map((c: any) => {
            // v2.12 Sprint A.2: 透传 traits — 严格白名单校验,挡掉任意 JSON 注入
            const t = c?.traits;
            const safeTraits = (t && typeof t === 'object' && !Array.isArray(t))
              ? {
                  name: typeof t.name === 'string' ? t.name.slice(0, 40) : '',
                  gender: ['male', 'female', 'unknown'].includes(t.gender) ? t.gender : 'unknown',
                  ageGroup: ['童年', '少年', '青年', '中年', '老年', '未明示'].includes(t.ageGroup) ? t.ageGroup : '未明示',
                  build: typeof t.build === 'string' ? t.build.slice(0, 60) : '未明示',
                  skinTone: typeof t.skinTone === 'string' ? t.skinTone.slice(0, 30) : '未明示',
                  appearance: typeof t.appearance === 'string' ? t.appearance.slice(0, 100) : '未明示',
                  costume: typeof t.costume === 'string' ? t.costume.slice(0, 100) : '未明示',
                  personality: typeof t.personality === 'string' ? t.personality.slice(0, 60) : '未明示',
                  signature: typeof t.signature === 'string' ? t.signature.slice(0, 60) : '未明示',
                  confident: t.confident === true,
                }
              : undefined;
            return {
              name: String(c.name).trim().slice(0, 40),
              role: ['lead', 'antagonist', 'supporting', 'cameo'].includes(c.role) ? c.role : 'lead',
              cw: Number.isFinite(c.cw) ? Math.max(25, Math.min(125, Math.round(c.cw))) : 100,
              imageUrl: String(c.imageUrl),
              ...(safeTraits ? { traits: safeTraits } : {}),
            };
          })
      : [];
    if (!effectiveCameoRef && sanitizedLocked.length > 0) {
      effectiveCameoRef = sanitizedLocked[0].imageUrl;
    }
    if (!effectiveCameoRef) {
      try {
        const row = db.prepare('SELECT primary_character_ref FROM projects WHERE id = ?').get(projectId) as { primary_character_ref?: string } | undefined;
        if (row?.primary_character_ref) effectiveCameoRef = row.primary_character_ref;
      } catch {}
    }
    // v9.4.6: 多参「角色」元素兜底 → cref (用户没显式锁角色时, 多参角色图自动锁主角)
    // v9.4.9: 同时把该角色元素的强度 (weight) 作为 cref cw 覆盖
    if (!effectiveCameoRef && boundCref) {
      effectiveCameoRef = boundCref;
      const cw = elementBinding.primaryCharacterWeight;
      if (typeof cw === 'number') orchestrator.setPrimaryCharacterCw(cw);
      send('status', { message: `多参:角色元素已锁主角 (cref + DNA${typeof cw === 'number' ? `, cw ${cw}` : ''})` });
    }
    // v12.56.0 广告题材:产品/角色参考图自动抠净背景 → 锁主体跨镜复用保一致(电商核心痛点)。
    // gated:仅「商业题材 + 抠图后端可用(rembg/BG_REMOVAL_URL)」才抠;否则原样,零行为改动。非阻塞。
    // 注:抠图产物喂外部引擎需公网可达 → 生产建议 STORAGE_DRIVER=s3(local 仅 UI/本地合成可用)。
    if (effectiveCameoRef) {
      try {
        const { isCommercialIdea } = await import('@/lib/end-card');
        const { bgRemovalAvailable, prepProductReferences } = await import('@/lib/image-tools/bg-removal');
        if (isCommercialIdea(idea) && bgRemovalAvailable()) {
          const [cut] = await prepProductReferences([effectiveCameoRef]);
          if (cut && cut !== effectiveCameoRef) {
            effectiveCameoRef = cut;
            send('status', { message: '产品参考图已抠净背景 → 锁主体跨镜复用保一致' });
          }
        }
      } catch (e) { console.warn('[create] 产品抠图预处理失败(非阻塞):', e instanceof Error ? e.message : e); }
    }
    if (effectiveCameoRef) {
      orchestrator.setPrimaryCharacterRef(effectiveCameoRef);
    }

    // v2.12 Phase 2: 把 sanitizedLocked 注入 orchestrator,启用 per-shot 角色路由。
    // 必须在 runDirector / runCharacterDesigner 之前调用。
    if (sanitizedLocked.length > 0) {
      orchestrator.setLockedCharacters(sanitizedLocked);
    }

    // v2.11 #4 Writer-Editor 闭环: 把 projectId 注入 orchestrator,
    // 让 runWriter 能查历史评分、runEditor 完成后能写回评分。
    orchestrator.setProjectId(projectId);

    // 获取第一个可用用户ID（如果没有用户则创建一个）—— 提到 try 外, 后续阶段也要用
    let userId = 'WM-U2zcG9DmjuJ06NS9D9'; // 默认使用已存在的用户
    try {
      const user = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
      if (user) {
        userId = user.id;
      } else {
        // 如果没有用户，创建一个默认用户 (v9.0.2: 走 user-repo, 双驱动; 仅 users 全空时兜底)
        const demo = await createUser({ email: 'demo@qfmanju.ai', passwordHash: 'dummy', name: '演示用户', role: 'user' });
        userId = demo.id;
        console.log(`[DB] Created default user: ${userId}`);
      }
      orchestrator.setUserId(userId); // v12.4.0: 注入计费用户,主管线视频/图像成本得以落库

      const existing = await getProject(projectId);
      // v2.12 Phase 1: 把 lockedCharacters[] 持久化到 projects.locked_characters
      // (单一角色仍同步进 primary_character_ref,见上方 effectiveCameoRef 逻辑)
      // v2.12 Sprint A.3: 同步 upsert 到 global_assets,跨项目复用 Character Bible
      const lockedJson = sanitizedLocked.length > 0 ? JSON.stringify(sanitizedLocked) : '[]';
      // 推迟到 INSERT/UPDATE 后再 upsert bible(需要 projectId 已存在)
      const bibleUpsertList: Array<{ name: string; role: 'lead' | 'antagonist' | 'supporting' | 'cameo'; cw: number; imageUrl: string; traits?: any }> = sanitizedLocked;
      if (!existing) {
        // v9.0.2: 走 project-repo (双驱动) — 创作管线建项目, 带 style/cameo/locked
        await insertProjectFull({
          id: projectId, userId, title: idea.slice(0, 30), description: idea,
          coverUrls: [], status: 'active',
          aspect: aspect || '16:9', // v10.6.0 项目级画幅(注:题材触发的 orchestrator 内部自动竖屏翻转不回写,以用户显式选择为准)
          styleId: style || null, primaryCharacterRef: effectiveCameoRef || null,
          lockedCharacters: sanitizedLocked,
        });
        console.log(`[DB] Project created: ${projectId}${style ? ` (style=${style})` : ''}${sanitizedLocked.length ? ` lockedChars=${sanitizedLocked.length}` : ''}`);
      } else {
        // 已存在就 UPDATE —— 用户可能在同一个 projectId 下换了风格重跑
        // v9.0.2: 走 project-repo; style_id COALESCE 语义保留 (仅传了 style 才覆盖)
        try {
          await updateProjectById(projectId, {
            ...(style ? { style_id: style } : {}),
            ...(aspect ? { aspect } : {}), // v10.6.0 换画幅重跑时同步
            locked_characters: lockedJson,
            ...(effectiveCameoRef ? { primary_character_ref: effectiveCameoRef } : {}),
          });
          await upsertLockedCharacters(projectId, sanitizedLocked); // v12.2.5 双写归一表(重跑路径)
        } catch (e) {
          console.warn(`[DB] style/locked_characters update failed for ${projectId}:`, e);
        }
        console.log(`[DB] Project exists: ${projectId}${style ? ` (style updated=${style})` : ''}${sanitizedLocked.length ? ` lockedChars=${sanitizedLocked.length}` : ''}`);
      }

      // v2.12 Sprint A.3: 项目落库后,把每个 lockedCharacter upsert 到 global_assets(Character Bible)
      // 失败不阻塞主流程 — 这只是跨项目记忆增强,即使写不进库,本项目仍能正常生成
      if (bibleUpsertList.length > 0) {
        try {
          const { upsertCharacterBible } = await import('@/lib/repos/global-asset-repo'); // v9.0.3b: async, 双驱动
          for (const c of bibleUpsertList) {
            try {
              await upsertCharacterBible({
                userId,
                projectId,
                name: c.name,
                bible: {
                  role: c.role,
                  cw: c.cw,
                  imageUrl: c.imageUrl,
                  traits: c.traits ?? null,
                  sampleFaces: [c.imageUrl],
                },
              });
            } catch (e) {
              console.warn(`[Bible] upsert failed for ${c.name}:`, e instanceof Error ? e.message : e);
            }
          }
          console.log(`[Bible] upserted ${bibleUpsertList.length} character bible(s) for project ${projectId}`);
        } catch (e) {
          console.warn('[Bible] module import failed:', e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error('[DB] Project creation failed:', e);
      send('error', { message: '项目创建失败，请重试' });
      return;
    }

    send('agents', orchestrator.getAllAgents());
    send('projectId', { projectId });

    // ── v10.4.2 幂等续跑:attempt>1 时装载已有产物,后续各阶段「有则跳过」(不重复生成/计费)──
    const cp: PipelineCheckpoints = opts?.resume ? await loadCheckpoints(projectId) : emptyCheckpoints();
    if (opts?.resume) {
      console.log(`[Resume] ${projectId} 断点装载: ${checkpointSummary(cp)}`);
      send('status', { message: `[续跑] 已装载断点产物:${checkpointSummary(cp)}` });
    }

    // ── 1. Director ──
    if (cp.plan) {
      plan = cp.plan;
      send('step', { step: 'director' });
      send('status', { message: '[续跑] 导演计划已就绪,跳过' });
      send('plan', plan);
    } else if (replicaScript && Array.isArray(replicaScript.shots) && replicaScript.shots.length) {
      // v11.1.2 拉片复刻:从替换后的 shots 合成 plan(角色/场景取真实替换值),
      // 跳过 Director —— 它只拿到「基于拉片结构复刻」synopsis 会回退占位角色,渲染错主体
      const { buildReplicaPlan } = await import('./pull-sheet-replace');
      plan = buildReplicaPlan(
        (replicaScript.shots as any[]).map((sh) => ({ characters: sh.characters || [], scene: sh.sceneDescription || '' })),
        { style: style || '' },
      );
      send('step', { step: 'director' });
      send('status', { message: '拉片复刻:按原片结构合成导演计划(跳过创意导演)...' });
      send('plan', plan);
      await saveAsset(projectId, 'plan', '导演计划', plan);
    } else try {
      send('step', { step: 'director' });
      send('status', { message: 'AI 导演正在分析创意...' });
      plan = await orchestrator.runDirector(idea);
      // v10.4.2: 计划落库 —— 此前只在内存,续跑会被迫重跑导演(多一次 LLM 计费)
      await saveAsset(projectId, 'plan', '导演计划', plan);
      send('agents', orchestrator.getAllAgents());
      send('plan', plan);
    } catch (e) {
      console.error('[Stream] Director failed:', e);
      send('status', { message: '导演分析出错，使用默认计划...' });
    }

    if (!plan) { send('error', { message: '导演计划生成失败' }); return; }

    // ── 1.5 Style Bible ── v2.20 P0.1: 渲染 1 张全片视觉锚点帧
    if (cp.styleBibleUrl) {
      send('step', { step: 'styleBible' });
      send('styleBible', { url: cp.styleBibleUrl });
      send('status', { message: '[续跑] Style Bible 已就绪,跳过' });
    } else try {
      send('step', { step: 'styleBible' });
      send('status', { message: '渲染 Style Bible 帧 — 锁定全片画风...' });
      const bibleUrl = await orchestrator.runStyleBibleArtist(plan);
      if (bibleUrl) {
        send('styleBible', { url: bibleUrl });
        await saveAsset(projectId, 'styleBible', 'Style Bible Key Art', { url: bibleUrl });
      }
    } catch (e) {
      console.warn('[Stream] Style Bible 渲染失败, 继续走老路径:', e);
    }

    // ── 2. Writer ──
    if (cp.script) {
      script = cp.script;
      send('step', { step: 'writer' });
      send('status', { message: '[续跑] 剧本已就绪,跳过' });
      send('script', script);
      orchestrator.setWriterScript(script);
    } else if (replicaScript && Array.isArray(replicaScript.shots) && replicaScript.shots.length) {
      // v11.1.2 拉片复刻:用预构脚本,跳过 Writer 创意(保原片镜头结构/时长)
      script = replicaScript;
      send('step', { step: 'writer' });
      send('status', { message: '拉片复刻:按原片结构构建脚本(跳过创意编剧)...' });
      send('script', script);
      await saveAsset(projectId, 'script', '剧本', { synopsis: script.synopsis, title: script.title, shots: script.shots, theme: (script as any).theme });
      orchestrator.setWriterScript(script);
    } else try {
      send('step', { step: 'writer' });
      send('status', { message: 'AI 编剧正在运用麦基方法论创作剧本...' });
      script = await orchestrator.runWriter(plan);

      // v12.65.0 广告合规:商业题材台词过《广告法》红线(最/第一/根治…自动替换安全表达)。
      // 台词会被烧成字幕 + TTS 成旁白 → 必须在落地前净化;非商业题材零改动。
      try {
        const { isCommercialIdea } = await import('@/lib/end-card');
        if (isCommercialIdea(idea) && Array.isArray((script as any)?.shots)) {
          const { sanitizeScriptDialogues } = await import('@/lib/ad-compliance');
          const hits = sanitizeScriptDialogues((script as any).shots);
          if (hits.length > 0) {
            console.warn(`[create] v12.65 广告合规净化 ${hits.length} 处: ${hits.slice(0, 5).map((h) => h.word).join('、')}`);
            send('status', { message: `⚖️ 广告合规:已替换 ${hits.length} 处违禁用语(${[...new Set(hits.map((h) => h.category))].join('/')})` });
          }
        }
      } catch (e) { console.warn('[create] 广告合规检查失败(非阻塞):', e instanceof Error ? e.message : e); }

      send('agents', orchestrator.getAllAgents());
      send('script', script);
      await saveAsset(projectId, 'script', '剧本', { synopsis: script.synopsis, title: script.title, shots: script.shots, theme: (script as any).theme });
      // v2.13.5 修复"角色/场景设计与剧本无关"的核心一步:
      // 把 Writer 产出的真实剧本注入 orchestrator,后续 Character/Scene 设计器
      // 在 idea-input 路径下也能拿到"真剧情",而不是只有 Director plan 的占位描述。
      orchestrator.setWriterScript(script);
    } catch (e) {
      console.error('[Stream] Writer failed:', e);
      send('status', { message: '编剧创作出错，继续下一步...' });
    }

    if (!script) { send('error', { message: '剧本生成失败' }); return; }

    // ── Gate: after-script ──
    if (enableGates) {
      const gateResult = await orchestrator.waitForGate('after-script', { script, plan });
      if (gateResult?.action === 'edit' && gateResult.editedData) {
        script = gateResult.editedData;
        send('script', script);
      }
    }

    // ── 3 + 4. Character Designer 和 Scene Designer 并行 ──
    // v2.18: 这两步互不依赖, 都只需要 plan + script. 并行可省 30-60s 创作时长。
    // gates 模式下保持串行 (after-characters gate 语义依赖顺序)。
    const runCharacterStep = async () => {
      if (cp.characters.length > 0) {
        send('characters', cp.characters);
        send('status', { message: `[续跑] 角色已就绪(×${cp.characters.length}),跳过重绘` });
        return cp.characters;
      }
      try {
        send('status', { message: 'AI 角色设计师正在绘制角色三视图...' });
        const result = await orchestrator.runCharacterDesigner(plan.characters);
        send('agents', orchestrator.getAllAgents());
        send('characters', result);
        // 保存角色图片到资产库（直接带上 mediaUrls，不依赖二次 UPDATE）
        for (const c of result as any[]) {
          const mediaUrls = c.imageUrl && !c.imageUrl.startsWith('data:') ? [c.imageUrl] : [];
          await saveAsset(projectId, 'character', c.character || c.name, {
            description: c.description || c.prompt || '',
            appearance: c.appearance || '',
          }, mediaUrls);
        }
        // v2.11 #2: 同时写入用户的全局角色库 (global_assets)
        try {
          const { listGlobalAssets, createGlobalAsset, updateGlobalAsset, recordAssetUsage } = await import('@/lib/repos/global-asset-repo'); // v9.0.3b: async, 双驱动
          const existing = await listGlobalAssets({ userId, type: 'character', limit: 200, offset: 0 });
          let saved = 0;
          for (const c of result) {
            const charName = c.character || c.name;
            if (!charName) continue;
            const thumbUrl = c.imageUrl && !c.imageUrl.startsWith('data:') ? c.imageUrl : '';
            const found = existing.find((a: any) => a.name === charName);
            if (found) {
              const updates: any = {};
              if (!found.thumbnail && thumbUrl) updates.thumbnail = thumbUrl;
              if (c.description && c.description.length > (found.description || '').length) {
                updates.description = c.description;
              }
              if (Object.keys(updates).length > 0) {
                await updateGlobalAsset(found.id, userId, updates);
              }
              await recordAssetUsage(found.id, userId, projectId);
            } else {
              await createGlobalAsset({
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
        return result;
      } catch (e) {
        console.error('[Stream] Character Designer failed:', e);
        send('status', { message: '角色设计出错，继续下一步...' });
        return [] as any[];
      }
    };

    const runSceneStep = async () => {
      if (cp.scenes.length > 0) {
        send('scenes', cp.scenes);
        send('status', { message: `[续跑] 场景已就绪(×${cp.scenes.length}),跳过重绘` });
        return cp.scenes;
      }
      try {
        send('status', { message: 'AI 场景设计师正在设计场景概念图...' });
        // v2.13.5: 用 Writer 的 shots 把 plan.scenes 的 description 加厚
        const enrichedScenes = enrichScenesFromWriterScript(plan.scenes, script);
        const result = await orchestrator.runSceneDesigner(enrichedScenes);
        send('agents', orchestrator.getAllAgents());
        send('scenes', result);
        // 保存场景图片到资产库（过滤 mock data URI）
        for (const s of result as any[]) {
          const mediaUrls = s.imageUrl && !s.imageUrl.startsWith('data:') ? [s.imageUrl] : [];
          await saveAsset(projectId, 'scene', s.name, { description: s.description, location: s.name }, mediaUrls);
        }
        // v2.11 #2: 场景同步登记到全局场景库
        try {
          const { listGlobalAssets, createGlobalAsset, updateGlobalAsset, recordAssetUsage } = await import('@/lib/repos/global-asset-repo'); // v9.0.3b: async, 双驱动
          const existing = await listGlobalAssets({ userId, type: 'scene', limit: 300, offset: 0 });
          for (const s of result) {
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
              if (Object.keys(updates).length > 0) await updateGlobalAsset(found.id, userId, updates);
              await recordAssetUsage(found.id, userId, projectId);
            } else {
              await createGlobalAsset({
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
        return result;
      } catch (e) {
        console.error('[Stream] Scene Designer failed:', e);
        send('status', { message: '场景设计出错，继续下一步...' });
        return [] as any[];
      }
    };

    send('step', { step: 'design' });
    if (enableGates) {
      // gate 模式: 顺序跑, 保留 after-characters gate
      characters = await runCharacterStep();
      const gateResult = await orchestrator.waitForGate('after-characters', { characters });
      if (gateResult?.action === 'edit' && gateResult.editedData) {
        characters = gateResult.editedData;
        send('characters', characters);
      }
      scenes = await runSceneStep();
    } else {
      // 普通模式: 并行跑, 创作时长省 30-60s
      send('status', { message: '🚀 角色与场景设计并行启动...' });
      const [chars, scns] = await Promise.all([runCharacterStep(), runSceneStep()]);
      characters = chars;
      scenes = scns;
    }

    // ── 5a. Storyboard Planning（纯文本分镜规划）──
    let storyboardPlans: any[] = [];
    if (cp.storyboardPlans.length > 0) {
      storyboardPlans = cp.storyboardPlans;
      send('step', { step: 'storyboardPlan' });
      send('status', { message: `[续跑] 分镜规划已就绪(×${storyboardPlans.length}),跳过` });
      send('storyboardPlans', storyboardPlans);
    } else try {
      send('step', { step: 'storyboardPlan' });
      send('status', { message: 'AI 分镜师正在规划分镜描述...' });
      storyboardPlans = await orchestrator.runStoryboardArtist(script, characters, scenes);
      send('agents', orchestrator.getAllAgents());
      send('storyboardPlans', storyboardPlans);
      // 保存分镜（含图片 URL，如果有的话）
      for (const sb of storyboardPlans as any[]) {
        const mediaUrls = sb.imageUrl && !sb.imageUrl.startsWith('data:') ? [sb.imageUrl] : [];
        await saveAsset(projectId, 'storyboard', `镜头 ${sb.shotNumber}`, {
          description: sb.prompt,
          planData: (sb as any).planData,
          duration: 10,
        }, mediaUrls, sb.shotNumber);
      }
    } catch (e) {
      console.error('[Stream] Storyboard Planning failed:', e);
      send('status', { message: '分镜规划出错，继续下一步...' });
    }

    // ── 5b. 分镜图渲染（2路并发，每张3分钟超时）──
    // 生成每个镜头的分镜图，作为视频生成的 first_frame_image
    // 这是"角色+场景+分镜脚本→镜头"一致性管线的关键环节
    try {
      send('step', { step: 'storyboardRender' });
      // v10.4.2 幂等:只补渲染还没有图的镜头(项目+镜头+阶段粒度)
      const doneShots = new Set(cp.storyboards.map((s: any) => s.shotNumber));
      const pendingPlans = (storyboardPlans as any[]).filter((sb: any) => !doneShots.has(sb.shotNumber));
      if (pendingPlans.length === 0 && cp.storyboards.length > 0) {
        storyboards = cp.storyboards;
        send('status', { message: `[续跑] 分镜图已全部渲染(×${storyboards.length}),跳过` });
      } else {
        if (doneShots.size > 0) send('status', { message: `[续跑] 已有 ${doneShots.size} 镜分镜图,补渲染 ${pendingPlans.length} 镜` });
        send('status', { message: 'AI 分镜师正在渲染分镜图（角色+场景一致性）...' });
        const rendered = await orchestrator.runStoryboardRenderer(pendingPlans, script, characters, scenes);
        storyboards = [...cp.storyboards, ...rendered].sort((a: any, b: any) => (a.shotNumber ?? 0) - (b.shotNumber ?? 0));
      }
      send('agents', orchestrator.getAllAgents());
      send('storyboards', storyboards);
      // 更新分镜资产（添加渲染后的图片URL + Sprint A.1 cameo 痕迹, A.4 仪表盘消费）
      for (const sb of storyboards as any[]) {
        const mediaUrls = sb.imageUrl && !sb.imageUrl.startsWith('data:') ? [sb.imageUrl] : [];
        await saveAsset(projectId, 'storyboard', `镜头 ${sb.shotNumber}`, {
          description: sb.prompt,
          planData: (sb as any).planData,
          duration: 10,
          // v2.12 Sprint A.4: cameo retry 痕迹落库, 详情页"分镜" tab 直接读 data 渲染徽章
          cameoScore: sb.cameoScore,
          cameoRetried: sb.cameoRetried,
          cameoAttempts: sb.cameoAttempts,
          cameoFinalCw: sb.cameoFinalCw,
          cameoReason: sb.cameoReason,
          cameoNeedsReview: sb.cameoNeedsReview, // v12.2.8 待人工复核标记
        }, mediaUrls, sb.shotNumber);
      }
    } catch (e) {
      console.error('[Stream] Storyboard Rendering failed:', e);
      send('status', { message: '分镜图渲染出错，使用文本分镜继续...' });
      storyboards = storyboardPlans;
      send('storyboards', storyboards);
    }

    send('step', { step: 'video' });
    // ── 6. Video Producer（角色图+场景图+分镜脚本→Veo，增强一致性）──
    // SSE 心跳：视频生成耗时长，定期发送心跳防止连接超时
    const heartbeatInterval = setInterval(() => {
      try { send('heartbeat', { ts: Date.now() }); } catch {}
    }, 15000); // 每15秒一次心跳

    try {
      const activeProvider = videoProvider || 'veo';
      const providerLabel = activeProvider === 'veo' || activeProvider === 'veo3.1' ? 'Veo 3.1' : 'Minimax';
      // v10.4.2 幂等:只补生成还没有视频的镜头
      const doneVideoShots = new Set(cp.videos.map((v: any) => v.shotNumber));
      const pendingBoards = (storyboards as any[]).filter((sb: any) => !doneVideoShots.has(sb.shotNumber));
      if (pendingBoards.length === 0 && cp.videos.length > 0) {
        videos = cp.videos;
        send('status', { message: `[续跑] 镜头视频已全部生成(×${videos.length}),跳过` });
      } else {
        if (doneVideoShots.size > 0) send('status', { message: `[续跑] 已有 ${doneVideoShots.size} 镜视频,补生成 ${pendingBoards.length} 镜` });
        send('status', { message: `AI 视频制作正在逐条生成视频（${providerLabel}，共 ${pendingBoards.length} 个镜头）...` });
        const made = await orchestrator.runVideoProducer(pendingBoards, activeProvider, characters, scenes, script);
        videos = [...cp.videos, ...made].sort((a: any, b: any) => (a.shotNumber ?? 0) - (b.shotNumber ?? 0));
      }
      send('agents', orchestrator.getAllAgents());
      send('videos', videos); // 发送完整视频列表（前端可能已通过 videoClip 逐条收到）
      // 保存镜头视频和封面图到资产库
      for (const v of videos as any[]) {
        if (v.videoUrl && !v.videoUrl.startsWith('data:')) {
          const mediaUrls = [v.videoUrl];
          if (v.coverImageUrl) mediaUrls.push(v.coverImageUrl);
          await saveAsset(projectId, 'video', `视频 ${v.shotNumber}`, {
            duration: v.duration || 5,
            status: v.status,
            coverImageUrl: v.coverImageUrl || null,
          }, mediaUrls, v.shotNumber);
        }
      }
    } catch (e) {
      console.error('[Stream] Video Producer failed:', e);
      send('status', { message: '视频生成出错，继续下一步...' });
    } finally {
      clearInterval(heartbeatInterval);
    }

    // ── 7. Editor（含配乐生成）──
    if (cp.hasFinalVideo) {
      editResult = cp.editResult;
      send('step', { step: 'editor' });
      send('status', { message: '[续跑] 已有成片,跳过剪辑合成' });
      if (editResult) send('editResult', editResult);
    } else try {
      send('step', { step: 'editor' });
      send('status', { message: 'AI 剪辑师正在剪辑合成完整视频并生成配乐...' });
      editResult = await orchestrator.runEditor(videos, script);
      send('agents', orchestrator.getAllAgents());
      send('editResult', editResult);
      await saveAsset(projectId, 'timeline', '剪辑时间线', editResult);
      // 保存最终成片视频URL
      if (editResult.finalVideoUrl) {
        await saveAsset(projectId, 'final_video', '最终成片', { duration: editResult.totalDuration, hasBgm: !!(editResult as any).hasBgm, hasVoiceover: !!(editResult as any).hasVoiceover, audible: !!((editResult as any).hasBgm || (editResult as any).hasVoiceover) }, [editResult.finalVideoUrl]);
      }
      // 保存配乐
      if (editResult.musicUrl) {
        await saveAsset(projectId, 'music', '背景配乐', { duration: editResult.totalDuration }, [editResult.musicUrl]);
      }
      // v12.66.0 成片质检报告(质量防线事件账本:哪些镜被重生/兜底、健康分)
      if ((editResult as any).qualityReport) {
        await saveAsset(projectId, 'quality_report', '成片质检报告', (editResult as any).qualityReport);
      }

      // ── v2.11 #4 Writer-Editor 闭环: Editor 成片后对最终视频打 3 维分 ──
      // 异步跑(fire-and-forget),不阻塞下一步的 Producer Review
      // 结果会写进 project_quality_scores,下次 runWriter 时自动读取
      if (editResult.finalVideoUrl) {
        scoreFinalVideo(editResult.finalVideoUrl, 4)
          .then(async (score) => {
            if (!score) return;
            try {
              const row = await insertQualityScore({
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
    if (cp.review) {
      review = cp.review;
      send('step', { step: 'review' });
      send('status', { message: '[续跑] 审核结论已就绪,跳过' });
      send('review', review);
    } else try {
      send('step', { step: 'review' });
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
        for (const v of finalVideos as any[]) { await updateAssetMedia(projectId, 'video', `视频 ${v.shotNumber}`, [v.videoUrl], v.shotNumber); }

        // 二次审核
        send('status', { message: 'AI 导演正在进行二次审核...' });
        const review2 = await orchestrator.runDirectorReview(script, finalVideos, editResult);
        send('review', review2);
        try { await updateProjectById(projectId, { director_notes: JSON.stringify(review2) }); } catch {}
      } catch (e) {
        console.error('[Stream] Review feedback failed:', e);
      }
    } else if (review) {
      try { await updateProjectById(projectId, { director_notes: JSON.stringify(review) }); } catch {}
    }

    send('step', { step: 'finalize' });
    // ── 10. 完成 ── (v9.0.2: 走 project-repo, 双驱动)
    try {
      const coverUrl = finalStoryboards[0]?.imageUrl || '';
      await updateProjectById(projectId, {
        status: 'completed',
        cover_urls: JSON.stringify([coverUrl]),
        script_data: JSON.stringify(script),
      });
    } catch {}

    // v12.32.0:阶段耗时归因 —— 收尾汇总,发 stageTiming(用 emit 直发,避免被 send 的 step 计时逻辑误判)。
    _stageTimer.endAll();
    const stageTiming = _stageTimer.breakdown();
    emit('stageTiming', stageTiming);
    console.log('[StageTiming]', summarizeTiming(stageTiming));

    send('complete', { projectId, plan, script, characters, scenes, storyboards: finalStoryboards, videos: finalVideos, editResult, review, stageTiming });

  } catch (error) {
    console.error('[Stream] Fatal error:', error);
    const payload = toSsePayload(error);
    // 兼容旧客户端: 同时发 { message } 与结构化 {code,userMsg,retryable,stage}
    send('error', { ...payload, message: payload.userMsg });
  } finally {
    // Clean up the orchestrator from the active map
    activeOrchestrators.delete(projectId);
  }

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
// v9.0.1b: async + 走 asset-repo (双驱动). 调用方需 await (各 forEach 已改 for...of)。
// INSERT 同步落库 (persistent_url 留空) 仍是毫秒级, 不拖 SSE; 慢的是后台 persistFirstValid 落盘,
// 那一步保持 fire-and-forget (await 只覆盖 INSERT, 不覆盖 fetch)。
async function saveAsset(projectId: string, type: string, name: string, data: any, mediaUrls?: string[], shotNumber?: number): Promise<void> {
  try {
    // 先检查项目是否存在 (projects 表读 — v9.0.2 再迁, 此处保持 raw)
    const projectExists = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) {
      console.error(`[DB] Cannot save asset: project ${projectId} does not exist`);
      return;
    }

    // v10.4.2: 幂等写 —— 同 (type, shot|name) 不再重复 INSERT(续跑/重跑自然去重)
    const action = await upsertAsset({
      projectId, type, name, data: data || {},
      mediaUrls: mediaUrls || [], shotNumber: shotNumber ?? null,
    });
    console.log(`[DB] Asset ${action === 'created' ? 'saved' : 'upserted'}: ${type}/${name}`);

    // 后台持久化第一张有效 URL, 不 await —— 慢 fetch 不能阻塞 SSE 流
    if (mediaUrls && mediaUrls.length > 0) {
      const sel = shotNumber != null ? { type, shotNumber } : { type, name };
      void persistFirstValid(mediaUrls).then(async (url) => {
        if (!url) return;
        try {
          await updateAssetBySelector(projectId, sel, { persistentUrl: url });
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

async function updateAssetMedia(projectId: string, type: string, name: string, mediaUrls: string[], shotNumber?: number): Promise<void> {
  try {
    // v9.0.1b: 按 (type, shot|name) 选中更新 media_urls
    const sel = shotNumber ? { type, shotNumber } : { type, name };
    const changes = await updateAssetBySelector(projectId, sel, { mediaUrls });

    if (changes > 0) {
      console.log(`[DB] Asset media updated: ${type}/${name}`);
    } else {
      console.log(`[DB] Asset not found for update: ${type}/${name}`);
      return;
    }

    // 后台刷新 persistent_url (新 URL 可能是不同的 CDN, 重新抓一份)
    if (mediaUrls.length > 0) {
      void persistFirstValid(mediaUrls).then(async (url) => {
        if (!url) return;
        try {
          await updateAssetBySelector(projectId, sel, { persistentUrl: url });
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

