/**
 * v3.x P0.3 E.2 — Email sender (Resend).
 *
 * Vision API 调用 mock; 验:
 *   - 没 key → isEnabled false
 *   - 有 key + LIPSYNC_DISABLED 类似 EMAIL_DISABLED → false
 *   - blocked email patterns
 *   - 网络错误 catch + 返 sent: false
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.EMAIL_DISABLED;
  delete process.env.EMAIL_PROVIDER;
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.EMAIL_DISABLED;
  delete process.env.EMAIL_PROVIDER;
});

async function freshLib() {
  vi.resetModules();
  return await import('@/lib/email-sender');
}

describe('v3.x E.2 · isEmailEnabled', () => {
  it('returns false when no RESEND_API_KEY', async () => {
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(false);
  });

  it('returns false when key is placeholder', async () => {
    process.env.RESEND_API_KEY = 'your_resend_key';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(false);
  });

  it('returns true when real key set', async () => {
    process.env.RESEND_API_KEY = 're_real_abc123';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(true);
  });

  it('sendgrid: enabled when EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.real_abc';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(true);
  });

  it('sendgrid: disabled without its own key (a resend key must not count)', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.RESEND_API_KEY = 're_real_abc';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(false);
  });

  it('sendgrid: 202 → sent, posts to sendgrid endpoint', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.real_abc';
    fetchSpy.mockResolvedValue({ status: 202, ok: true, text: async () => '' });
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>' });
    expect(r.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('https://api.sendgrid.com/v3/mail/send', expect.objectContaining({ method: 'POST' }));
  });

  it('returns false when EMAIL_DISABLED=1', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    process.env.EMAIL_DISABLED = '1';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(false);
  });

  it('returns false when provider not implemented', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    process.env.EMAIL_PROVIDER = 'mailgun';
    const { isEmailEnabled } = await freshLib();
    expect(isEmailEnabled()).toBe(false);
  });
});

describe('v3.x E.2 · sendEmail', () => {
  it('returns sent: false when no key', async () => {
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'user@real.com', subject: 'x', html: '<p>y</p>' });
    expect(r.sent).toBe(false);
    expect(r.warning).toMatch(/disabled|key/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks demo / test / example domains', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    const { sendEmail } = await freshLib();
    for (const blocked of [
      'demo@qfmanju.ai',
      'test@test.local',
      'user@example.com',
      'demo@anything.com',
    ]) {
      const r = await sendEmail({ to: blocked, subject: 's', html: '<p>x</p>' });
      expect(r.sent).toBe(false);
      expect(r.warning).toMatch(/blocked/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns sent: false on Resend 4xx', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 422,
      text: async () => 'invalid email',
    });
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'real@user.com', subject: 's', html: '<p>x</p>' });
    expect(r.sent).toBe(false);
    expect(r.warning).toContain('422');
  });

  it('returns sent: true on Resend success', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'email-123' }),
      text: async () => '',
    });
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'real@user.com', subject: 's', html: '<p>x</p>' });
    expect(r.sent).toBe(true);
  });

  it('catches network errors gracefully', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'real@user.com', subject: 's', html: '<p>x</p>' });
    expect(r.sent).toBe(false);
    expect(r.warning).toContain('ECONNRESET');
  });

  it('rejects missing subject or html', async () => {
    process.env.RESEND_API_KEY = 're_real_abc';
    const { sendEmail } = await freshLib();
    const r = await sendEmail({ to: 'real@user.com', subject: '', html: '<p>x</p>' });
    expect(r.sent).toBe(false);
  });
});
