import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalDataResetStatus,
  resetLocalData,
  retryLocalDataReset,
} from './local-data';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => invokeMock.mockReset());

describe('local data reset IPC', () => {
  it('keeps downloaded files by default', async () => {
    invokeMock.mockResolvedValue(undefined);

    await resetLocalData();

    expect(invokeMock).toHaveBeenCalledWith('reset_local_data', {
      deleteDownloads: false,
    });
  });

  it('forwards the explicit download deletion choice', async () => {
    invokeMock.mockResolvedValue(undefined);

    await resetLocalData(true);

    expect(invokeMock).toHaveBeenCalledWith('reset_local_data', {
      deleteDownloads: true,
    });
  });

  it('uses dedicated status and recovery commands', async () => {
    const status = { pending: true, failures: [] };
    invokeMock.mockResolvedValue(status);

    await expect(getLocalDataResetStatus()).resolves.toEqual(status);
    await expect(retryLocalDataReset()).resolves.toEqual(status);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'get_local_data_reset_status');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'retry_local_data_reset');
  });
});
