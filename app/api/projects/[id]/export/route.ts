import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/:id/export?type=mp4|script|characters
 *
 *  - type=mp4        → 302 → /api/serve-file?path=<最终成片>（带 Content-Disposition=attachment 重定向）
 *  - type=script     → 纯文本(txt)下载：标题 + 简介 + 逐镜头剧本
 *  - type=characters → JSON 下载：完整角色表（可外部处理成 xlsx / docx）
 *
 * 轻量实现 — 不引入 docx/xlsx 依赖，保持依赖面干净。
 * 高级格式（PDF / docx / xlsx）由前端 anthropic-skills 或用户自行转换。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const type = request.nextUrl.searchParams.get('type') || 'mp4';

  const project = db.prepare('SELECT id, title FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  if (type === 'mp4') {
    // 查 final_video 资产;若无则回退到 video 资产拼接的第一条
    // v2.9: 优先取 persistent_url —— 外链 24h 过期,持久化副本稳
    const row = db.prepare(
      `SELECT media_urls, persistent_url FROM project_assets
       WHERE project_id = ? AND type IN ('final_video','timeline')
       ORDER BY updated_at DESC LIMIT 1`
    ).get(projectId) as { media_urls: string; persistent_url: string | null } | undefined;

    const urls: string[] = row ? JSON.parse(row.media_urls || '[]') : [];
    const finalUrl = row?.persistent_url || urls[0] || '';
    if (!finalUrl) return NextResponse.json({ error: '成片尚未生成' }, { status: 404 });

    // 对于本地 serve-file URL：直接读文件并以 attachment 返回
    if (finalUrl.startsWith('/api/serve-file')) {
      try {
        const u = new URL(finalUrl, 'http://localhost');
        const localPath = decodeURIComponent(u.searchParams.get('path') || '');
        if (!fs.existsSync(localPath)) return NextResponse.json({ error: 'file missing' }, { status: 404 });
        const stat = fs.statSync(localPath);
        const stream = fs.createReadStream(localPath);
        return new Response(stream as any, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(stat.size),
            'Content-Disposition': `attachment; filename="${encodeURIComponent(project.title || 'project')}.mp4"`,
          },
        });
      } catch (e) {
        return NextResponse.json({ error: 'failed to read final video' }, { status: 500 });
      }
    }

    // 远端 URL：302 让浏览器直接下载
    return NextResponse.redirect(finalUrl, 302);
  }

  if (type === 'script') {
    const sa = db.prepare(
      `SELECT data FROM project_assets WHERE project_id = ? AND type = 'script' ORDER BY updated_at DESC LIMIT 1`
    ).get(projectId) as { data: string } | undefined;
    if (!sa) return NextResponse.json({ error: '剧本尚未生成' }, { status: 404 });

    let script: any = {};
    try { script = JSON.parse(sa.data || '{}'); } catch {}

    const lines: string[] = [];
    lines.push(`# ${script.title || project.title || '未命名作品'}`);
    if (script.synopsis) lines.push('', `简介：${script.synopsis}`);
    if (script.theme) lines.push(`主题：${script.theme}`);
    lines.push('');
    lines.push('═══ 分镜剧本 ═══');
    lines.push('');
    (script.shots || []).forEach((s: any, i: number) => {
      const sn = s.shotNumber || i + 1;
      lines.push(`【镜头 ${sn}】${s.emotion ? `（${s.emotion}）` : ''}${s.duration ? ` ${s.duration}s` : ''}`);
      if (s.sceneDescription) lines.push(`  场景：${s.sceneDescription}`);
      if (s.dialogue) lines.push(`  对白：「${s.dialogue}」`);
      if (s.beat) lines.push(`  节拍：${s.beat}`);
      lines.push('');
    });

    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(project.title || 'script')}.txt"`,
      },
    });
  }

  if (type === 'characters') {
    const rows = db.prepare(
      `SELECT name, data, media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'character'`
    ).all(projectId) as Array<{ name: string; data: string; media_urls: string; persistent_url: string | null }>;

    const characters = rows.map(r => {
      let data: any = {};
      try { data = JSON.parse(r.data || '{}'); } catch {}
      let mediaUrls: string[] = [];
      try { mediaUrls = JSON.parse(r.media_urls || '[]'); } catch {}
      // v2.9: 导出时优先使用持久化副本 —— 用户离线打开 JSON 也能看到图
      const imageUrl = r.persistent_url || mediaUrls[0] || '';
      return { name: r.name, ...data, imageUrl };
    });

    return new Response(JSON.stringify({ project: project.title, characters }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(project.title || 'characters')}-roster.json"`,
      },
    });
  }

  return NextResponse.json({ error: `unknown export type: ${type}` }, { status: 400 });
}
