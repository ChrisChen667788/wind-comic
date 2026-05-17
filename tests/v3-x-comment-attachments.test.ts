/**
 * v3.x P0.3 E.1 — Comment attachments.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { createComment, listComments } from '@/lib/comments';

let SEEDED_USER_ID = '';
let SEEDED_USER_NAME = '';

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const u = db.prepare('SELECT id, name FROM users LIMIT 1').get() as { id: string; name: string } | undefined;
    SEEDED_USER_ID = u?.id || '';
    SEEDED_USER_NAME = u?.name || '';
  }
  db.prepare("DELETE FROM comments WHERE project_id LIKE 'test-att-%'").run();
  db.prepare("DELETE FROM notifications WHERE project_id LIKE 'test-att-%'").run();
});

describe('v3.x E.1 · createComment attachments', () => {
  it('accepts image attachment', () => {
    const pid = `test-att-${nanoid(6)}`;
    const { comment } = createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: '看这张图',
      attachments: [{ url: 'https://example.com/x.png', type: 'image', filename: 'x.png' }],
    });
    expect(comment.attachments.length).toBe(1);
    expect(comment.attachments[0].url).toBe('https://example.com/x.png');
    expect(comment.attachments[0].type).toBe('image');
  });

  it('filters out data: URIs (must be http)', () => {
    const pid = `test-att-${nanoid(6)}`;
    const { comment } = createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'test',
      attachments: [
        { url: 'data:image/png;base64,xxx', type: 'image' },
        { url: 'https://ok.example/x.png', type: 'image' },
      ],
    });
    expect(comment.attachments.length).toBe(1);
    expect(comment.attachments[0].url).toBe('https://ok.example/x.png');
  });

  it('caps at 6 attachments', () => {
    const pid = `test-att-${nanoid(6)}`;
    const many = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}.png`, type: 'image' as const,
    }));
    const { comment } = createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'many',
      attachments: many,
    });
    expect(comment.attachments.length).toBe(6);
  });

  it('rejects invalid type', () => {
    const pid = `test-att-${nanoid(6)}`;
    const { comment } = createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'test',
      attachments: [
        { url: 'https://ok.example/x.png', type: 'image' },
        // @ts-expect-error - testing runtime guard
        { url: 'https://ok.example/x.exe', type: 'executable' },
      ],
    });
    expect(comment.attachments.length).toBe(1);
  });

  it('allows attachment-only comment (no text content)', () => {
    const pid = `test-att-${nanoid(6)}`;
    const { comment } = createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: '',
      attachments: [{ url: 'https://example.com/x.png', type: 'image' }],
    });
    expect(comment.content).toBe('');
    expect(comment.attachments.length).toBe(1);
  });

  it('rejects truly empty (no content + no attachments)', () => {
    expect(() =>
      createComment({
        projectId: 'test-att-empty', targetType: 'project', targetId: 'test-att-empty',
        authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
        content: '   ',
      }),
    ).toThrow(/empty/);
  });

  it('listComments preserves attachments', () => {
    const pid = `test-att-${nanoid(6)}`;
    createComment({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'pic',
      attachments: [{ url: 'https://example.com/a.png', type: 'image', size: 1234, filename: 'a.png' }],
    });
    const list = listComments({ projectId: pid });
    expect(list.length).toBe(1);
    expect(list[0].attachments[0].size).toBe(1234);
    expect(list[0].attachments[0].filename).toBe('a.png');
  });
});
