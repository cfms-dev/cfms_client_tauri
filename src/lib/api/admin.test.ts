import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBannedSubnet,
  changeGroupPermissions,
  changeUserPermissions,
  disableManagedTwoFactor,
  getGroupInfo,
  getServerDiagnostics,
  getUserInfo,
  listAuthLockouts,
  listBannedSubnets,
  listGroups,
  listUsers,
  manageUserStatus,
  setUserNickname,
  setLockdown,
  unlockAuthLockouts,
  updateUserBlock,
  viewAuditLogs,
} from './admin';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function managedUserInfoResponse(status: unknown) {
  return {
    username: 'alice',
    user_id: 'aabbccdd-0000-4000-8000-000000000001',
    status,
    permissions: [],
    effective_permissions: [],
    effective_own_permissions: [],
    effective_inherited_permissions: [],
  };
}

describe('admin API', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it.each([
    [0, 'active'],
    [1, 'disabled'],
  ] as const)('normalizes managed user status %j to %s', async (status, expected) => {
    invokeMock.mockResolvedValue(managedUserInfoResponse(status));

    await expect(getUserInfo({ username: 'alice' })).resolves.toMatchObject({
      username: 'alice',
      user_id: 'aabbccdd-0000-4000-8000-000000000001',
      status: expected,
    });
    expect(invokeMock).toHaveBeenCalledWith('get_user_info', { username: 'alice' });
  });

  it.each([undefined, null, 2, 'active', 'disabled', 'inactive'])('rejects unknown managed user status %j', async (status) => {
    invokeMock.mockResolvedValue(managedUserInfoResponse(status));

    await expect(getUserInfo({ username: 'alice' })).rejects.toThrow('Invalid managed user status');
  });

  it('rejects malformed permission responses at the IPC boundary', async () => {
    const user = {
      username: 'alice',
      user_id: 'aabbccdd-0000-4000-8000-000000000001',
      status: 'active',
      permissions: ['legacy_permission'],
      own_permissions: ['legacy_permission'],
      inherited_permissions: [],
    };
    const group = {
      name: 'staff',
      permissions: [],
      effective_permissions: null,
    };

    invokeMock.mockResolvedValueOnce({ users: [user] });
    await expect(listUsers()).rejects.toThrow('list_users.users[0] response');

    invokeMock.mockResolvedValueOnce(user);
    await expect(getUserInfo({ username: 'alice' })).rejects.toThrow(
      'get_user_info response: permissions[0] must be a structured permission entry',
    );

    invokeMock.mockResolvedValueOnce({ groups: [group] });
    await expect(listGroups()).rejects.toThrow('list_groups.groups[0] response');

    invokeMock.mockResolvedValueOnce(group);
    await expect(getGroupInfo('staff')).rejects.toThrow(
      'get_group_info response: effective_permissions must be an array of permission names',
    );
  });

  it('maps protocol v17 security administration calls to Tauri commands', async () => {
    invokeMock.mockResolvedValueOnce(true);
    await disableManagedTwoFactor('alice');
    expect(invokeMock).toHaveBeenLastCalledWith('disable_managed_2fa', { userId: 'alice' });

    invokeMock.mockResolvedValueOnce({ subnets: [] });
    await listBannedSubnets('active');
    expect(invokeMock).toHaveBeenLastCalledWith('list_banned_subnets', { status: 'active' });

    invokeMock.mockResolvedValueOnce({ subnet: '192.0.2.0/24' });
    await createBannedSubnet('192.0.2.1/24', 'abuse', 100, 200, true);
    expect(invokeMock).toHaveBeenLastCalledWith('create_banned_subnet', {
      subnet: '192.0.2.1/24',
      reason: 'abuse',
      startsAt: 100,
      expiresAt: 200,
      confirmSelfBlock: true,
    });

    invokeMock.mockResolvedValueOnce({ lockouts: [] });
    await listAuthLockouts();
    expect(invokeMock).toHaveBeenLastCalledWith('list_auth_lockouts');

    const locks = [{ scope: 'ip' as const, ip_address: '192.0.2.8' }];
    invokeMock.mockResolvedValueOnce({ cleared: locks, not_found: [] });
    await unlockAuthLockouts(locks, 'Reviewed by administrator');
    expect(invokeMock).toHaveBeenLastCalledWith('unlock_auth_lockouts', {
      locks,
      reason: 'Reviewed by administrator',
    });
  });

  it('maps protocol v22 server diagnostics to its dedicated Tauri command', async () => {
    const diagnostics = {
      schema_version: 1,
      server: {
        server_name: 'CFMS',
        core_version: '0.5.0',
        protocol_version: 24,
        debug_configured: false,
      },
    };
    invokeMock.mockResolvedValue(diagnostics);

    await expect(getServerDiagnostics()).resolves.toBe(diagnostics);
    expect(invokeMock).toHaveBeenCalledWith('server_diagnostics');
  });

  it('maps protocol v23 operation-reason updates to dedicated Tauri commands', async () => {
    invokeMock.mockResolvedValueOnce({ username: 'alice', status: 'disabled', reason: null });
    await manageUserStatus('alice', 'disabled', null);
    expect(invokeMock).toHaveBeenLastCalledWith('manage_user_status', {
      userId: 'alice',
      status: 'disabled',
      reason: null,
    });

    invokeMock.mockResolvedValueOnce({ status: true, reason: '  incident  ' });
    await setLockdown(true, '  incident  ');
    expect(invokeMock).toHaveBeenLastCalledWith('set_lockdown', {
      status: true,
      reason: '  incident  ',
    });

    invokeMock.mockResolvedValueOnce({ block_id: 'block-1', reason: null });
    await updateUserBlock('block-1', null);
    expect(invokeMock).toHaveBeenLastCalledWith('update_user_block', {
      blockId: 'block-1',
      reason: null,
    });
  });

  it('passes exact audit action filters through Tauri IPC and normalizes page defaults', async () => {
    invokeMock.mockResolvedValue({ entries: [{ id: 'audit-1', action: 'login' }] });

    await expect(viewAuditLogs('cursor-1', 50, ['login', 'extension_action'])).resolves.toMatchObject({
      entries: [{ id: 'audit-1', action: 'login' }],
      page_size: 50,
      next_cursor: null,
      has_more: false,
    });
    expect(invokeMock).toHaveBeenCalledWith('view_audit_logs', {
      cursor: 'cursor-1',
      pageSize: 50,
      filters: ['login', 'extension_action'],
    });
  });

  it('passes protocol v24 permission entries through Tauri IPC', async () => {
    const permissions = [{
      permission: 'list_users',
      granted: false,
      start_time: 1_787_200_000,
      end_time: null,
    }];
    invokeMock.mockResolvedValue(true);

    await changeUserPermissions('alice', permissions);
    expect(invokeMock).toHaveBeenLastCalledWith('change_user_permissions', {
      userId: 'alice',
      permissions,
    });

    await changeGroupPermissions('staff', permissions);
    expect(invokeMock).toHaveBeenLastCalledWith('change_group_permissions', {
      groupName: 'staff',
      permissions,
    });
  });

  it.each([
    ['Display Name', 'Display Name'],
    [null, null],
  ] as const)('passes nickname value %j to the rename command', async (nickname, expected) => {
    invokeMock.mockResolvedValue(true);

    await expect(setUserNickname('alice', nickname)).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('set_user_nickname', {
      userId: 'alice',
      nickname: expected,
    });
  });
});
