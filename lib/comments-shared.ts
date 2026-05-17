/**
 * v2.21 hotfix — Client-safe comment helpers.
 *
 * lib/comments.ts 引入 db (better-sqlite3 是 native, 不能进 client bundle).
 * 这个文件只有纯函数 + 类型, 不 import db, 可被 page.tsx / 组件等 client code 引用.
 *
 * 服务端代码仍然从 @/lib/comments 引 createComment 等 DB-backed API.
 */

export type CommentTargetType =
  | 'project'
  | 'shot'
  | 'scene'
  | 'character'
  | 'storyboard';

export interface CommentAttachmentShape {
  url: string;
  type: 'image' | 'video' | 'file';
  size?: number;
  filename?: string;
}

export interface CommentRowShape {
  id: string;
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  authorUserId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  mentions: Array<{ userId: string; name: string }>;
  attachments?: CommentAttachmentShape[]; // v3.x E.1
  parentId: string | null;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

/**
 * 给 UI 调用方统一构造 target_id 的辅助函数, 避免拼写漂移.
 * 同 server-side lib/comments.ts 的 buildTargetId — 共一份单源真理.
 */
export function buildTargetId(
  targetType: CommentTargetType,
  projectId: string,
  subKey?: string | number,
): string {
  if (targetType === 'project') return projectId;
  if (targetType === 'shot' || targetType === 'storyboard') {
    if (subKey == null) throw new Error(`${targetType} target requires subKey (shotNumber)`);
    return `${projectId}:${subKey}`;
  }
  // scene / character — 用名字作 sub-key
  if (subKey == null) throw new Error(`${targetType} target requires subKey (name)`);
  return String(subKey);
}
