/// <reference lib="webworker" />

import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import { type SortDirection, type SortField } from '$lib/features/files/sorting';
import { ProgressiveListingAccumulator } from '$lib/features/files/progressive-listing';

interface ProgressiveResetRequest {
  type: 'progressive-reset';
  clientId: number;
  generation: number;
  revision: number;
  field: SortField;
  direction: SortDirection;
}

interface ProgressiveAppendRequest {
  type: 'progressive-append';
  clientId: number;
  generation: number;
  revision: number;
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  complete: boolean;
}

interface ProgressiveResortRequest {
  type: 'progressive-resort';
  clientId: number;
  generation: number;
  revision: number;
  field: SortField;
  direction: SortDirection;
}

type WorkerRequest = ProgressiveResetRequest | ProgressiveAppendRequest | ProgressiveResortRequest;

interface ProgressiveSnapshotResponse {
  type: 'progressive-snapshot';
  clientId: number;
  generation: number;
  revision: number;
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  loadedCount: number;
  complete: boolean;
}

const workerScope = self as DedicatedWorkerGlobalScope;
const progressiveAccumulator = new ProgressiveListingAccumulator();
let progressiveState: ProgressiveResetRequest | null = null;

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'progressive-reset') {
    progressiveState = request;
    progressiveAccumulator.reset();
    return;
  }
  if (request.type === 'progressive-append') {
    if (!progressiveState || request.clientId !== progressiveState.clientId || request.generation !== progressiveState.generation) return;
    progressiveState.revision = request.revision;
    const snapshot = progressiveAccumulator.append(
      request.folders,
      request.documents,
      request.complete,
      progressiveState.field,
      progressiveState.direction,
    );
    if (snapshot) {
      workerScope.postMessage({
        type: 'progressive-snapshot',
        clientId: request.clientId,
        generation: request.generation,
        revision: request.revision,
        ...snapshot,
      } satisfies ProgressiveSnapshotResponse);
    }
    return;
  }
  if (request.type === 'progressive-resort') {
    if (!progressiveState || request.clientId !== progressiveState.clientId || request.generation !== progressiveState.generation) return;
    progressiveState = { ...progressiveState, revision: request.revision, field: request.field, direction: request.direction };
    const snapshot = progressiveAccumulator.snapshot(request.field, request.direction);
    if (snapshot.loadedCount === 0 && !snapshot.complete) return;
    workerScope.postMessage({
      type: 'progressive-snapshot',
      clientId: request.clientId,
      generation: request.generation,
      revision: request.revision,
      ...snapshot,
    } satisfies ProgressiveSnapshotResponse);
    return;
  }
};
