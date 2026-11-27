import { getDirectoryInfo } from '#lib/api.ts';
import {
  isAccessDeniedError,
  serverAvailability,
  serverErrorStatus,
} from '#lib/api/server-errors.ts';
import { normalizeDirectoryId, ROOT_DIRECTORY_ID } from './file-browser';

export type ParentDirectoryResolution =
  | { status: 'resolved'; name: string; revealed: boolean }
  | { status: 'inaccessible' };

export interface SearchParentDirectoryResolverOptions {
  delayMs?: number;
  maxConcurrency?: number;
  fetchDirectoryInfo?: typeof getDirectoryInfo;
}

export const DEFAULT_PARENT_DIRECTORY_RESOLVE_DELAY_MS = 250;
export const DEFAULT_PARENT_DIRECTORY_MAX_CONCURRENCY = 4;

function isUnavailableDirectoryError(error: unknown): boolean {
  if (isAccessDeniedError(error)) return true;
  const status = serverErrorStatus(error);
  return status === 403 || status === 404 || status === 410;
}

export function createSearchParentDirectoryResolver(
  options: SearchParentDirectoryResolverOptions = {},
) {
  const delayMs = options.delayMs ?? DEFAULT_PARENT_DIRECTORY_RESOLVE_DELAY_MS;
  const maxConcurrency = Math.max(
    1,
    options.maxConcurrency ?? DEFAULT_PARENT_DIRECTORY_MAX_CONCURRENCY,
  );
  const fetchDirectoryInfo = options.fetchDirectoryInfo ?? getDirectoryInfo;

  let resolutions = $state<Record<string, ParentDirectoryResolution>>({});
  let sessionId = 0;
  let pausedForAvailability = false;

  const visibleCounts = new Map<string, number>();
  const delayTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queue: string[] = [];
  const queuedSet = new Set<string>();
  const inFlight = new Set<string>();

  function clearDelayTimer(id: string) {
    const timer = delayTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      delayTimers.delete(id);
    }
  }

  function removeFromQueue(id: string) {
    if (!queuedSet.has(id)) return;
    queuedSet.delete(id);
    const index = queue.indexOf(id);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  function clearPendingQueues() {
    for (const timer of delayTimers.values()) {
      clearTimeout(timer);
    }
    delayTimers.clear();
    queue.length = 0;
    queuedSet.clear();
  }

  function enqueue(id: string) {
    if (
      pausedForAvailability
      || id in resolutions
      || inFlight.has(id)
      || queuedSet.has(id)
      || (visibleCounts.get(id) ?? 0) <= 0
    ) {
      return;
    }
    queuedSet.add(id);
    queue.push(id);
    drain();
  }

  function drain() {
    while (!pausedForAvailability && inFlight.size < maxConcurrency && queue.length > 0) {
      const nextId = queue.shift()!;
      queuedSet.delete(nextId);
      if (
        (visibleCounts.get(nextId) ?? 0) <= 0
        || nextId in resolutions
        || inFlight.has(nextId)
      ) {
        continue;
      }
      fetchOne(nextId);
    }
  }

  function fetchOne(id: string) {
    const activeSession = sessionId;
    inFlight.add(id);

    void fetchDirectoryInfo(id)
      .then((info) => {
        if (activeSession !== sessionId) return;
        const resolvedName = info?.name?.trim();
        if (resolvedName) {
          resolutions[id] = {
            status: 'resolved',
            name: resolvedName,
            revealed: false,
          };
        }
      })
      .catch((error: unknown) => {
        if (activeSession !== sessionId) return;
        if (isUnavailableDirectoryError(error)) {
          resolutions[id] = { status: 'inaccessible' };
        } else if (serverAvailability(error) !== null) {
          pausedForAvailability = true;
          clearPendingQueues();
        }
      })
      .finally(() => {
        if (activeSession !== sessionId) return;
        inFlight.delete(id);
        drain();
      });
  }

  function observe(rawParentId: string): () => void {
    if (rawParentId === ROOT_DIRECTORY_ID) return () => {};
    const id = normalizeDirectoryId(rawParentId);
    if (!id) return () => {};

    visibleCounts.set(id, (visibleCounts.get(id) ?? 0) + 1);

    if (
      !pausedForAvailability
      && !(id in resolutions)
      && !inFlight.has(id)
      && !queuedSet.has(id)
      && !delayTimers.has(id)
    ) {
      const activeSession = sessionId;
      const timer = setTimeout(() => {
        delayTimers.delete(id);
        if (activeSession !== sessionId) return;
        enqueue(id);
      }, delayMs);
      delayTimers.set(id, timer);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const nextCount = (visibleCounts.get(id) ?? 0) - 1;
      if (nextCount > 0) {
        visibleCounts.set(id, nextCount);
        return;
      }
      visibleCounts.delete(id);
      clearDelayTimer(id);
      removeFromQueue(id);
    };
  }

  function markRevealed(rawParentId: string) {
    const id = normalizeDirectoryId(rawParentId);
    if (!id) return;
    const current = resolutions[id];
    if (current?.status === 'resolved' && !current.revealed) {
      resolutions[id] = { ...current, revealed: true };
    }
  }

  function cancelPending() {
    clearPendingQueues();
  }

  function reset() {
    sessionId += 1;
    pausedForAvailability = false;
    clearPendingQueues();
    inFlight.clear();
    visibleCounts.clear();
    resolutions = {};
  }

  return {
    get resolutions(): Readonly<Record<string, ParentDirectoryResolution>> {
      return resolutions;
    },
    observe,
    markRevealed,
    cancelPending,
    reset,
  };
}
