import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBannedSubnet,
  disableManagedTwoFactor,
  getUserInfo,
  listAuthLockouts,
  listBannedSubnets,
  unlockAuthLockouts,
} from './admin';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe('admin API', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it.each([
    [0, 'active'],
    [1, 'disabled'],
    ['active', 'active'],
    ['disabled', 'disabled'],
  ] as const)('normalizes managed user status %j to %s', async (status, expected) => {
    invokeMock.mockResolvedValue({ username: 'alice', status });

    await expect(getUserInfo('alice')).resolves.toMatchObject({
      username: 'alice',
      status: expected,
    });
    expect(invokeMock).toHaveBeenCalledWith('get_user_info', { username: 'alice' });
  });

  it.each([undefined, null, 2, 'inactive'])('rejects unknown managed user status %j', async (status) => {
    invokeMock.mockResolvedValue({ username: 'alice', status });

    await expect(getUserInfo('alice')).rejects.toThrow('Invalid managed user status');
  });

  it('maps protocol v17 security administration calls to Tauri commands', async () => {
    invokeMock.mockResolvedValueOnce(true);
    await disableManagedTwoFactor('alice');
    expect(invokeMock).toHaveBeenLastCalledWith('disable_managed_2fa', { username: 'alice' });

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
});
