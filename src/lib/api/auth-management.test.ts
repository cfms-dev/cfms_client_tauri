import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, deleteUserAuthPublicKey, dropEscalation, getUserAuthentication, registerUserAuthPublicKey, setUserAuthPolicies, updateUserAuthPublicKey } from './auth';
import { changeUserGroups, deleteUser, getManagedTwoFactorStatus, getUserInfo, listUserKeys, resetUserPassword } from './admin';
import { getUserAvatar, setUserAvatar } from './avatars';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const userId = 'aabbccdd-0000-4000-8000-000000000001';
beforeEach(() => { ipc.mockReset(); ipc.mockResolvedValue({ keys: [] }); });

describe('protocol 29 account selectors', () => {
  it('uses the same immutable ID across management, 2FA, keys and avatars', async () => {
    await deleteUser(userId);
    expect(ipc).toHaveBeenLastCalledWith('delete_user', { userId });
    await changeUserGroups(userId, ['staff']);
    expect(ipc).toHaveBeenLastCalledWith('change_user_groups', { userId, groups: ['staff'] });
    await resetUserPassword(userId, 'new-password', true, true);
    expect(ipc).toHaveBeenLastCalledWith('reset_user_password', { userId, newPassword: 'new-password', bypassPasswdRequirements: true, forceUpdateAfterLogin: true });
    await getManagedTwoFactorStatus(userId);
    expect(ipc).toHaveBeenLastCalledWith('get_managed_2fa_status', { userId });
    await listUserKeys(userId);
    expect(ipc).toHaveBeenLastCalledWith('list_user_keys', { userId });
    await getUserAvatar(userId);
    expect(ipc).toHaveBeenLastCalledWith('get_user_avatar', { userId });
    await setUserAvatar(userId, 'avatar-document');
    expect(ipc).toHaveBeenLastCalledWith('set_user_avatar', { userId, documentId: 'avatar-document' });
  });

  it('keeps UUID-shaped usernames distinct from ID lookup', async () => {
    ipc.mockResolvedValue({ user_id: userId, username: userId, status: 0, permissions: [], effective_permissions: [], effective_own_permissions: [], effective_inherited_permissions: [] });
    await getUserInfo({ username: userId });
    expect(ipc).toHaveBeenLastCalledWith('get_user_info', { username: userId });
    await getUserInfo({ userId });
    expect(ipc).toHaveBeenLastCalledWith('get_user_info', { userId });
  });
});

it('submits password changes without the old password', async () => {
  await changePassword('alice', 'new-password');
  expect(ipc).toHaveBeenLastCalledWith('change_password', { username: 'alice', newPassword: 'new-password' });
});

describe('authentication management IPC', () => {
  it('supports self service and an explicit delegated target for every endpoint', async () => {
    const policies = [
      { purpose: 'mfa' as const, expected_revision: 4, chains: [] },
      { purpose: 'escalation' as const, expected_revision: 7, chains: [] },
    ];
    for (const target of [undefined, userId]) {
      const userId = target ?? null;
      await getUserAuthentication(target);
      expect(ipc).toHaveBeenLastCalledWith('get_user_authentication', { userId });
      await setUserAuthPolicies(policies, target);
      expect(ipc).toHaveBeenLastCalledWith('set_user_auth_policies', { userId, policies });
      await registerUserAuthPublicKey('ssh-ed25519 AAAA', null, target);
      expect(ipc).toHaveBeenLastCalledWith('register_user_auth_public_key', { userId, publicKey: 'ssh-ed25519 AAAA', label: null });
      await updateUserAuthPublicKey('key', null, target);
      expect(ipc).toHaveBeenLastCalledWith('update_user_auth_public_key', { userId, credentialId: 'key', label: null });
      await deleteUserAuthPublicKey('key', target);
      expect(ipc).toHaveBeenLastCalledWith('delete_user_auth_public_key', { userId, credentialId: 'key' });
    }
    await dropEscalation();
    expect(ipc).toHaveBeenLastCalledWith('drop_escalation');
  });
});
