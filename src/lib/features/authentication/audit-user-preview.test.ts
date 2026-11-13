import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuditUserPreviewCache } from '$lib/features/authentication/audit-user-preview';
import { downloadAvatar, getUserAvatar, getUserInfo, type ManagedUserInfo } from '$lib/api';

vi.mock('$lib/api', () => ({ getUserInfo: vi.fn(), getUserAvatar: vi.fn(), downloadAvatar: vi.fn() }));
const user: ManagedUserInfo = {
  user_id: 'alice-id', username: 'alice', status: 'active', permissions: [],
  effective_permissions: [], effective_own_permissions: [], effective_inherited_permissions: [],
};

beforeEach(() => { vi.resetAllMocks(); });

describe('page-owned user preview cache', () => {
  it('shares pending requests and successful results by ID until cleared', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(user);
    vi.mocked(getUserAvatar).mockResolvedValue({ task_id: 'task' });
    vi.mocked(downloadAvatar).mockResolvedValue('alice.png');
    const cache = createAuditUserPreviewCache();
    expect(cache.info('alice-id')).toBe(cache.info('alice-id'));
    await expect(cache.info('alice-id')).resolves.toBe(user);
    expect(getUserInfo).toHaveBeenCalledExactlyOnceWith({ userId: 'alice-id' });
    await Promise.all([cache.avatar(user), cache.avatar(user)]);
    expect(downloadAvatar).toHaveBeenCalledExactlyOnceWith({ task_id: 'task' }, 'alice-id', 'alice');
    cache.clear();
    await cache.info('alice-id');
    expect(getUserInfo).toHaveBeenCalledTimes(2);
  });

  it('evicts failed lookups so opening again retries', async () => {
    vi.mocked(getUserInfo).mockRejectedValueOnce('denied').mockResolvedValue(user);
    const cache = createAuditUserPreviewCache();
    await expect(cache.info('alice-id')).rejects.toBe('denied');
    await expect(cache.info('alice-id')).resolves.toBe(user);
  });

  it('does not start avatar transfers after invalidation', async () => {
    let resolve!: (task: object) => void;
    vi.mocked(getUserAvatar).mockReturnValue(new Promise((done) => { resolve = done; }));
    const cache = createAuditUserPreviewCache();
    const request = cache.avatar(user);
    cache.clear();
    resolve({ task_id: 'stale' });
    await expect(request).resolves.toBeNull();
    expect(downloadAvatar).not.toHaveBeenCalled();
  });

  it.each(['missing', 'denied', 'transfer'])('treats %s avatars as optional', async (failure) => {
    vi.mocked(getUserAvatar).mockResolvedValue(failure === 'missing' ? null : { task_id: 'task' });
    if (failure === 'denied') vi.mocked(getUserAvatar).mockRejectedValue('denied');
    if (failure === 'transfer') vi.mocked(downloadAvatar).mockRejectedValue('failed');
    await expect(createAuditUserPreviewCache().avatar(user)).resolves.toBeNull();
  });
});
