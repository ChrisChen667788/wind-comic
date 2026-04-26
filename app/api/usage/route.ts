import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { getTierById, PRICING_TIERS } from '@/lib/pricing';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // Fall back to first user in demo mode
  if (!userId) {
    const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    userId = firstUser?.id || 'demo-user';
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Projects created this month
  const projectsThisMonth = (
    db
      .prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND created_at >= ?')
      .get(userId, monthStart) as { count: number }
  ).count;

  // Video generations this month (style != '' implies video/image gen)
  const videoGenerations = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND created_at >= ? AND resource_type = 'video'"
      )
      .get(userId, monthStart) as { count: number } | undefined
  )?.count ?? 0;

  // Image generations this month
  const imageGenerations = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND created_at >= ?"
      )
      .get(userId, monthStart) as { count: number }
  ).count;

  // Characters in library
  const characterCount = (
    db
      .prepare('SELECT COUNT(*) as count FROM character_library WHERE user_id = ?')
      .get(userId) as { count: number }
  ).count;

  // Current subscription
  const subscription = db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ?')
    .get(userId) as {
    id: string;
    tier_id: string;
    status: string;
    started_at: string;
    expires_at: string | null;
  } | null;

  const tierId = subscription?.tier_id ?? 'free';
  const tier = getTierById(tierId) ?? PRICING_TIERS[0];

  return NextResponse.json({
    userId,
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    usage: {
      projectsThisMonth,
      videoGenerations,
      imageGenerations,
      characterCount,
    },
    subscription: {
      tierId,
      tierName: tier.name,
      status: subscription?.status ?? 'active',
      expiresAt: subscription?.expires_at ?? null,
    },
    limits: tier.limits,
  });
}
