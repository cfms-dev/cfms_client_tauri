/// <reference lib="webworker" />

import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import { sortFileEntries, type SortDirection, type SortField } from './sorting';

interface SortRequest {
  id: number;
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  field: SortField;
  direction: SortDirection;
}

interface SortResponse {
  id: number;
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<SortRequest>) => {
  const { id, folders, documents, field, direction } = event.data;
  const sorted = sortFileEntries(folders, documents, field, direction);
  workerScope.postMessage({
    id,
    folders: sorted.folders,
    documents: sorted.documents,
  } satisfies SortResponse);
};
