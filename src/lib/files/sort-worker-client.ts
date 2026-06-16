import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import {
  sortFileEntries,
  type SortDirection,
  type SortField,
  type SortedFileEntries,
} from './sorting';

const WORKER_SORT_THRESHOLD = 400;

interface SortResponse extends SortedFileEntries {
  id: number;
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
