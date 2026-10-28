import { writable } from 'svelte/store';
import type { DownloadBatchMetadata } from './api';
import { serverAvailability } from './api/server-errors';

export type DownloadBatchPhase = 'collecting' | 'queueing';

export interface DownloadBatchSnapshot {
  batchId: string;
  batchName: string;
  batchRootId: string | null;
  batchCreatedAt: number;
  phase: DownloadBatchPhase;
  paused: boolean;
  discovered: number;
  queued: number;
  failed: number;
  rateLimited: number;
  rateLimitWaiting: boolean;
}

let activeController: AbortController | null = null;
let activeBatchId: string | null = null;
let paused = false;
let resumeWaiters = new Set<() => void>();
const snapshots = new Map<string, DownloadBatchSnapshot>();
const completions = new Map<AbortController, () => void>();
const finished = new Map<AbortController, Promise<void>>();

export const downloadBatchSnapshots = writable<DownloadBatchSnapshot[]>([]);

export function beginDownloadBatch(batch: DownloadBatchMetadata) {
  if (activeController) {
    paused = false;
    activeController.abort();
    if (activeBatchId) removeDownloadBatchSnapshot(activeBatchId);
  }
  activeController = new AbortController();
  const controller = activeController;
  finished.set(controller, new Promise<void>(resolve => completions.set(controller, resolve)));
  activeBatchId = batch.batchId;
  setDownloadBatchSnapshot(batch.batchId, {
    batchId: batch.batchId,
    batchName: batch.batchName,
    batchRootId: batch.batchRootId ?? null,
    batchCreatedAt: batch.batchCreatedAt,
    phase: 'collecting',
    paused: false,
    discovered: 0,
    queued: 0,
    failed: 0,
    rateLimited: 0,
    rateLimitWaiting: false,
  });
  return activeController;
}

export function finishDownloadBatch(controller: AbortController) {
  completions.get(controller)?.();
  completions.delete(controller);
  finished.delete(controller);
  if (activeController === controller) {
    if (activeBatchId) removeDownloadBatchSnapshot(activeBatchId);
    activeController = null;
    activeBatchId = null;
  }
}

/** An in-flight request must settle before callers can report producer cleanup. */
export async function stopDownloadBatchAndWait(batchId: string): Promise<void> {
  if (activeBatchId !== batchId || !activeController) return;
  const completion = finished.get(activeController);
  stopActiveDownloadBatch(batchId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([completion, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Folder queueing did not stop within 10 seconds. Try again.')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

export function stopActiveDownloadBatch(batchId?: string | Event) {
  const requestedBatchId = typeof batchId === 'string' ? batchId : null;
  if (requestedBatchId && activeBatchId !== requestedBatchId) return;
  if (activeBatchId) {
    updateDownloadBatchSnapshot(activeBatchId, (snapshot) => ({ ...snapshot, paused: false }));
  }
  paused = false;
  activeController?.abort();
}

export function pauseActiveDownloadBatches(batchId?: string) {
  if (batchId && activeBatchId !== batchId) return false;
  if (!activeBatchId) return false;
  paused = true;
  updateDownloadBatchSnapshot(activeBatchId, (snapshot) => ({ ...snapshot, paused: true }));
  return true;
}

export function resumeActiveDownloadBatches(batchId?: string) {
  if (batchId && activeBatchId !== batchId) return false;
  if (!paused) return false;
  paused = false;
  if (activeBatchId) {
    updateDownloadBatchSnapshot(activeBatchId, (snapshot) => ({ ...snapshot, paused: false }));
  }
  const waiters = resumeWaiters;
  resumeWaiters = new Set();
  for (const resolve of waiters) resolve();
  return true;
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

export function markDownloadBatchFailed(batchId: string, error?: unknown, count = 1) {
  if (count <= 0) return;
  const rateLimited = serverAvailability(error)?.kind === 'rate_limited' ? count : 0;
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({
    ...snapshot,
    failed: snapshot.failed + count,
    rateLimited: snapshot.rateLimited + rateLimited,
  }));
}

export function setDownloadBatchRateLimitWaiting(batchId: string, waiting: boolean) {
  updateDownloadBatchSnapshot(batchId, (snapshot) => ({
    ...snapshot,
    rateLimitWaiting: waiting,
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
