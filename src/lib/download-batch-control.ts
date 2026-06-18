import { writable } from 'svelte/store';
import type { DownloadBatchMetadata } from './api';

export type DownloadBatchPhase = 'collecting' | 'queueing';

export interface DownloadBatchSnapshot {
  batchId: string;
  batchName: string;
  batchRootId: string | null;
  batchCreatedAt: number;
  phase: DownloadBatchPhase;
  discovered: number;
  queued: number;
  failed: number;
}

let activeController: AbortController | null = null;
let activeBatchId: string | null = null;
let paused = false;
let resumeWaiters = new Set<() => void>();
const snapshots = new Map<string, DownloadBatchSnapshot>();

export const downloadBatchSnapshots = writable<DownloadBatchSnapshot[]>([]);

export function beginDownloadBatch(batch: DownloadBatchMetadata) {
  if (activeController) {
    activeController.abort();
    if (activeBatchId) removeDownloadBatchSnapshot(activeBatchId);
  }
  activeController = new AbortController();
  activeBatchId = batch.batchId;
  setDownloadBatchSnapshot(batch.batchId, {
    batchId: batch.batchId,
    batchName: batch.batchName,
    batchRootId: batch.batchRootId ?? null,
    batchCreatedAt: batch.batchCreatedAt,
    phase: 'collecting',
    discovered: 0,
    queued: 0,
    failed: 0,
  });
  return activeController;
}

export function finishDownloadBatch(controller: AbortController) {
  if (activeController === controller) {
    if (activeBatchId) removeDownloadBatchSnapshot(activeBatchId);
    activeController = null;
    activeBatchId = null;
  }
}

export function stopActiveDownloadBatch(batchId?: string | Event) {
  const requestedBatchId = typeof batchId === 'string' ? batchId : null;
  if (requestedBatchId && activeBatchId !== requestedBatchId) return;
  activeController?.abort();
}

export function pauseActiveDownloadBatches() {
  paused = true;
}

export function resumeActiveDownloadBatches() {
  if (!paused) return;
  paused = false;
  const waiters = resumeWaiters;
  resumeWaiters = new Set();
  for (const resolve of waiters) resolve();
}

export function throwIfDownloadBatchStopped(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('Folder download queueing stopped.', 'AbortError');
  }
}

export async function waitForDownloadBatchResume(signal: AbortSignal) {
  while (paused) {
    throwIfDownloadBatchStopped(signal);
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        resumeWaiters.delete(resume);
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
      };

      signal.addEventListener('abort', abort, { once: true });
      resumeWaiters.add(resume);
    });
  }
  throwIfDownloadBatchStopped(signal);
}

export function isDownloadBatchStop(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function setDownloadBatchPhase(batchId: string, phase: DownloadBatchPhase) {
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({ ...snapshot, phase }));
}

export function addDiscoveredDownloadBatchItems(batchId: string, count: number) {
  if (count <= 0) return;
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({
    ...snapshot,
    discovered: snapshot.discovered + count,
  }));
}

export function markDownloadBatchQueued(batchId: string) {
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({
    ...snapshot,
    queued: snapshot.queued + 1,
  }));
}

export function markDownloadBatchFailed(batchId: string, count = 1) {
  if (count <= 0) return;
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({
    ...snapshot,
    failed: snapshot.failed + count,
  }));
}

function setDownloadBatchSnapshot(batchId: string, snapshot: DownloadBatchSnapshot) {
  snapshots.set(batchId, snapshot);
  publishDownloadBatchSnapshots();
}

function updateDownloadBatchSnapshot(
  batchId: string,
  updater: (snapshot: DownloadBatchSnapshot) => DownloadBatchSnapshot,
) {
  const snapshot = snapshots.get(batchId);
  if (!snapshot) return;
  snapshots.set(batchId, updater(snapshot));
  publishDownloadBatchSnapshots();
}

function removeDownloadBatchSnapshot(batchId: string) {
  snapshots.delete(batchId);
  publishDownloadBatchSnapshots();
}

function publishDownloadBatchSnapshots() {
  downloadBatchSnapshots.set([...snapshots.values()]);
}
