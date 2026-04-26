import { NextRequest, NextResponse } from 'next/server';

/**
 * 公开 REST API 鉴权(v1 占位版)
 *
 * 支持两种方式:
 *   1. Header `X-Api-Key: <key>`
 *   2. Header `Authorization: Bearer <key>`
 *
 * Key 来源:环境变量 `API_KEYS`,多个 key 用逗号分隔。空串或未设置 = 全拒。
 *
 * 未来升级:DB 表 `api_keys` 存储 hash + scope + rate-limit。
 */

function getConfiguredKeys(): Set<string> {
  const raw = process.env.API_KEYS || '';
  return new Set(
    raw.split(',').map(s => s.trim()).filter(Boolean)
  );
}

export function extractKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('x-api-key');
  if (headerKey) return headerKey.trim();
  const auth = req.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

/** 返回 401 Response 或 null(通过) */
export function requireApiKey(req: NextRequest): NextResponse | null {
  const configured = getConfiguredKeys();
  if (configured.size === 0) {
    return NextResponse.json(
      { error: 'api_disabled', message: '公开 API 未启用。请设置 API_KEYS 环境变量。' },
      { status: 503 }
    );
  }
  const key = extractKey(req);
  if (!key || !configured.has(key)) {
    return NextResponse.json(
      { error: 'unauthorized', message: '缺少或无效的 API key。使用 X-Api-Key 或 Authorization: Bearer.' },
      { status: 401 }
    );
  }
  return null;
}
