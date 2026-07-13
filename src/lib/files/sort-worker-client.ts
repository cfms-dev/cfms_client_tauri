import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import {
  sortFileEntries,
  type SortDirection,
  type SortField,
  type SortedFileEntries,
} from './sorting';
import { ProgressiveListingAccumulator } from './progressive-listing';

const WORKER_SORT_THRESHOLD = 400;

interface SortResponse extends SortedFileEntries {
  type?: 'sort-once';
  id: number;
}

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

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (value: SortedFileEntries) => void;
    reject: (reason?: unknown) => void;
  }
>();

export function shouldDeferFileSort(foldersLength: number, documentsLength: number): boolean {
  return foldersLength + documentsLength >= WORKER_SORT_THRESHOLD;
}

export function sortFileEntriesAsync(
  folders: ServerDirectoryEntry[],
  documents: ServerDocumentEntry[],
  field: SortField,
  direction: SortDirection,
): Promise<SortedFileEntries> {
  if (!shouldDeferFileSort(folders.length, documents.length) || typeof Worker === 'undefined') {
    return Promise.resolve(sortFileEntries(folders, documents, field, direction));
  }

  const sortWorker = getSortWorker();
  if (!sortWorker) {
    return Promise.resolve(sortFileEntries(folders, documents, field, direction));
  }

  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sortWorker.postMessage({ id, folders, documents, field, direction });
  });
}

function getSortWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(new URL('./file-sort.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('File sort worker is unavailable; falling back to main-thread sorting.', error);
    worker = null;
    return null;
  }

  worker.onmessage = (event: MessageEvent<SortResponse>) => {
    const { id, folders, documents } = event.data;
    const task = pending.get(id);
    if (!task) return;

    pending.delete(id);
    task.resolve({ folders, documents });
  };

  worker.onerror = (event) => {
    const error = event.error ?? new Error(event.message);
    for (const task of pending.values()) {
      task.reject(error);
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  return worker;
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

  if (progressiveWorker) {
    progressiveWorker.onmessage = (event: MessageEvent<ProgressiveSortSnapshot & { type: string; clientId: number }>) => {
      if (event.data.type !== 'progressive-snapshot' || event.data.clientId !== clientId) return;
      onSnapshot(event.data);
    };
    progressiveWorker.onerror = (event) => onError(event.error ?? new Error(event.message));
  }

  return {
    reset(generation, revision, field, direction) {
      if (progressiveWorker) {
        progressiveWorker.postMessage({ type: 'progressive-reset', clientId, generation, revision, field, direction });
        return;
      }
      fallbackGeneration = generation;
      fallbackRevision = revision;
      fallbackField = field;
      fallbackDirection = direction;
      fallbackAccumulator.reset();
    },
    append(generation, revision, folders, documents, complete) {
      if (progressiveWorker) {
        progressiveWorker.postMessage({ type: 'progressive-append', clientId, generation, revision, folders, documents, complete });
        return;
      }
      try {
        if (generation !== fallbackGeneration) return;
        fallbackRevision = revision;
        const snapshot = fallbackAccumulator.append(folders, documents, complete, fallbackField, fallbackDirection);
        if (snapshot) onSnapshot({ generation, revision, ...snapshot });
      } catch (error) {
        onError(error);
      }
    },
    resort(generation, revision, field, direction) {
      if (progressiveWorker) {
        progressiveWorker.postMessage({ type: 'progressive-resort', clientId, generation, revision, field, direction });
        return;
      }
      fallbackRevision = revision;
      fallbackField = field;
      fallbackDirection = direction;
      try {
        if (generation !== fallbackGeneration) return;
        const snapshot = fallbackAccumulator.snapshot(field, direction);
        if (snapshot.loadedCount === 0 && !snapshot.complete) return;
        onSnapshot({ generation, revision, ...snapshot });
      } catch (error) {
        onError(error);
      }
    },
    dispose() {
      progressiveWorker?.terminate();
      progressiveWorker = null;
      fallbackGeneration += 1;
    },
  };
}
