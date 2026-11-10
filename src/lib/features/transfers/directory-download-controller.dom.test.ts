import '$lib/shared/i18n';
import { get } from 'svelte/store';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryDownloadController } from './directory-download-controller';
import { beginDownloadBatch, finishDownloadBatch, downloadBatchSnapshots } from './download-batch-control';

const mocks = vi.hoisted(() => ({ listDirectory: vi.fn(), ensureDownloadSubdirectory: vi.fn(), getDocument: vi.fn() }));
vi.mock('$lib/api', () => mocks);

let active: AbortController;
const batch = { batchId: 'test-batch', batchName: 'Evidence', batchRootId: null, batchCreatedAt: 123 };

beforeEach(() => {
  locale.set('en');
  mocks.listDirectory.mockReset();
  mocks.getDocument.mockReset().mockResolvedValue(undefined);
  mocks.ensureDownloadSubdirectory.mockReset().mockResolvedValue(undefined);
  active = beginDownloadBatch(batch);
});

afterEach(() => {
  finishDownloadBatch(active);
  vi.useRealTimers();
});

describe('directory download workflow', () => {
  it('discovers nested documents and creates sanitized paths for empty directories too', async () => {
    mocks.listDirectory.mockImplementation(async (id: string) => id === 'root'
      ? { documents: [{ id: 'one', title: 'report?.txt' }], folders: [{ id: 'empty', name: 'Empty' }] }
      : { documents: [], folders: [] });
    const controller = createDirectoryDownloadController(vi.fn());
    const collected = await controller.collectDirectoryDownloadItems({ id: 'root', name: 'Case:1' }, ['Case:1'], active.signal, batch.batchId);
    expect(collected.items).toHaveLength(1);
    expect(mocks.ensureDownloadSubdirectory.mock.calls.map(([name]) => name)).toEqual(['Case 1', 'Case 1/Empty']);
    await controller.queueCollectedDownloads(collected.items, active.signal, batch);
    expect(mocks.getDocument).toHaveBeenCalledWith('one', 'Case 1/report .txt', { ...batch, batchEstimatedTotal: 1 });
    expect(get(downloadBatchSnapshots).find((item) => item.batchId === batch.batchId)?.queued).toBe(1);
  });

  it('continues after a rejected item and persists an estimate based on accepted work', async () => {
    mocks.getDocument.mockRejectedValueOnce(new Error('Server returned 403: forbidden'));
    const controller = createDirectoryDownloadController(vi.fn());
    const result = await controller.queueCollectedDownloads([
      { document: { id: 'denied', title: 'denied.txt' }, pathParts: [] },
      { document: { id: 'allowed', title: 'allowed.txt' }, pathParts: [] },
    ], active.signal, batch);
    expect(result).toEqual({ queued: 1, failed: 1, rateLimited: 0 });
    expect(mocks.getDocument).toHaveBeenLastCalledWith('allowed', 'allowed.txt', { ...batch, batchEstimatedTotal: 1 });
  });

  it('honors the server retry delay and clears the waiting state after admission', async () => {
    vi.useFakeTimers();
    mocks.getDocument.mockRejectedValueOnce('Server returned 429: slow\nCFMS_ERROR_DATA:{"retry_after_seconds":1}');
    const status = vi.fn();
    const controller = createDirectoryDownloadController(status);
    const queued = controller.queueDocumentDownload({ id: 'one', title: 'one' }, [], active.signal, batch);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.getDocument).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await queued;
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith(null);
    expect(get(downloadBatchSnapshots).find((item) => item.batchId === batch.batchId)?.rateLimitWaiting).toBe(false);
  });

  it('does not enqueue after a batch has been cancelled', async () => {
    active.abort();
    const controller = createDirectoryDownloadController(vi.fn());
    await expect(controller.queueDocumentDownload({ id: 'one', title: 'one' }, [], active.signal, batch))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
});
