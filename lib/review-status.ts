/**
 * v3.x P0.3 E.3 — Project version approval state machine.
 *
 * 状态机:
 *   draft (默认) → in_review (提交) → approved | changes_requested
 *   approved/changes_requested → draft (重新创作)
 *
 * 设计:
 *   - 1 个项目 1 个 review status (project_review_status PK = project_id)
 *   - 不存历史 (要 history 走 audit log v3.x P1)
 *   - 状态转换有 actor: submitted_by / reviewed_by
 *   - 只有项目所有者 + admin 能 review (即审批不能自己审自己)
 */

import { db, now } from '@/lib/db';

export type ReviewStatus = 'draft' | 'in_review' | 'approved' | 'changes_requested';

export interface ProjectReviewStatus {
  projectId: string;
  status: ReviewStatus;
  submittedByUserId: string | null;
  submittedAt: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
}

interface ReviewDbRow {
  project_id: string;
  status: string;
  submitted_by_user_id: string | null;
  submitted_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  updated_at: string;
}

function rowToStatus(row: ReviewDbRow): ProjectReviewStatus {
  return {
    projectId: row.project_id,
    status: row.status as ReviewStatus,
    submittedByUserId: row.submitted_by_user_id,
    submittedAt: row.submitted_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    updatedAt: row.updated_at,
  };
}

const ALLOWED_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ['in_review'],
  in_review: ['approved', 'changes_requested', 'draft'],     // 提交者可撤回到 draft
  approved: ['draft'],
  changes_requested: ['in_review', 'draft'],                  // 修改后再提交
};

/**
 * 获取项目当前审批状态. 没记录 → 返默认 (draft).
 */
export function getReviewStatus(projectId: string): ProjectReviewStatus {
  const row = db.prepare(
    'SELECT * FROM project_review_status WHERE project_id = ?',
  ).get(projectId) as ReviewDbRow | undefined;
  if (row) return rowToStatus(row);
  // 默认: 没记录 = draft
  return {
    projectId,
    status: 'draft',
    submittedByUserId: null,
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    updatedAt: now(),
  };
}

export interface TransitionInput {
  projectId: string;
  toStatus: ReviewStatus;
  actorUserId: string;
  note?: string;
}

export interface TransitionResult {
  ok: boolean;
  status?: ProjectReviewStatus;
  error?: string;
}

/**
 * 状态转换. 校验:
 *   - 转换路径合法 (按 ALLOWED_TRANSITIONS)
 *   - approve/request changes 时, actor != 提交者 (防自审)
 *   - 转 in_review 必须有 actor (提交者)
 */
export function transitionReviewStatus(input: TransitionInput): TransitionResult {
  const current = getReviewStatus(input.projectId);
  const allowed = ALLOWED_TRANSITIONS[current.status] || [];
  if (!allowed.includes(input.toStatus)) {
    return {
      ok: false,
      error: `非法状态转换: ${current.status} → ${input.toStatus} (允许: ${allowed.join('|') || '无'})`,
    };
  }

  // approve / request_changes 时禁止自审
  if (
    (input.toStatus === 'approved' || input.toStatus === 'changes_requested') &&
    current.submittedByUserId === input.actorUserId
  ) {
    return { ok: false, error: '不能自审自己提交的版本' };
  }

  // note 校验
  const note = (input.note || '').trim().slice(0, 500);
  if (input.toStatus === 'changes_requested' && !note) {
    return { ok: false, error: 'request_changes 时必须填留言, 告诉提交者改哪里' };
  }

  const ts = now();
  let submittedByUserId = current.submittedByUserId;
  let submittedAt = current.submittedAt;
  let reviewedByUserId = current.reviewedByUserId;
  let reviewedAt = current.reviewedAt;
  let reviewNote = current.reviewNote;

  if (input.toStatus === 'in_review') {
    submittedByUserId = input.actorUserId;
    submittedAt = ts;
    reviewedByUserId = null;
    reviewedAt = null;
    reviewNote = null;
  } else if (input.toStatus === 'approved' || input.toStatus === 'changes_requested') {
    reviewedByUserId = input.actorUserId;
    reviewedAt = ts;
    reviewNote = note || null;
  } else if (input.toStatus === 'draft') {
    // 撤回到 draft — 清审阅信息但保留 submitted (作历史)
    reviewedByUserId = null;
    reviewedAt = null;
    reviewNote = note || null;
  }

  // UPSERT
  db.prepare(`
    INSERT INTO project_review_status
      (project_id, status, submitted_by_user_id, submitted_at, reviewed_by_user_id, reviewed_at, review_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      status = excluded.status,
      submitted_by_user_id = excluded.submitted_by_user_id,
      submitted_at = excluded.submitted_at,
      reviewed_by_user_id = excluded.reviewed_by_user_id,
      reviewed_at = excluded.reviewed_at,
      review_note = excluded.review_note,
      updated_at = excluded.updated_at
  `).run(
    input.projectId, input.toStatus, submittedByUserId, submittedAt,
    reviewedByUserId, reviewedAt, reviewNote, ts,
  );

  return { ok: true, status: getReviewStatus(input.projectId) };
}
