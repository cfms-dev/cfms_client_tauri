import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import UserAvatarPicker from '$lib/features/authentication/UserAvatarPicker.svelte';

const mocks = vi.hoisted(() => ({ set: vi.fn(), avatar: vi.fn(), download: vi.fn(), directory: vi.fn() }));
vi.mock('$lib/api', async (original) => ({
  ...await original<typeof import('$lib/api')>(),
  setUserAvatar: mocks.set, getUserAvatar: mocks.avatar, downloadAvatar: mocks.download, listDirectory: mocks.directory,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => `asset://localhost/${path}` }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

const status = { user_id: 'self-id', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 1_900_000_000, permissions: ['set_user_avatar'], groups: [], avatar_path: 'old.png' };
const onClose = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function select() {
  await fireEvent.click(await screen.findByRole('button', { name: 'portrait.png' }));
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  locale.set('en');
  authStore.clear();
  authStore.apply(status);
  serverStateStore.updateConnection(true, 'wss://example.test', false);
  notificationStore.clear();
  onClose.mockReset();
  mocks.set.mockReset().mockResolvedValue(true);
  mocks.avatar.mockReset().mockResolvedValue({ task_id: 'avatar-task' });
  mocks.download.mockReset().mockResolvedValue('updated.png');
  mocks.directory.mockReset().mockResolvedValue({ folders: [], documents: [{ id: 'image-id', title: 'portrait.png' }, { id: 'text-id', title: 'report.txt' }], parent_id: null });
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('avatar changes in their owning session', () => {
  it.each(['set_user_avatar', 'super_set_user_avatar'])('updates the shared avatar with %s', async (permission) => {
    authStore.apply({ ...status, permissions: [permission] });
    render(UserAvatarPicker, { onClose });
    await select();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'report.txt' })).toBeNull();
    expect(mocks.set).toHaveBeenCalledWith('self-id', 'image-id');
    expect(authStore.avatarPath).toBe('updated.png');
    expect(notificationStore.entries[0].type).toBe('success');
  });

  it('cancels without writing', async () => {
    render(UserAvatarPicker, { onClose });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.set).not.toHaveBeenCalled();
    expect(authStore.avatarPath).toBe('old.png');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not start an update without permission', async () => {
    authStore.permissions = [];
    render(UserAvatarPicker, { onClose });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('keeps the old avatar and explains a forbidden update', async () => {
    mocks.set.mockRejectedValue(new Error('Server returned 403: denied'));
    render(UserAvatarPicker, { onClose });
    await select();
    await waitFor(() => expect(notificationStore.entries[0]?.type).toBe('error'));
    expect(notificationStore.entries[0].text).toContain('permission');
    expect(authStore.avatarPath).toBe('old.png');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retains the old preview and reports a failed download', async () => {
    mocks.download.mockResolvedValue(null);
    render(UserAvatarPicker, { onClose });
    await select();
    await waitFor(() => expect(notificationStore.entries[0]?.type).toBe('error'));
    expect(notificationStore.entries[0].text).toContain('preview could not load');
    expect(authStore.avatarPath).toBe('old.png');
  });

  it('ignores a download after switching accounts', async () => {
    const pending = deferred<string | null>();
    mocks.download.mockReturnValue(pending.promise);
    render(UserAvatarPicker, { onClose });
    await select();
    await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
    authStore.apply({ ...status, user_id: 'bob-id', username: 'bob', avatar_path: 'bob.png' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    pending.resolve('alice-late.png');
    await Promise.resolve();
    expect(authStore.avatarPath).toBe('bob.png');
    expect(notificationStore.entries).toEqual([]);
  });

  it('closes on logout and never starts another request after an in-flight save', async () => {
    const pending = deferred<boolean>();
    mocks.set.mockReturnValue(pending.promise);
    render(UserAvatarPicker, { onClose });
    await select();
    expect(screen.getByRole('status').textContent).toContain('Saving');
    expect((screen.getByRole('button', { name: 'portrait.png' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    authStore.clear();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    pending.resolve(true);
    await Promise.resolve();
    expect(mocks.avatar).not.toHaveBeenCalled();
    expect(notificationStore.entries).toEqual([]);
  });
});
