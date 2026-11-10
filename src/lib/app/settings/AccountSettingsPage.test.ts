// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import type { ManagedUserInfo } from '$lib/api';
import AccountSettingsPage from '$lib/app/settings/AccountSettingsPage.svelte';

const mocks = vi.hoisted(() => ({
  renameUser: vi.fn(),
  getAuthStatus: vi.fn(),
  getTwoFactorStatus: vi.fn(),
  goto: vi.fn(),
  getUserInfo: vi.fn(),
  listDirectory: vi.fn(),
}));

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  cancelTwoFactorSetup: vi.fn(),
  changePassword: vi.fn(),
  clearAuthSession: vi.fn(),
  disableTwoFactor: vi.fn(),
  getAuthStatus: mocks.getAuthStatus,
  getTwoFactorStatus: mocks.getTwoFactorStatus,
  renameUser: mocks.renameUser,
  serverErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  setupTwoFactor: vi.fn(),
  validateTwoFactor: vi.fn(),
  getUserInfo: mocks.getUserInfo,
  listDirectory: mocks.listDirectory,
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/account') },
}));
vi.mock('$lib/app/navigation', () => ({ navigateUp: vi.fn() }));
vi.mock('$lib/shared/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));
vi.mock('svelte-i18n', () => ({
  locale: { subscribe(run: (value: string) => void) { run('en'); return () => undefined; } },
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

const authStatus = {
  username: 'alice', user_id: 'aabbccdd-0000-4000-8000-000000000001',
  nickname: 'Alice',
  has_token: true,
  token_exp: 1_900_000_000,
  permissions: [],
  groups: [],
};

const profile: ManagedUserInfo = {
  username: 'alice', user_id: authStatus.user_id, nickname: 'Alice', status: 'active',
  permissions: [], effective_permissions: ['read_document'], effective_own_permissions: [],
  effective_inherited_permissions: ['read_document'], groups: ['staff'],
  created_time: 1_700_000_000, last_login: 1_790_000_000, passwd_last_modified: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  authStore.clear();
  authStore.apply(authStatus);
  serverStateStore.updateConnection(true, 'wss://files.example', false);
  notificationStore.clear();
  mocks.getAuthStatus.mockResolvedValue(authStatus);
  mocks.getTwoFactorStatus.mockResolvedValue({
    enabled: false,
    configured: false,
    backup_codes_count: 0,
  });
  mocks.renameUser.mockResolvedValue(true);
  mocks.getUserInfo.mockReset().mockResolvedValue(profile);
  mocks.listDirectory.mockReset().mockResolvedValue({ folders: [], documents: [], parent_id: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authStore.clear();
  serverStateStore.clear();
  notificationStore.clear();
});

async function openNicknameEditor() {
  await fireEvent.click(screen.getByRole('button', {
    name: 'settings.account.editNickname',
  }));
  return screen.getByRole('textbox', { name: 'settings.account.nicknameLabel' });
}

describe('account nickname settings', () => {
  it('routes security management to the unified authentication page', async () => {
    render(AccountSettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.title' }));
    expect(mocks.goto).toHaveBeenCalledWith('/home/settings/authentication');
    expect(screen.queryByRole('button', { name: 'settings.password.action' })).toBeNull();
    expect(mocks.getTwoFactorStatus).not.toHaveBeenCalled();
  });
  it('lets an ordinary user save a trimmed nickname and updates global auth state', async () => {
    render(AccountSettingsPage);
    const input = await openNicknameEditor();

    await fireEvent.input(input, { target: { value: '  New Name  ' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mocks.renameUser).toHaveBeenCalledWith(authStatus.user_id, 'New Name');
      expect(authStore.displayName).toBe('New Name');
    });
    expect(screen.getByText('New Name')).toBeTruthy();
    expect(notificationStore.entries[0]).toMatchObject({
      type: 'success',
      text: 'settings.account.nicknameUpdated',
    });
  });

  it('sends null when clearing the nickname and falls back to the username', async () => {
    render(AccountSettingsPage);
    const input = await openNicknameEditor();

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(mocks.renameUser).toHaveBeenCalledWith(authStatus.user_id, null));
    expect(authStore.displayName).toBe('alice');
  });

  it('blocks overlong values and supports Escape cancellation', async () => {
    render(AccountSettingsPage);
    const input = await openNicknameEditor();

    await fireEvent.input(input, { target: { value: '界'.repeat(256) } });
    expect(screen.getByText('settings.account.nicknameTooLong')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.renameUser).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'settings.account.nicknameLabel' })).toBeNull();
  });

  it('keeps the editor open and preserves state when the server rejects the update', async () => {
    mocks.renameUser.mockRejectedValue(new Error('Server returned 403: denied'));
    render(AccountSettingsPage);
    const input = await openNicknameEditor();

    await fireEvent.input(input, { target: { value: 'Rejected Name' } });
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(notificationStore.entries[0]).toMatchObject({
        type: 'error',
        text: 'Server returned 403: denied',
      });
    });
    expect((screen.getByRole('textbox', {
      name: 'settings.account.nicknameLabel',
    }) as HTMLInputElement).value).toBe('Rejected Name');
    expect(authStore.displayName).toBe('Alice');
  });

  it('disables unchanged values and ignores duplicate submissions while saving', async () => {
    let finishRename: ((value: boolean) => void) | undefined;
    mocks.renameUser.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishRename = resolve;
    }));
    render(AccountSettingsPage);
    const input = await openNicknameEditor();
    const saveButton = screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'Pending Name' } });
    await fireEvent.click(saveButton);
    await fireEvent.click(saveButton);

    expect(mocks.renameUser).toHaveBeenCalledTimes(1);
    expect(saveButton.disabled).toBe(true);

    finishRename?.(true);
    await waitFor(() => expect(authStore.displayName).toBe('Pending Name'));
  });
});

describe('personal account information', () => {
  it('loads only the signed-in user without administrative grants and copies their full ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(AccountSettingsPage);
      await waitFor(() => expect(screen.getByText(profile.user_id)).toBeTruthy());
      expect(mocks.getUserInfo).toHaveBeenCalledExactlyOnceWith({ userId: authStatus.user_id });
      expect(screen.getByText('staff')).toBeTruthy();
      expect(screen.queryByText('wss://files.example')).toBeNull();
      expect(screen.getByText('settings.account.notProvided')).toBeTruthy();
      expect(authStore.permissions).toEqual([]);
      expect(authStore.groups).toEqual([]);
      await fireEvent.click(screen.getByRole('button', { name: 'manage.copyUserId' }));
      expect(writeText).toHaveBeenCalledWith(profile.user_id);
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps unknown data distinct from an empty permission set while loading', async () => {
    const pending = deferred<ManagedUserInfo>();
    mocks.getUserInfo.mockReturnValueOnce(pending.promise);
    render(AccountSettingsPage);
    expect(screen.getByText('settings.account.loading')).toBeTruthy();
    expect(screen.queryByText('settings.account.noPermissions')).toBeNull();
    expect(screen.queryByText('settings.account.noGroups')).toBeNull();
    pending.resolve({ ...profile, groups: [], effective_permissions: [] });
    await waitFor(() => expect(screen.getByText('settings.account.noPermissions')).toBeTruthy());
    expect(screen.getByText('settings.account.noGroups')).toBeTruthy();
  });

  it('preserves the nickname draft and previous information when refresh fails, then allows retry', async () => {
    render(AccountSettingsPage);
    await waitFor(() => expect(screen.getByText(profile.user_id)).toBeTruthy());
    const input = await openNicknameEditor();
    await fireEvent.input(input, { target: { value: 'Unsaved name' } });
    mocks.getUserInfo.mockRejectedValueOnce(new Error('Network unavailable'));
    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('settings.account.refreshFailed'));
    expect((input as HTMLInputElement).value).toBe('Unsaved name');
    expect(screen.getByText(profile.user_id)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'settings.account.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.getUserInfo).toHaveBeenCalledTimes(3);
  });

  it('does not let a delayed refresh undo a successfully saved nickname', async () => {
    render(AccountSettingsPage);
    await waitFor(() => expect(screen.getByText(profile.user_id)).toBeTruthy());
    const pending = deferred<ManagedUserInfo>();
    mocks.getUserInfo.mockReturnValueOnce(pending.promise);
    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    const input = await openNicknameEditor();
    await fireEvent.input(input, { target: { value: 'Saved nickname' } });
    await fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Saved nickname' })).toBeTruthy());
    pending.resolve(profile);
    await waitFor(() => expect((screen.getByRole('button', { name: 'common.refresh' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('heading', { name: 'Saved nickname' })).toBeTruthy();
    expect(authStore.displayName).toBe('Saved nickname');
  });

  it('explains a denied self-query without claiming the user has no permissions', async () => {
    mocks.getUserInfo.mockRejectedValueOnce(new Error('Server returned 403: denied'));
    render(AccountSettingsPage);
    await waitFor(() => expect(screen.getByText('settings.account.profileDenied')).toBeTruthy());
    expect(screen.queryByText('settings.account.noPermissions')).toBeNull();
  });

  it('refreshes on reconnect and rejects an earlier response from the disconnected request', async () => {
    const pending = deferred<ManagedUserInfo>();
    mocks.getUserInfo.mockReturnValueOnce(pending.promise);
    render(AccountSettingsPage);
    await waitFor(() => expect(mocks.getUserInfo).toHaveBeenCalledOnce());
    serverStateStore.connected = false;
    await waitFor(() => expect(screen.getByText('settings.account.offline')).toBeTruthy());
    serverStateStore.connected = true;
    await waitFor(() => expect(screen.getByText(profile.user_id)).toBeTruthy());
    pending.resolve({ ...profile, username: 'stale-name' });
    await waitFor(() => expect(mocks.getUserInfo).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('stale-name')).toBeNull();
  });

  it('clears data on logout and ignores responses for the previous account', async () => {
    const pending = deferred<ManagedUserInfo>();
    mocks.getUserInfo.mockReturnValueOnce(pending.promise);
    render(AccountSettingsPage);
    authStore.clear();
    await waitFor(() => expect(screen.queryByRole('heading')).toBeNull());
    authStore.apply({ ...authStatus, user_id: 'bob-id', username: 'bob', nickname: 'Bob' });
    mocks.getUserInfo.mockResolvedValue({ ...profile, user_id: 'bob-id', username: 'bob', nickname: 'Bob' });
    await waitFor(() => expect(screen.getByText('bob-id')).toBeTruthy());
    pending.resolve(profile);
    await waitFor(() => expect(screen.queryByText(profile.user_id)).toBeNull());
    expect(screen.getByText('bob-id')).toBeTruthy();
  });

  it('does not render or request profile information before sign-in', () => {
    authStore.clear();
    render(AccountSettingsPage);
    expect(mocks.getUserInfo).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('invalidates an in-flight response on unmount', async () => {
    const pending = deferred<ManagedUserInfo>();
    mocks.getUserInfo.mockReturnValueOnce(pending.promise);
    const view = render(AccountSettingsPage);
    view.unmount();
    pending.resolve(profile);
    expect(authStore.permissions).toEqual([]);
    expect(notificationStore.entries).toEqual([]);
  });

  it.each(['set_user_avatar', 'super_set_user_avatar'])('allows avatar editing with %s', async (permission) => {
    authStore.apply({ ...authStatus, permissions: [permission] });
    render(AccountSettingsPage);
    expect(screen.getByRole('button', { name: 'avatar.change' })).toBeTruthy();
  });

  it('keeps the avatar static without a grant', () => {
    render(AccountSettingsPage);
    expect(screen.queryByRole('button', { name: 'avatar.change' })).toBeNull();
    expect(screen.getByText('settings.account.avatarReadOnly')).toBeTruthy();
  });
});
