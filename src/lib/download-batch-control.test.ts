import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginDownloadBatch, finishDownloadBatch, stopDownloadBatchAndWait, waitForDownloadBatchResume, pauseActiveDownloadBatches } from './download-batch-control';

afterEach(() => vi.useRealTimers());

describe('stopping download batch producers', () => {
  it('waits for in-flight queueing to finish before acknowledging a stop', async () => {
    const controller = beginDownloadBatch({ batchId: 'batch', batchName: 'Folder', batchCreatedAt: 1 });
    let stopped = false;
    const waiting = stopDownloadBatchAndWait('batch').then(() => { stopped = true; });
    expect(controller.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishDownloadBatch(controller);
    await waiting;
    expect(stopped).toBe(true);
  });

  it('aborts paused discovery and preserves a timeout as a failure', async () => {
    vi.useFakeTimers();
    const controller = beginDownloadBatch({ batchId: 'batch', batchName: 'Folder', batchCreatedAt: 1 });
    pauseActiveDownloadBatches('batch');
    const paused = waitForDownloadBatchResume(controller.signal);
    const stopped = stopDownloadBatchAndWait('batch');
    const pausedAssertion = expect(paused).rejects.toMatchObject({ name: 'AbortError' });
    const timeoutAssertion = expect(stopped).rejects.toThrow('10 seconds');
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([pausedAssertion, timeoutAssertion]);
    finishDownloadBatch(controller);
  });
});
