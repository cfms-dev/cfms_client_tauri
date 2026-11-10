import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locale } from 'svelte-i18n';
import '$lib/shared/i18n';
import { notifyGithubAuthFallback, resetGithubAuthNotice } from '$lib/features/updates/github-auth-notices';

const mocks = vi.hoisted(() => ({
  getGithubAuthStatus: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('$lib/api', () => ({ getGithubAuthStatus: mocks.getGithubAuthStatus }));
vi.mock('$lib/shared/notifications/notifications.svelte', () => ({
  notificationStore: { warning: mocks.warning }
}));

beforeEach(() => {
  locale.set('en');
  resetGithubAuthNotice();
  vi.clearAllMocks();
});

describe('GitHub credential fallback notices', () => {
  it('warns once when an unusable token falls back to anonymous requests', async () => {
    mocks.getGithubAuthStatus.mockResolvedValue({ mode: 'needs_attention' });

    await notifyGithubAuthFallback();
    await notifyGithubAuthFallback();

    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.warning.mock.calls[0][0]).toContain('GitHub');
  });

  it('allows a new warning after the credential is replaced', async () => {
    mocks.getGithubAuthStatus.mockResolvedValue({ mode: 'needs_attention' });

    await notifyGithubAuthFallback();
    resetGithubAuthNotice();
    await notifyGithubAuthFallback();

    expect(mocks.warning).toHaveBeenCalledTimes(2);
  });

  it('keeps a status lookup failure from breaking a successful request', async () => {
    mocks.getGithubAuthStatus.mockRejectedValue(new Error('credential store unavailable'));

    await expect(notifyGithubAuthFallback()).resolves.toBeUndefined();
    expect(mocks.warning).not.toHaveBeenCalled();
  });
});
