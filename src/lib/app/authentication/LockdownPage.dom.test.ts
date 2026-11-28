// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LockdownPage from '#lib/app/authentication/LockdownPage.svelte';

const mocks = vi.hoisted(() => ({
  authStore: {
    isLoggedIn: false,
    username: null as string | null,
    nickname: null as string | null,
    clear: vi.fn(),
  },
  serverStateStore: {
    connected: true,
    serverName: 'Confidential HQ' as string | null,
    lockdownReason: null as string | null,
    clear: vi.fn(),
  },
  appLockStore: {
    canLock: false,
    lock: vi.fn(),
  },
  notificationStore: {
    error: vi.fn(),
  },
  api: {
    clearAuthSession: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quitApplication: vi.fn().mockResolvedValue(undefined),
  },
  isMobilePlatform: vi.fn(() => false),
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#lib/features/authentication/auth-state.svelte.ts', () => ({
  authStore: mocks.authStore,
}));
vi.mock('#lib/shared/notifications/notifications.svelte.ts', () => ({
  notificationStore: mocks.notificationStore,
}));
vi.mock('#lib/features/connection/connection-state.svelte.ts', () => ({
  serverStateStore: mocks.serverStateStore,
}));
vi.mock('#lib/api.ts', () => mocks.api);
vi.mock('#lib/features/settings/app-lock.svelte.ts', () => ({
  appLockStore: mocks.appLockStore,
}));
vi.mock('#lib/shared/platform/platform.ts', () => ({
  isMobilePlatform: mocks.isMobilePlatform,
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.authStore.isLoggedIn = false;
  mocks.authStore.username = null;
  mocks.authStore.nickname = null;
  mocks.serverStateStore.connected = true;
  mocks.serverStateStore.serverName = 'Confidential HQ';
  mocks.serverStateStore.lockdownReason = null;
  mocks.appLockStore.canLock = false;
  mocks.isMobilePlatform.mockReturnValue(false);
});

describe('lockdown page authentication states', () => {
  it('presents an accessible 24-hour clock without announcing every tick', () => {
    render(LockdownPage);

    const clock = document.querySelector('time.lockdown-clock');
    expect(clock).toBeTruthy();
    expect(clock?.textContent?.trim()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(clock?.getAttribute('datetime')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(clock?.closest('[aria-hidden="true"]')).toBeNull();
    expect(clock?.hasAttribute('aria-live')).toBe(false);
  });

  it('resynchronizes the clock immediately when the window regains focus', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0, 250));
    render(LockdownPage);

    const clock = document.querySelector('time.lockdown-clock');
    expect(clock?.textContent?.trim()).toBe('12:00:00');

    vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 5, 250));
    window.dispatchEvent(new Event('focus'));
    await tick();

    expect(clock?.textContent?.trim()).toBe('12:00:05');
  });

  it('explains zero-retained session security and offers return-to-sign-in for signed-out users', async () => {
    render(LockdownPage);

    expect(screen.getByRole('main', { name: 'lockdown.title' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'lockdown.title' })).toBeTruthy();

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('lockdown.sessionNotKeptTitle');
    expect(status.textContent).toContain('lockdown.sessionNotKeptBody');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'lockdown.logout' })).toBeNull();

    const disconnectButton = screen.getByRole('button', { name: 'lockdown.disconnect' });
    expect(disconnectButton.querySelector('[data-icon="linkOff"]')).toBeTruthy();

    const backButton = screen.getByRole('button', { name: 'lockdown.backToSignIn' });
    expect(backButton.querySelector('[data-icon="arrowBack"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lockdown.quit' })).toBeTruthy();

    await fireEvent.click(backButton);
    await waitFor(() => {
      expect(mocks.api.clearAuthSession).toHaveBeenCalledTimes(1);
      expect(mocks.authStore.clear).toHaveBeenCalledTimes(1);
      expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true });
    });
  });

  it('shows suspended-session status without leaking user identity and keeps logout available', () => {
    mocks.authStore.isLoggedIn = true;
    mocks.authStore.username = 'alice';
    mocks.authStore.nickname = 'Alice Chen';
    render(LockdownPage);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('lockdown.sessionSuspendedTitle');
    expect(status.textContent).toContain('lockdown.sessionSuspendedBody');
    expect(document.body.textContent).not.toContain('alice');
    expect(document.body.textContent).not.toContain('Alice Chen');
    expect(screen.getByRole('button', { name: 'lockdown.logout' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'lockdown.backToSignIn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'appLock.lockNow' })).toBeNull();
  });

  it('surfaces the app-lock button and matching suspended copy when app lock is available', async () => {
    mocks.authStore.isLoggedIn = true;
    mocks.appLockStore.canLock = true;
    render(LockdownPage);

    expect(screen.getByRole('status').textContent).toContain('lockdown.sessionSuspendedBodyWithAppLock');
    const lockButton = screen.getByRole('button', { name: 'appLock.lockNow' });
    await fireEvent.click(lockButton);
    expect(mocks.appLockStore.lock).toHaveBeenCalledTimes(1);
  });

  it('shows live connection status without displaying the server name', () => {
    render(LockdownPage);

    expect(screen.getByText('lockdown.connectionConnected')).toBeTruthy();
    expect(screen.getByText('lockdown.wait')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Confidential HQ');
  });

  it('shows a provided lockdown reason without changing its content', () => {
    mocks.serverStateStore.lockdownReason = '  Emergency maintenance\nContact the administrator.  ';
    render(LockdownPage);

    const reason = screen.getByRole('note');
    expect(reason.textContent).toContain('lockdown.reasonLabel');
    expect(reason.textContent).toContain('Emergency maintenance\nContact the administrator.');
  });

  it('disables logout and surfaces connection-lost guidance when an authenticated session disconnects', () => {
    mocks.authStore.isLoggedIn = true;
    mocks.serverStateStore.connected = false;
    render(LockdownPage);

    expect(screen.getByText('lockdown.connectionLost')).toBeTruthy();
    expect(screen.getByText('lockdown.connectionLostWait')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lockdown.logout' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'lockdown.disconnect' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'lockdown.quit' }).hasAttribute('disabled')).toBe(false);
  });

  it('disables return-to-sign-in when a signed-out session loses connection', () => {
    mocks.authStore.isLoggedIn = false;
    mocks.serverStateStore.connected = false;
    render(LockdownPage);

    expect(screen.getByText('lockdown.connectionLost')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lockdown.backToSignIn' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'lockdown.disconnect' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'lockdown.quit' }).hasAttribute('disabled')).toBe(false);
  });

  it('hides mobile quit guidance on desktop and adapts it by auth state on mobile', () => {
    const desktop = render(LockdownPage);
    expect(screen.queryByText('lockdown.quitHint')).toBeNull();
    expect(screen.queryByText('lockdown.quitHintSignedOut')).toBeNull();
    desktop.unmount();

    mocks.isMobilePlatform.mockReturnValue(true);
    const mobileSignedOut = render(LockdownPage);
    expect(screen.getByText('lockdown.quitHintSignedOut')).toBeTruthy();
    expect(screen.queryByText('lockdown.quitHint')).toBeNull();
    mobileSignedOut.unmount();

    mocks.authStore.isLoggedIn = true;
    render(LockdownPage);
    expect(screen.getByText('lockdown.quitHint')).toBeTruthy();
    expect(screen.queryByText('lockdown.quitHintSignedOut')).toBeNull();
  });
});
