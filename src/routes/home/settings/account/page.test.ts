// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore, notificationStore } from '$lib/stores.svelte';
import AccountSettingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  renameUser: vi.fn(),
  getAuthStatus: vi.fn(),
  getTwoFactorStatus: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api', () => ({
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
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/account') },
}));
vi.mock('$lib/navigation', () => ({ navigateUp: vi.fn() }));
vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

const authStatus = {
  username: 'alice',
  nickname: 'Alice',
  has_token: true,
  token_exp: 1_900_000_000,
  permissions: [],
  groups: [],
};

beforeEach(() => {
  authStore.clear();
  authStore.apply(authStatus);
  notificationStore.clear();
  mocks.getAuthStatus.mockResolvedValue(authStatus);
  mocks.getTwoFactorStatus.mockResolvedValue({
    enabled: false,
    method: null,
    backup_codes_count: 0,
  });
  mocks.renameUser.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authStore.clear();
  notificationStore.clear();
});

async function openNicknameEditor() {
  await fireEvent.click(screen.getByRole('button', {
    name: 'settings.account.editNickname',
  }));
  return screen.getByRole('textbox', { name: 'settings.account.nicknameLabel' });
}

describe('account nickname settings', () => {
  it('lets an ordinary user save a trimmed nickname and updates global auth state', async () => {
    render(AccountSettingsPage);
    const input = await openNicknameEditor();

    await fireEvent.input(input, { target: { value: '  New Name  ' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mocks.renameUser).toHaveBeenCalledWith('alice', 'New Name');
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

    await waitFor(() => expect(mocks.renameUser).toHaveBeenCalledWith('alice', null));
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
