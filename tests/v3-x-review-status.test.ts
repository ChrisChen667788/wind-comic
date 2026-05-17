/**
 * v3.x P0.3 E.3 — Review status state machine.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  getReviewStatus,
  transitionReviewStatus,
} from '@/lib/review-status';

const SUBMITTER = 'user-submitter-1';
const REVIEWER = 'user-reviewer-1';

let counter = 0;
function freshProjectId(): string {
  return `test-review-${Date.now()}-${++counter}`;
}

beforeEach(() => {
  db.prepare("DELETE FROM project_review_status WHERE project_id LIKE 'test-review-%'").run();
});

describe('v3.x E.3 · getReviewStatus', () => {
  it('returns draft by default when no record', () => {
    const s = getReviewStatus(freshProjectId());
    expect(s.status).toBe('draft');
    expect(s.submittedByUserId).toBeNull();
  });
});

describe('v3.x E.3 · transitionReviewStatus', () => {
  it('draft → in_review (submit)', () => {
    const pid = freshProjectId();
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    expect(r.ok).toBe(true);
    expect(r.status?.status).toBe('in_review');
    expect(r.status?.submittedByUserId).toBe(SUBMITTER);
  });

  it('in_review → approved by different user', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'approved', actorUserId: REVIEWER });
    expect(r.ok).toBe(true);
    expect(r.status?.status).toBe('approved');
    expect(r.status?.reviewedByUserId).toBe(REVIEWER);
  });

  it('rejects self-approve', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'approved', actorUserId: SUBMITTER });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('自审');
  });

  it('rejects self-request-changes', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({
      projectId: pid, toStatus: 'changes_requested', actorUserId: SUBMITTER, note: 'self',
    });
    expect(r.ok).toBe(false);
  });

  it('request_changes requires note', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({
      projectId: pid, toStatus: 'changes_requested', actorUserId: REVIEWER, // no note
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('留言');
  });

  it('request_changes with note succeeds', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({
      projectId: pid, toStatus: 'changes_requested', actorUserId: REVIEWER,
      note: '第 3 镜画风不对, 请重做',
    });
    expect(r.ok).toBe(true);
    expect(r.status?.reviewNote).toContain('第 3 镜');
  });

  it('approved → draft (re-creation cycle)', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    transitionReviewStatus({ projectId: pid, toStatus: 'approved', actorUserId: REVIEWER });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'draft', actorUserId: SUBMITTER });
    expect(r.ok).toBe(true);
    expect(r.status?.status).toBe('draft');
  });

  it('rejects illegal transition draft → approved', () => {
    const pid = freshProjectId();
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'approved', actorUserId: REVIEWER });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('非法状态转换');
  });

  it('rejects illegal transition approved → in_review', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    transitionReviewStatus({ projectId: pid, toStatus: 'approved', actorUserId: REVIEWER });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    expect(r.ok).toBe(false);
  });

  it('withdraw (in_review → draft) by submitter', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'draft', actorUserId: SUBMITTER });
    expect(r.ok).toBe(true);
    expect(r.status?.status).toBe('draft');
  });

  it('changes_requested → in_review (re-submit)', () => {
    const pid = freshProjectId();
    transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    transitionReviewStatus({
      projectId: pid, toStatus: 'changes_requested', actorUserId: REVIEWER, note: 'fix this',
    });
    const r = transitionReviewStatus({ projectId: pid, toStatus: 'in_review', actorUserId: SUBMITTER });
    expect(r.ok).toBe(true);
    expect(r.status?.submittedByUserId).toBe(SUBMITTER);
    expect(r.status?.reviewedAt).toBeNull(); // reset on re-submit
  });
});
