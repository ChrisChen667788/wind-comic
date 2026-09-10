import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { createProject } from '@/lib/repos/project-repo';
import { safeJsonParse } from '@/lib/safe-json';
import { resolveProjectCovers } from '@/lib/project-cover';
import { isPlaceholderAsset, placeholderPrefilterSql } from '@/lib/placeholder-provenance';

export async function GET(request: Request) {
  // v12.218(安全止血):删「回落 DB 第一个用户」—— 匿名即得他人项目列表。无 token → 401。
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  // 一次查询: 项目本表 + 最新 script asset 的 data (子查询).
  // 这样列表页就能拿到 latestPolish 渲染就绪度徽章, 而不必每张卡再发一次请求。
  // v12.426:封面改「读时解析」——冻结的 cover_urls 只是候选之一。
  // 顺带把「用户定版封面」和「本项目仍活着的一张分镜」一起带出来,免得每张卡再发请求。
  const rows = db.prepare(`
    SELECT p.*, (
      SELECT data FROM project_assets
      WHERE project_id = p.id AND type = 'script'
      ORDER BY updated_at DESC LIMIT 1
    ) AS script_asset_data, (
      SELECT media_urls FROM project_assets
      WHERE project_id = p.id AND type = 'chosen-cover'
        AND media_urls IS NOT NULL AND media_urls NOT IN ('', '[]')
      ORDER BY updated_at DESC LIMIT 1
    ) AS chosen_cover_media, (
      -- 排序两件事都要:
      --  · shot_number ASC —— 封面按惯例取第 1 镜,不是随便一张;
      --  · updated_at DESC —— 同一镜在库里常有两行,空的那行 updated_at 更早,
      --    真画面在后来「重生」的行里(实测赤马斩龙:每镜都有 2026-06 的空行 +
      --    2026-08 的真行)。只按 created_at 取会稳定取到死的那条。
      -- 取值优先 persistent_url:那是 /api/serve-file?key=… 的永久形态,
      -- 而 media_urls 里可能是会过期的引擎签名链(实测 6 个项目的封面就是这么死的)。
      SELECT group_concat(u, char(10)) FROM (
        SELECT COALESCE(NULLIF(persistent_url, ''), media_urls) AS u
        FROM project_assets
        WHERE project_id = p.id AND type = 'storyboard'
          AND (
            (persistent_url IS NOT NULL AND persistent_url <> '')
            OR (media_urls IS NOT NULL AND media_urls NOT IN ('', '[]'))
          )
        ORDER BY shot_number ASC, updated_at DESC LIMIT 4
      )
    ) AS storyboard_media, (
      SELECT group_concat(u, char(10)) FROM (
        SELECT COALESCE(NULLIF(persistent_url, ''), media_urls) AS u
        FROM project_assets
        WHERE project_id = p.id AND type IN ('final_video', 'video')
          AND (
            (persistent_url IS NOT NULL AND persistent_url <> '')
            OR (media_urls IS NOT NULL AND media_urls NOT IN ('', '[]'))
          )
        ORDER BY shot_number ASC, updated_at DESC LIMIT 3
      )
    ) AS video_media
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as any[];
  // v12.431:列表页也要看得出「这个项目还有几处不是真出图的」。
  // 做法是**两次查询**而不是每个项目查一次(N+1):SQL 只负责把行数收窄
  // (本机 1052 条资产收到 75 条),真正的判断仍在 isPlaceholderAsset —— 判据只能有一处。
  // 预筛必须是判据的**超集**,漏一种形态就等于漏报;两者放在同一个模块里,由测试绑住。
  const phRows = db.prepare(`
    SELECT a.project_id, a.type, a.data, a.media_urls, a.persistent_url
    FROM project_assets a
    JOIN projects p ON p.id = a.project_id
    WHERE p.user_id = ? AND ${placeholderPrefilterSql('a')}
  `).all(userId) as Array<{ project_id: string; type?: string; data?: string; media_urls?: string; persistent_url?: string }>;

  const phByProject = new Map<string, number>();
  for (const a of phRows) {
    if (!isPlaceholderAsset(a)) continue;   // 预筛只是收窄,判断仍走唯一出处
    phByProject.set(a.project_id, (phByProject.get(a.project_id) ?? 0) + 1);
  }

  const data = rows.map((r) => {
    let latestPolish: any = null;
    if (r.script_asset_data) {
      try {
        const parsed = JSON.parse(r.script_asset_data);
        if (parsed && typeof parsed === 'object' && parsed.latestPolish) {
          latestPolish = parsed.latestPolish;
        }
      } catch { /* 该 asset 数据格式异常, 安静跳过 */ }
    }
    // group_concat 出来是多行,每行要么是 media_urls 的 JSON 数组,
    // 要么是 persistent_url 的裸串(COALESCE 两列取一)。两种都要认。
    const urlsOf = (raw: string | null) => (raw || '').split('\n').flatMap((line) => {
      const t = line.trim();
      if (!t) return [];
      if (!t.startsWith('[')) return [t];
      return safeJsonParse<string[]>(t, [], { context: `project_assets.media_urls#${r.id}` });
    });
    const cand = (source: 'chosen' | 'stored' | 'storyboard' | 'video', urls: string[]) =>
      urls.map((url) => ({ source, url }));
    const covers = resolveProjectCovers([
      ...cand('chosen', urlsOf(r.chosen_cover_media)),
      ...cand('stored', safeJsonParse<string[]>(r.cover_urls, [], { context: `projects.cover_urls#${r.id}` })),
      ...cand('storyboard', urlsOf(r.storyboard_media)),
      ...cand('video', urlsOf(r.video_media)),
    ]);

    return {
      id: r.id, title: r.title, description: r.description,
      // v12.305:**列表口不能因为一行坏数据整页 500** —— 一个项目的字段损坏
      // (管道写一半被中断、直接改过 DB、旧格式)此前会让该用户的所有项目一起打不开。
      // v12.426:covers 是**有序候选串**,卡片前一张挂了就换下一张。cover_urls 里有 12 个
      // 项目存的是「出图全挂时的 mock 渐变图」,其中 3 个明明各有 11~12 张真分镜还活着 ——
      // 冻结的快照从来没人重算,现已剔除且不再作封面。
      covers,
      status: r.status,
      scriptData: safeJsonParse<any>(r.script_data, null, { context: `projects.script_data#${r.id}` }),
      directorNotes: safeJsonParse<any>(r.director_notes, null, { context: `projects.director_notes#${r.id}` }),
      latestPolish, // null 或 { mode, audit, summary, at, ... } —— 列表页就能渲染就绪度徽章
      // v12.431:这个项目里有几处不是真出图的(0 就不渲染徽章)
      placeholderCount: phByProject.get(r.id) ?? 0,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { title, description, covers } = body;
  if (!title) return NextResponse.json({ message: 'Missing title' }, { status: 400 });

  // v4.2.2: 走 async project-repo (DbDriver), SQLite/PG 双驱动. 行为不变.
  const p = await createProject({ userId: payload.sub, title, description: description || '', coverUrls: covers || [] });

  return NextResponse.json({
    id: p.id, title: p.title, description: p.description || '',
    covers: safeJsonParse<string[]>(p.cover_urls, [], { context: `projects.cover_urls#${p.id}` }), status: p.status,
    createdAt: p.created_at, updatedAt: p.updated_at,
  }, { status: 201 });
}
