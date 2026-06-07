import { describe, it, expect, vi } from 'vitest';
import {
  subscribe, emitNotification, emitComment, notifChannel, commentChannel, listenerCount,
} from '@/lib/event-bus';

describe('event-bus', () => {
  it('订阅后收到该用户通知事件', () => {
    const cb = vi.fn();
    const off = subscribe(notifChannel('u1'), cb);
    emitNotification('u1', { commentId: 'c1' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'notification', commentId: 'c1' });
    off();
  });

  it('退订后不再收到', () => {
    const cb = vi.fn();
    const off = subscribe(notifChannel('u2'), cb);
    off();
    emitNotification('u2');
    expect(cb).not.toHaveBeenCalled();
  });

  it('频道隔离:不同用户/项目互不串', () => {
    const cb = vi.fn();
    const off = subscribe(commentChannel('pA'), cb);
    emitComment('pB');
    emitNotification('pA'); // 不同频道前缀
    expect(cb).not.toHaveBeenCalled();
    emitComment('pA');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('空 id 不 emit(防脏频道)', () => {
    const cb = vi.fn();
    const off = subscribe(notifChannel(''), cb);
    emitNotification('');
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it('listenerCount 反映订阅数', () => {
    const ch = notifChannel('u3');
    const base = listenerCount(ch);
    const off = subscribe(ch, () => {});
    expect(listenerCount(ch)).toBe(base + 1);
    off();
    expect(listenerCount(ch)).toBe(base);
  });
});
