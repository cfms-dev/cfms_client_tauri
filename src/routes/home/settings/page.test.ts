// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appLockStore } from '$lib/app-lock.svelte';
import { screenProtectionStore } from '$lib/screen-protection.svelte';
import { authStore, serverStateStore } from '$lib/stores.svelte';
import SettingsOverviewPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  getTwoFactorStatus: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getTwoFactorStatus: mocks.getTwoFactorStatus,
}));
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

beforeEach(() => {
  authStore.clear();
  authStore.apply({
    username: 'alice',
    nickname: 'Alice',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: [],
    groups: [],
  });
  serverStateStore.connected = true;
  appLockStore.initialized = true;
  appLockStore.initializationFailed = false;
  appLockStore.settings = {
    ...appLockStore.settings,
    enabled: true,
    platformCredentials: [{ id: 'credential-1', label: 'Device passkey', createdAt: 1 }],
  };
  screenProtectionStore.initialized = true;
  screenProtectionStore.initializationFailed = false;
  screenProtectionStore.supported = true;
  screenProtectionStore.userEnabled = true;
  mocks.getTwoFactorStatus.mockResolvedValue({ enabled: true, method: 'totp', backup_codes_count: 8 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authStore.clear();
  serverStateStore.clear();
  appLockStore.resetForSignedOut();
  screenProtectionStore.resetForSignedOut();
  screenProtectionStore.supported = true;
});

describe('settings overview', () => {
  it('renders semantic task groups and opens the selected settings page', async () => {
    render(SettingsOverviewPage);

    expect(screen.getByRole('heading', { level: 1, name: 'settings.title' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'settings.overview.groups.personalization' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'settings.overview.groups.accessSecurity' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'settings.overview.groups.dataOperations' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'settings.overview.groups.maintenance' })).toBeTruthy();

    const accountEntry = screen.getByRole('button', { name: /settings\.account\.title/ });
    await fireEvent.click(accountEntry);
    expect(mocks.goto).toHaveBeenCalledWith('/home/settings/account');
  });

  it('reports success only after all three protection states are known and enabled', async () => {
    render(SettingsOverviewPage);

    await waitFor(() => {
      expect(screen.getByText('settings.overview.security.allEnabled')).toBeTruthy();
    });
    expect(screen.getByText('settings.overview.status.connected')).toBeTruthy();
    expect(screen.getByText('settings.overview.status.twoFactorEnabled')).toBeTruthy();
    expect(screen.getByText('settings.overview.status.screenProtectionEnabled')).toBeTruthy();
    expect(screen.getByText('settings.overview.status.appLockEnabled')).toBeTruthy();
  });

  it('uses an advisory summary when optional protections are disabled', async () => {
    appLockStore.settings = { ...appLockStore.settings, enabled: false };
    screenProtectionStore.userEnabled = false;
    mocks.getTwoFactorStatus.mockResolvedValue({ enabled: false, method: null, backup_codes_count: 0 });

    render(SettingsOverviewPage);

    await waitFor(() => {
      expect(screen.getByText('settings.overview.security.attention')).toBeTruthy();
      expect(screen.getByText('settings.overview.status.twoFactorDisabled')).toBeTruthy();
    });
    expect(screen.getByText('settings.overview.status.screenProtectionDisabled')).toBeTruthy();
    expect(screen.getByText('settings.overview.status.appLockDisabled')).toBeTruthy();
  });

  it('does not misreport failed protection reads as enabled', async () => {
    screenProtectionStore.initializationFailed = true;
    mocks.getTwoFactorStatus.mockRejectedValue(new Error('offline'));

    render(SettingsOverviewPage);

    await waitFor(() => {
      expect(screen.getByText('settings.overview.security.unavailable')).toBeTruthy();
    });
    expect(screen.getAllByText('settings.overview.status.unavailable')).toHaveLength(2);
  });

  it('hides the protection summary and authenticated groups when signed out', () => {
    authStore.clear();

    render(SettingsOverviewPage);

    expect(screen.queryByRole('heading', { name: 'settings.overview.security.title' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'settings.overview.groups.dataOperations' })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings\.account\.title/ })).toBeNull();
    expect(screen.getByRole('button', { name: /settings\.connection\.title/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /settings\.localData\.title/ })).toBeTruthy();
  });
});
