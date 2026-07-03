import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { extractProductBrief, buildIdeaFromBrief } from '@/lib/product-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.70.0 — URL 一键品牌 brief(竞品「贴链接出片」入口的前半程)。
 * POST { url } → 抓商品/品牌页(10s 超时、2MB 上限、仅 http/https)→ 抽 og 元数据 →
 * 返回 { brief, idea }(idea 可直接投 create-stream 起片;不自动起片,由用户确认)。
 */
export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const url: string = (body?.url || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return NextResponse.json({ message: '需要合法 http(s) URL' }, { status: 400 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WindComicBot/1.0)', Accept: 'text/html' },
        redirect: 'follow',
      });
    } finally { clearTimeout(timer); }
    if (!resp.ok) return NextResponse.json({ message: `目标页 HTTP ${resp.status}` }, { status: 422 });

    const reader = resp.body?.getReader();
    let html = '';
    if (reader) {
      const dec = new TextDecoder();
      let bytes = 0;
      while (bytes < 2_000_000) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += dec.decode(value, { stream: true });
      }
      try { await reader.cancel(); } catch { /* done */ }
    } else {
      html = (await resp.text()).slice(0, 2_000_000);
    }

    const brief = extractProductBrief(html);
    if (!brief.title && !brief.description) {
      return NextResponse.json({ message: '页面无可用元数据(og:title/description 均缺失)', brief }, { status: 422 });
    }
    return NextResponse.json({ ok: true, brief, idea: buildIdeaFromBrief(brief) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: `抓取失败: ${msg.slice(0, 120)}` }, { status: 422 });
  }
}
