import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { ensureDownloadSubdirectory, getDocument, listDirectory, type DownloadBatchMetadata, type ServerDirectoryEntry, type ServerDocumentEntry } from '$lib/api';
import { serverAvailability } from '$lib/api/server-errors';
import { addDiscoveredDownloadBatchItems, isDownloadBatchStop, markDownloadBatchFailed, markDownloadBatchQueued, setDownloadBatchRateLimitWaiting, waitForDownloadBatchResume } from './download-batch-control';

export type DownloadQueueItem = {
    document: Pick<ServerDocumentEntry, 'id' | 'title'>;
    pathParts: string[];
  };


const MAX_BATCH_RATE_LIMIT_RETRIES = 3;

/** Discover and queue directory downloads without coupling work to a view. */
export function createDirectoryDownloadController(setStatus: (status: string | null) => void) {
  async function queueDocumentDownload(
    doc: Pick<ServerDocumentEntry, 'id' | 'title'>,
    pathParts: string[],
    signal: AbortSignal,
    batch?: DownloadBatchMetadata,
  ) {
    await waitForDownloadBatchResume(signal);
    await runBatchRateLimitedRequest(
      () => getDocument(doc.id, makeDownloadPath([...pathParts, doc.title]), batch),
      signal,
      batch?.batchId,
    );
    await waitForDownloadBatchResume(signal);
  }

  async function collectDirectoryDownloadItems(
    folder: Pick<ServerDirectoryEntry, 'id' | 'name'>,
    pathParts: string[],
    signal: AbortSignal,
    batchId?: string,
  ): Promise<{ items: DownloadQueueItem[]; failed: number; rateLimited: number }> {
    await waitForDownloadBatchResume(signal);
    const response = await runBatchRateLimitedRequest(
      () => listDirectory(folder.id),
      signal,
      batchId,
    );
    await waitForDownloadBatchResume(signal);
    const items: DownloadQueueItem[] = [];
    let failed = 0;
    let rateLimited = 0;
    const downloadPath = makeDownloadPath(pathParts);

    try {
      await ensureDownloadSubdirectory(downloadPath);
    } catch (e) {
      failed += 1;
      if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
      if (batchId) markDownloadBatchFailed(batchId, e);
    }

    for (const doc of response.documents) {
      await waitForDownloadBatchResume(signal);
      items.push({ document: doc, pathParts });
    }
    if (batchId) {
      addDiscoveredDownloadBatchItems(batchId, response.documents.length);
    }

    for (const child of response.folders) {
      await waitForDownloadBatchResume(signal);
      try {
        const result = await collectDirectoryDownloadItems(child, [...pathParts, child.name], signal, batchId);
        items.push(...result.items);
        failed += result.failed;
        rateLimited += result.rateLimited;
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
        if (batchId) markDownloadBatchFailed(batchId, e);
      }
    }

    return { items, failed, rateLimited };
  }

  async function queueCollectedDownloads(
    items: DownloadQueueItem[],
    signal: AbortSignal,
    batch: DownloadBatchMetadata,
  ): Promise<{ queued: number; failed: number; rateLimited: number }> {
    let queued = 0;
    let failed = 0;
    let rateLimited = 0;

    for (const item of items) {
      await waitForDownloadBatchResume(signal);
      try {
        // Only persist work that actually entered the queue in the durable
        // estimate. The live snapshot still carries the discovered total while
        // queueing, but a rejected item must not leave the completed batch at a
        // permanently misleading partial percentage.
        const queuedBatch = { ...batch, batchEstimatedTotal: queued + 1 };
        await queueDocumentDownload(item.document, item.pathParts, signal, queuedBatch);
        queued += 1;
        markDownloadBatchQueued(batch.batchId);
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
        markDownloadBatchFailed(batch.batchId, e);
      }
    }

    return { queued, failed, rateLimited };
  }

  async function runBatchRateLimitedRequest<T>(
    request: () => Promise<T>,
    signal: AbortSignal,
    batchId?: string,
  ): Promise<T> {
    let retryCount = 0;

    while (true) {
      await waitForDownloadBatchResume(signal);
      try {
        const result = await request();
        if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
        if (retryCount > 0) setStatus(null);
        return result;
      } catch (requestError) {
        const availability = serverAvailability(requestError);
        if (availability?.kind !== 'rate_limited' || retryCount >= MAX_BATCH_RATE_LIMIT_RETRIES) {
          if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
          if (retryCount > 0) setStatus(null);
          throw requestError;
        }

        retryCount += 1;
        const seconds = availability.retryAfterSeconds ?? Math.min(2 ** (retryCount - 1), 8);
        if (batchId) setDownloadBatchRateLimitWaiting(batchId, true);
        setStatus(get(t)('files.batchDownloadRateLimitWaiting', { values: { seconds } }));
        try {
          await waitForBatchRetryDelay(seconds * 1000, signal);
        } finally {
          if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
        }
      }
    }
  }

  function waitForBatchRetryDelay(delayMs: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
        return;
      }
      const complete = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timeout = window.setTimeout(complete, delayMs);
      const abort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  function createDownloadBatchMetadata(name: string, rootId: string | null): DownloadBatchMetadata {
    return {
      batchId: `download-batch:${Date.now()}:${randomBatchSuffix()}`,
      batchName: name || get(t)('tasks.folderBatch'),
      batchRootId: rootId,
      batchCreatedAt: Math.floor(Date.now() / 1000),
    };
  }

  function randomBatchSuffix() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2);
  }

  function makeDownloadPath(parts: string[]) {
    const safeParts = parts
      .map(sanitizeDownloadPathSegment)
      .filter(Boolean);

    return safeParts.length > 0 ? safeParts.join('/') : 'download';
  }

  function sanitizeDownloadPathSegment(part: string) {
    return part
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { queueDocumentDownload, collectDirectoryDownloadItems, queueCollectedDownloads, createDownloadBatchMetadata };
}
