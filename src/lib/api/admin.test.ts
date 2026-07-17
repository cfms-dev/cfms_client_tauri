import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserInfo } from './admin';

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
});
