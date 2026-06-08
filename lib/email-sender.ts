/**
 * v3.x P0.3 E.2 — Email notification sender (Resend-compatible, env-optional).
 *
 * 行为契约:
 *   - 没 RESEND_API_KEY → isEnabled() = false, send 不报错只 log skip
 *   - 有 key 但发送 4xx/5xx → throw, 调用方应 catch (notification 是 best-effort)
 *   - 不允许向 placeholder 邮箱 (demo@qfmanju.ai 等 seeded users) 发, 防垃圾
 *
 * 集成时机 (lib/comments.createComment):
 *   - 写完 notification → 异步触发 sendCommentNotificationEmail (best-effort)
 *   - 用户偏好 (users.email_notify_pref) 可关
 *
 * 适配多家邮件服务:
 *   - 默认 Resend (https://resend.com — 简单, 100/day free tier)
 *   - 通过 EMAIL_PROVIDER=sendgrid 切 SendGrid (TODO)
 *   - 通过 EMAIL_PROVIDER=ses 切 AWS SES (TODO)
 */

import { db } from '@/lib/db';

const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_FROM = process.env.EMAIL_FROM || 'Wind Comic <noreply@windcomic.app>';

// 拦截 demo / seed / placeholder 邮箱, 防垃圾邮件
const BLOCKED_EMAIL_PATTERNS = [
  /@qfmanju\.ai$/i,
  /@test\.local$/i,
  /@example\.(com|org)$/i,
  /^demo@/i,
  /^test@/i,
];

export function isEmailEnabled(): boolean {
  if (process.env.EMAIL_DISABLED === '1') return false;
  const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const hasKey = (k?: string) => !!k && !k.startsWith('your_');
  if (provider === 'resend') return hasKey(process.env.RESEND_API_KEY);
  if (provider === 'sendgrid') return hasKey(process.env.SENDGRID_API_KEY);
  return false; // ses 等需额外依赖,见 sendEmail 分发
}

function isBlockedEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return true;
  for (const pat of BLOCKED_EMAIL_PATTERNS) {
    if (pat.test(email)) return true;
  }
  return false;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;     // plain-text fallback for spam filters
  replyTo?: string;
}

export interface EmailSendResult {
  sent: boolean;
  warning?: string;
}

/**
 * 底层发送 — 永不抛, 失败返 { sent: false, warning }.
 */
export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  if (!isEmailEnabled()) {
    return { sent: false, warning: 'EMAIL_DISABLED or no RESEND_API_KEY' };
  }
  if (isBlockedEmail(input.to)) {
    return { sent: false, warning: `blocked email domain: ${input.to}` };
  }
  if (!input.subject || !input.html) {
    return { sent: false, warning: 'subject + html required' };
  }

  const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  switch (provider) {
    case 'resend': return sendViaResend(input);
    case 'sendgrid': return sendViaSendGrid(input);
    case 'ses': return { sent: false, warning: 'EMAIL_PROVIDER=ses 需 AWS SigV4 依赖(未随包,与 Resend/SendGrid 重复故未内置);请用 resend / sendgrid,或自行接 @aws-sdk/client-sesv2' };
    default: return { sent: false, warning: `provider ${provider} not implemented` };
  }
}

async function sendViaResend(input: EmailSendInput): Promise<EmailSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: DEFAULT_FROM, to: input.to, subject: input.subject, html: input.html, text: input.text, reply_to: input.replyTo }),
      signal: controller.signal,
    });
    if (!resp.ok) return { sent: false, warning: `Resend ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 120)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, warning: e instanceof Error ? e.message : 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

// SendGrid v3 mail/send —— 成功返 202(空体)。EMAIL_FROM 支持 "Name <addr>" 解析。
async function sendViaSendGrid(input: EmailSendInput): Promise<EmailSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const m = DEFAULT_FROM.match(/^\s*(.*?)\s*<(.+)>\s*$/);
    const from = m ? { name: m[1], email: m[2] } : { email: DEFAULT_FROM };
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from,
        ...(input.replyTo ? { reply_to: { email: input.replyTo } } : {}),
        subject: input.subject,
        content: [
          ...(input.text ? [{ type: 'text/plain', value: input.text }] : []),
          { type: 'text/html', value: input.html },
        ],
      }),
      signal: controller.signal,
    });
    if (resp.status !== 202 && !resp.ok) return { sent: false, warning: `SendGrid ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 120)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, warning: e instanceof Error ? e.message : 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 给某 user 发评论提醒邮件. 自动:
 *   - 查 users.email
 *   - 查用户偏好 (email_notify_pref 列: 'all' | 'mentions' | 'none')
 *   - 跳过 blocked 邮箱
 */
export async function sendCommentNotificationEmail(input: {
  recipientUserId: string;
  sourceUserName: string;
  projectId: string;
  projectTitle?: string;
  commentId: string;
  preview: string;
  type: 'mention' | 'reply';
}): Promise<EmailSendResult> {
  if (!isEmailEnabled()) return { sent: false, warning: 'email disabled' };

  let user: { email: string; name: string; email_notify_pref?: string } | undefined;
  try {
    user = db.prepare(
      `SELECT email, name, email_notify_pref FROM users WHERE id = ?`,
    ).get(input.recipientUserId) as any;
  } catch (e) {
    // 没 email_notify_pref 列 — 兼容老 schema
    try {
      user = db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(input.recipientUserId) as any;
    } catch { /* ignore */ }
  }
  if (!user?.email) return { sent: false, warning: 'recipient has no email' };
  // 默认偏好 = 'mentions' (只 mention 发, reply 不发) — 防垃圾
  const pref = (user.email_notify_pref || 'mentions').toLowerCase();
  if (pref === 'none') return { sent: false, warning: 'user prefs disabled' };
  if (pref === 'mentions' && input.type !== 'mention') {
    return { sent: false, warning: 'user prefs: mentions only' };
  }

  const host = process.env.NEXT_PUBLIC_APP_HOST || 'http://localhost:3000';
  const projectUrl = `${host}/projects/${encodeURIComponent(input.projectId)}#comment-${encodeURIComponent(input.commentId)}`;
  const projectName = input.projectTitle || `项目 ${input.projectId.slice(0, 8)}`;
  const action = input.type === 'mention' ? '提到了你' : '回复了你';
  const subject = `[Wind Comic] ${input.sourceUserName} ${action} (${projectName})`;
  const safePreview = String(input.preview || '').slice(0, 200).replace(/</g, '&lt;');
  const html = `
    <div style="font-family: -apple-system, sans-serif; line-height: 1.6; max-width: 480px;">
      <h2 style="font-size: 16px; margin: 0 0 12px;">${input.sourceUserName} ${action}</h2>
      <p style="color: #555; margin: 0 0 8px;">在项目 <b>${projectName}</b> 里:</p>
      <blockquote style="margin: 8px 0; padding: 8px 12px; border-left: 3px solid #d4af37; background: #faf5e6; color: #333; font-size: 13px;">
        ${safePreview}
      </blockquote>
      <p style="margin: 16px 0;">
        <a href="${projectUrl}" style="display: inline-block; padding: 8px 16px; background: #d4af37; color: #000; text-decoration: none; border-radius: 4px; font-weight: 600;">查看评论</a>
      </p>
      <p style="color: #999; font-size: 11px; margin-top: 24px;">
        不想收到? <a href="${host}/dashboard/account#email-prefs" style="color: #999;">关闭邮件提醒</a>
      </p>
    </div>
  `;
  const text = `${input.sourceUserName} ${action} (项目 ${projectName}): ${safePreview}\n\n查看: ${projectUrl}`;
  return sendEmail({ to: user.email, subject, html, text });
}
