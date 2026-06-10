/**
 * lib/pipeline-checkpoints (v10.4.2) — 流水线断点装载(幂等续跑的「读」侧)。
 *
 * 续跑(job attempts > 1)时,各阶段先看这里有没有已落库产物:有则装载 + 跳过
 * 重新生成(不重复计费),没有才真跑。「写」侧配对改动 = saveAsset 走 upsertAsset。
 *
 * 形状还原约定(与 create-pipeline 各阶段落库时的字段一一对应):
 *   plan        ← type 'plan'(v10.4.2 新增落库,导演计划此前只在内存)
 *   script      ← type 'script' { synopsis,title,shots,theme }
 *   characters  ← type 'character'[] { name, description, appearance } + 图
 *   scenes      ← type 'scene'[] { name, description } + 图
 *   storyboards ← type 'storyboard'[] { description→prompt, planData, duration, cameo* } + 图
 *                  有图 = 已渲染;无图 = 仅规划(storyboardRender 只补渲染缺图镜头)
 *   videos      ← type 'video'[] { duration,status,coverImageUrl } + 片
 *   editResult  ← type 'timeline' data + hasFinalVideo ← type 'final_video' 存在性
 *   review      ← projects.director_notes(JSON)
 *
 * URL 取用优先 persistent_url(外链/tmp 会过期,本地副本稳定 —— 见 asset-repo 注释)。
 * 仅服务端;轻依赖(asset-repo + db),可单测不拖 orchestrator。
 */
import { listAssetsByType, type AssetRow } from './repos/asset-repo';
import { db } from './db';

export interface PipelineCheckpoints {
  plan: any | null;
  script: any | null;
  styleBibleUrl: string;
  characters: any[];
  scenes: any[];
  /** 已渲染分镜(有图)。 */
  storyboards: any[];
  /** 全部分镜规划(含未渲染)。 */
  storyboardPlans: any[];
  videos: any[];
  editResult: any | null;
  hasFinalVideo: boolean;
  review: any | null;
}

export function emptyCheckpoints(): PipelineCheckpoints {
  return {
    plan: null, script: null, styleBibleUrl: '',
    characters: [], scenes: [], storyboards: [], storyboardPlans: [],
    videos: [], editResult: null, hasFinalVideo: false, review: null,
  };
}

function parseData(row: AssetRow): any {
  try { return row.data ? JSON.parse(row.data) : {}; } catch { return {}; }
}

/** persistent_url 优先;否则 media_urls 第一条 http(s)。 */
export function assetUrl(row: AssetRow): string {
  if (row.persistent_url) return row.persistent_url;
  try {
    const urls: string[] = row.media_urls ? JSON.parse(row.media_urls) : [];
    return urls.find((u) => typeof u === 'string' && /^https?:\/\//i.test(u)) || '';
  } catch { return ''; }
}

/** 同 (type, shot|name) 取最新一行(容忍 v10.4.1 时期的历史重复行)。 */
function dedupeLatest(rows: AssetRow[], key: (r: AssetRow) => string): AssetRow[] {
  const map = new Map<string, AssetRow>();
  for (const r of rows) {
    const k = key(r);
    const prev = map.get(k);
    if (!prev || (r.updated_at || '') >= (prev.updated_at || '')) map.set(k, r);
  }
  return Array.from(map.values());
}

export async function loadCheckpoints(projectId: string): Promise<PipelineCheckpoints> {
  const cp = emptyCheckpoints();

  const [planRows, scriptRows, bibleRows, charRows, sceneRows, sbRows, videoRows, finalRows, timelineRows] =
    await Promise.all([
      listAssetsByType(projectId, 'plan'),
      listAssetsByType(projectId, 'script'),
      listAssetsByType(projectId, 'styleBible'),
      listAssetsByType(projectId, 'character'),
      listAssetsByType(projectId, 'scene'),
      listAssetsByType(projectId, 'storyboard'),
      listAssetsByType(projectId, 'video'),
      listAssetsByType(projectId, 'final_video'),
      listAssetsByType(projectId, 'timeline'),
    ]);

  if (planRows.length) cp.plan = parseData(planRows[planRows.length - 1]);
  if (scriptRows.length) {
    const s = parseData(scriptRows[scriptRows.length - 1]);
    // 剧本必须有 shots 才算可续跑的断点(空壳剧本不如重生成)
    if (Array.isArray(s.shots) && s.shots.length > 0) cp.script = s;
  }
  if (bibleRows.length) cp.styleBibleUrl = assetUrl(bibleRows[bibleRows.length - 1]) || (parseData(bibleRows[bibleRows.length - 1]).url ?? '');

  cp.characters = dedupeLatest(charRows, (r) => r.name).map((r) => {
    const d = parseData(r);
    return { name: r.name, character: r.name, description: d.description || '', appearance: d.appearance || '', imageUrl: assetUrl(r) };
  });

  cp.scenes = dedupeLatest(sceneRows, (r) => r.name).map((r) => {
    const d = parseData(r);
    return { name: r.name, description: d.description || '', location: d.location || r.name, imageUrl: assetUrl(r) };
  });

  const sbLatest = dedupeLatest(sbRows, (r) => String(r.shot_number ?? r.name))
    .sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0));
  cp.storyboardPlans = sbLatest.map((r) => {
    const d = parseData(r);
    return {
      shotNumber: r.shot_number ?? 0,
      prompt: d.description || '',
      planData: d.planData,
      duration: d.duration ?? 10,
      imageUrl: assetUrl(r),
      cameoScore: d.cameoScore, cameoRetried: d.cameoRetried, cameoAttempts: d.cameoAttempts,
      cameoFinalCw: d.cameoFinalCw, cameoReason: d.cameoReason,
    };
  });
  cp.storyboards = cp.storyboardPlans.filter((s) => !!s.imageUrl);

  cp.videos = dedupeLatest(videoRows, (r) => String(r.shot_number ?? r.name))
    .map((r) => {
      const d = parseData(r);
      return { shotNumber: r.shot_number ?? 0, videoUrl: assetUrl(r), duration: d.duration ?? 5, status: d.status || 'completed', coverImageUrl: d.coverImageUrl ?? null };
    })
    .filter((v) => !!v.videoUrl)
    .sort((a, b) => a.shotNumber - b.shotNumber);

  cp.hasFinalVideo = finalRows.some((r) => !!assetUrl(r));
  if (timelineRows.length) cp.editResult = parseData(timelineRows[timelineRows.length - 1]);

  try {
    const row = db.prepare('SELECT director_notes FROM projects WHERE id = ?').get(projectId) as { director_notes?: string } | undefined;
    if (row?.director_notes) cp.review = JSON.parse(row.director_notes);
  } catch { /* ignore */ }

  return cp;
}

/** 续跑摘要(日志/SSE status 用)。 */
export function checkpointSummary(cp: PipelineCheckpoints): string {
  const parts: string[] = [];
  if (cp.plan) parts.push('计划');
  if (cp.script) parts.push('剧本');
  if (cp.characters.length) parts.push(`角色×${cp.characters.length}`);
  if (cp.scenes.length) parts.push(`场景×${cp.scenes.length}`);
  if (cp.storyboards.length) parts.push(`分镜图×${cp.storyboards.length}`);
  if (cp.videos.length) parts.push(`视频×${cp.videos.length}`);
  if (cp.hasFinalVideo) parts.push('成片');
  return parts.length ? parts.join(' / ') : '无';
}
