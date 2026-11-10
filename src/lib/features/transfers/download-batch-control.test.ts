import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDownloadBatches } from '$lib/api';
import { downloadBatchSnapshots, refreshDownloadBatches, resetDownloadBatches } from './download-batch-control';
import { deferred } from '../../../test/deferred';
vi.mock('$lib/api', () => ({ getDownloadBatches: vi.fn() }));
beforeEach(() => resetDownloadBatches());
describe('native producer snapshots', () => {
  it('does not publish a late snapshot after the session is cleared', async () => {
    const response = deferred<Awaited<ReturnType<typeof getDownloadBatches>>>();
    vi.mocked(getDownloadBatches).mockReturnValueOnce(response.promise);
    const refreshing = refreshDownloadBatches();
    resetDownloadBatches();
    response.resolve([{ batchId: 'old', batchName: 'Folder', batchRootId: null, batchCreatedAt: 1, phase: 'collecting', paused: false, discovered: 0, queued: 0, failed: 0, rateLimited: 0, rateLimitWaiting: false }]);
    await refreshing;
    expect(get(downloadBatchSnapshots)).toEqual([]);
  });
  it('exposes only active producers from the native snapshot', async () => {
    const batch = { batchId: 'a', batchName: 'Folder', batchRootId: null, batchCreatedAt: 1, phase: 'queueing' as const, paused: false, discovered: 3, queued: 2, failed: 0, rateLimited: 0, rateLimitWaiting: false };
    vi.mocked(getDownloadBatches).mockResolvedValueOnce([batch, { ...batch, batchId: 'b', finished: true }]);
    await refreshDownloadBatches();
    expect(get(downloadBatchSnapshots)).toEqual([batch]);
  });
});
