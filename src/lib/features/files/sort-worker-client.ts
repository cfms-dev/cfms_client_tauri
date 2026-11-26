import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import {
  type SortDirection,
  type SortField,
  type SortedFileEntries,
} from '$lib/features/files/sorting';
import { DIRECTORY_PAGE_SIZE, ProgressiveListingAccumulator } from '$lib/features/files/progressive-listing';

const PROGRESSIVE_WORKER_RESPONSE_TIMEOUT_MS = 1_000;

export interface ProgressiveSortSnapshot extends SortedFileEntries {
  generation: number;
  revision: number;
  loadedCount: number;
  complete: boolean;
}

export interface ProgressiveDirectorySorter {
  reset: (generation: number, revision: number, field: SortField, direction: SortDirection) => void;
  append: (generation: number, revision: number, folders: ServerDirectoryEntry[], documents: ServerDocumentEntry[], complete: boolean) => void;
  resort: (generation: number, revision: number, field: SortField, direction: SortDirection) => void;
  dispose: () => void;
}

let nextProgressiveClientId = 1;

export function createProgressiveDirectorySorter(
  onSnapshot: (snapshot: ProgressiveSortSnapshot) => void,
  onError: (error: unknown) => void,
): ProgressiveDirectorySorter {
  const clientId = nextProgressiveClientId++;
  let progressiveWorker: Worker | null = null;
  try {
    if (typeof Worker !== 'undefined') {
      progressiveWorker = new Worker(new URL('./file-sort.worker.ts', import.meta.url), { type: 'module' });
    }
  } catch (error) {
    console.warn('Progressive file sorter is unavailable; using the main thread.', error);
  }

  let fallbackGeneration = 0;
  let fallbackRevision = 0;
  let fallbackField: SortField = 'name';
  let fallbackDirection: SortDirection = 'asc';
  const fallbackAccumulator = new ProgressiveListingAccumulator();
  let pendingFallbackSnapshot: ProgressiveSortSnapshot | null = null;
  let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastPublishedSnapshot: Pick<
    ProgressiveSortSnapshot,
    'generation' | 'revision' | 'loadedCount' | 'complete'
  > | null = null;

  function clearFallbackTimeout() {
    if (fallbackTimeout === null) return;
    clearTimeout(fallbackTimeout);
    fallbackTimeout = null;
  }

  function publishSnapshot(snapshot: ProgressiveSortSnapshot) {
    if (
      lastPublishedSnapshot
      && snapshot.generation === lastPublishedSnapshot.generation
      && snapshot.revision === lastPublishedSnapshot.revision
      && snapshot.loadedCount === lastPublishedSnapshot.loadedCount
      && snapshot.complete === lastPublishedSnapshot.complete
    ) return;
    lastPublishedSnapshot = snapshot;
    onSnapshot(snapshot);
  }

  function disableWorker(reason: unknown) {
    clearFallbackTimeout();
    progressiveWorker?.terminate();
    progressiveWorker = null;
    if (reason) {
      console.warn('Progressive file sorter stopped responding; using the main thread.', reason);
    }
  }

  function publishPendingFallback() {
    const snapshot = pendingFallbackSnapshot;
    pendingFallbackSnapshot = null;
    if (!snapshot) return;
    disableWorker(new Error('Progressive file sorter response timed out.'));
    publishSnapshot(snapshot);
  }

  function armFallback(snapshot: ProgressiveSortSnapshot) {
    pendingFallbackSnapshot = snapshot;
    clearFallbackTimeout();
    fallbackTimeout = setTimeout(
      publishPendingFallback,
      PROGRESSIVE_WORKER_RESPONSE_TIMEOUT_MS,
    );
  }

  function snapshotFallback(revision = fallbackRevision): ProgressiveSortSnapshot | null {
    const snapshot = fallbackAccumulator.snapshot(fallbackField, fallbackDirection);
    if (snapshot.loadedCount === 0 && !snapshot.complete) return null;
    return {
      generation: fallbackGeneration,
      revision,
      ...snapshot,
    };
  }

  if (progressiveWorker) {
    progressiveWorker.onmessage = (event: MessageEvent<ProgressiveSortSnapshot & { type: string; clientId: number }>) => {
      if (event.data.type !== 'progressive-snapshot' || event.data.clientId !== clientId) return;
      if (
        pendingFallbackSnapshot
        && event.data.generation === pendingFallbackSnapshot.generation
        && event.data.revision === pendingFallbackSnapshot.revision
        && event.data.loadedCount >= pendingFallbackSnapshot.loadedCount
      ) {
        pendingFallbackSnapshot = null;
        clearFallbackTimeout();
      }
      publishSnapshot(event.data);
    };
    progressiveWorker.onerror = (event) => {
      const snapshot = pendingFallbackSnapshot ?? snapshotFallback();
      pendingFallbackSnapshot = null;
      disableWorker(event.error ?? new Error(event.message));
      if (snapshot) publishSnapshot(snapshot);
    };
    progressiveWorker.onmessageerror = () => {
      const snapshot = pendingFallbackSnapshot ?? snapshotFallback();
      pendingFallbackSnapshot = null;
      disableWorker(new Error('Progressive file sorter returned an unreadable response.'));
      if (snapshot) publishSnapshot(snapshot);
    };
  }

  return {
    reset(generation, revision, field, direction) {
      clearFallbackTimeout();
      pendingFallbackSnapshot = null;
      fallbackGeneration = generation;
      fallbackRevision = revision;
      fallbackField = field;
      fallbackDirection = direction;
      fallbackAccumulator.reset();
      if (progressiveWorker) {
        try {
          progressiveWorker.postMessage({ type: 'progressive-reset', clientId, generation, revision, field, direction });
        } catch (error) {
          disableWorker(error);
        }
      }
    },
    append(generation, revision, folders, documents, complete) {
      try {
        if (generation !== fallbackGeneration) return;
        fallbackRevision = revision;
        const snapshot = fallbackAccumulator.append(folders, documents, complete, fallbackField, fallbackDirection);
        const progressiveSnapshot = snapshot ? { generation, revision, ...snapshot } : null;
        if (progressiveWorker) {
          try {
            progressiveWorker.postMessage({ type: 'progressive-append', clientId, generation, revision, folders, documents, complete });
          } catch (error) {
            disableWorker(error);
          }
        }
        if (!progressiveSnapshot) return;
        if (!progressiveWorker) {
          publishSnapshot(progressiveSnapshot);
        } else if (progressiveSnapshot.loadedCount <= DIRECTORY_PAGE_SIZE) {
          publishSnapshot(progressiveSnapshot);
          armFallback(progressiveSnapshot);
        } else {
          armFallback(progressiveSnapshot);
        }
      } catch (error) {
        onError(error);
      }
    },
    resort(generation, revision, field, direction) {
      fallbackRevision = revision;
      fallbackField = field;
      fallbackDirection = direction;
      try {
        if (generation !== fallbackGeneration) return;
        const snapshot = fallbackAccumulator.snapshot(field, direction);
        if (snapshot.loadedCount === 0 && !snapshot.complete) return;
        const progressiveSnapshot = { generation, revision, ...snapshot };
        if (progressiveWorker) {
          try {
            progressiveWorker.postMessage({ type: 'progressive-resort', clientId, generation, revision, field, direction });
          } catch (error) {
            disableWorker(error);
          }
        }
        if (!progressiveWorker) publishSnapshot(progressiveSnapshot);
        else armFallback(progressiveSnapshot);
      } catch (error) {
        onError(error);
      }
    },
    dispose() {
      clearFallbackTimeout();
      pendingFallbackSnapshot = null;
      disableWorker(null);
      fallbackGeneration += 1;
    },
  };
}
