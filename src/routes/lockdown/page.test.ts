// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LockdownPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  authStore: {
    isLoggedIn: false,
    clear: vi.fn(),
  },
  serverStateStore: {
    connected: true,
    lockdownReason: null as string | null,
    clear: vi.fn(),
  },
  notificationStore: {
    error: vi.fn(),
  },
  goto: vi.fn(),
}));

vi.mock('$lib/stores.svelte', () => ({
  authStore: mocks.authStore,
  notificationStore: mocks.notificationStore,
  serverStateStore: mocks.serverStateStore,
}));

vi.mock('$lib/api', () => ({
  clearAuthSession: vi.fn(),
  disconnect: vi.fn(),
  quitApplication: vi.fn(),
}));

vi.mock('$lib/app-lock.svelte', () => ({
  appLockStore: {
    canLock: false,
    lock: vi.fn(),
  },
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
  vi.clearAllMocks();
  mocks.authStore.isLoggedIn = false;
  mocks.serverStateStore.connected = true;
  mocks.serverStateStore.lockdownReason = null;
});

describe('lockdown page authentication states', () => {
  it('explains an incomplete login and hides logout for signed-out users', () => {
    render(LockdownPage);

    expect(screen.getByRole('main', { name: 'lockdown.title' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'lockdown.title' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('lockdown.signInIncomplete');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'lockdown.logout' })).toBeNull();
    expect(screen.getByRole('button', { name: 'lockdown.disconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lockdown.quit' })).toBeTruthy();
  });

  it('keeps logout available for a fully authenticated session', () => {
    mocks.authStore.isLoggedIn = true;
    render(LockdownPage);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'lockdown.logout' })).toBeTruthy();
  });

  it('shows a provided lockdown reason without changing its content', () => {
    mocks.serverStateStore.lockdownReason = '  Emergency maintenance\nContact the administrator.  ';
    render(LockdownPage);

    const reason = screen.getByRole('note');
    expect(reason.textContent).toContain('lockdown.reasonLabel');
    expect(reason.textContent).toContain('Emergency maintenance\nContact the administrator.');
  });

  it('disables logout when the authenticated session is no longer connected', () => {
    mocks.authStore.isLoggedIn = true;
    mocks.serverStateStore.connected = false;
    render(LockdownPage);

    const logoutButton = screen.getByRole('button', { name: 'lockdown.logout' });
    expect(logoutButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'lockdown.disconnect' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'lockdown.quit' }).hasAttribute('disabled')).toBe(false);
  });
});
