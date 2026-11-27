import { getDirectoryInfo } from '#lib/api.ts';
import {
  isAccessDeniedError,
  serverAvailability,
  serverErrorStatus,
} from '#lib/api/server-errors.ts';
import { EFFECTIVE_OP, hasEffectiveOp } from '#lib/features/access/effective-permissions.ts';
import { normalizeDirectoryId, ROOT_DIRECTORY_ID } from './file-browser';

export type ParentDirectoryResolution =
  | { status: 'resolved'; name: string; revealed: boolean }
  | { status: 'inaccessible'; name?: string };

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

function normalizeParentMaskKey(rawParentId: string): string | null {
  const trimmed = rawParentId.trim();
  if (!trimmed) return null;
  if (trimmed === ROOT_DIRECTORY_ID) return ROOT_DIRECTORY_ID;
  return normalizeDirectoryId(trimmed);
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

  const parentMasks = new Map<string, number>();
  const metadataSettled = new Set<string>();
  const visibleCounts = new Map<string, number>();
  const delayTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queue: string[] = [];
  const queuedSet = new Set<string>();
  const inFlight = new Set<string>();

  function hasResolvedName(id: string): boolean {
    const current = resolutions[id];
    if (!current) return false;
    return current.status === 'resolved' || Boolean(current.name);
  }

  function needsMetadataFetch(id: string): boolean {
    if (metadataSettled.has(id) || hasResolvedName(id)) return false;
    const mask = parentMasks.get(id);
    if (mask !== undefined) {
      return hasEffectiveOp(mask, EFFECTIVE_OP.READ_METADATA);
    }
    return !(id in resolutions);
  }

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
      || !needsMetadataFetch(id)
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

  function scheduleIfVisible(id: string) {
    if (
      pausedForAvailability
      || (visibleCounts.get(id) ?? 0) <= 0
      || !needsMetadataFetch(id)
      || inFlight.has(id)
      || queuedSet.has(id)
      || delayTimers.has(id)
    ) {
      return;
    }
    const activeSession = sessionId;
    const timer = setTimeout(() => {
      delayTimers.delete(id);
      if (activeSession !== sessionId) return;
      enqueue(id);
    }, delayMs);
    delayTimers.set(id, timer);
  }

  function drain() {
    while (!pausedForAvailability && inFlight.size < maxConcurrency && queue.length > 0) {
      const nextId = queue.shift()!;
      queuedSet.delete(nextId);
      if (
        (visibleCounts.get(nextId) ?? 0) <= 0
        || !needsMetadataFetch(nextId)
        || inFlight.has(nextId)
      ) {
        continue;
      }
      void fetchOne(nextId);
    }
  }

  async function fetchOne(id: string) {
    const activeSession = sessionId;
    inFlight.add(id);

    try {
      const info = await fetchDirectoryInfo(id);
      if (activeSession !== sessionId) return;

      const resolvedName = info?.name?.trim();
      const effectiveMask = info?.effective_mask ?? parentMasks.get(id);
      metadataSettled.add(id);

      if (!hasEffectiveOp(effectiveMask, EFFECTIVE_OP.LIST_DIRECTORY)) {
        resolutions[id] = resolvedName
          ? { status: 'inaccessible', name: resolvedName }
          : { status: 'inaccessible' };
        return;
      }

      if (resolvedName) {
        resolutions[id] = {
          status: 'resolved',
          name: resolvedName,
          revealed: false,
        };
      }
    } catch (error: unknown) {
      if (activeSession !== sessionId) return;
      if (serverAvailability(error) !== null) {
        pausedForAvailability = true;
        clearPendingQueues();
        return;
      }

      if (isUnavailableDirectoryError(error)) {
        metadataSettled.add(id);
        if (resolutions[id]?.status !== 'inaccessible') {
          resolutions[id] = { status: 'inaccessible' };
        }
      }
    } finally {
      if (activeSession === sessionId) {
        inFlight.delete(id);
        drain();
      }
    }
  }

  function applyParentEffectiveMasks(
    masks: Readonly<Record<string, number>> | null | undefined,
  ) {
    if (!masks) return;

    for (const [rawParentId, mask] of Object.entries(masks)) {
      if (typeof mask !== 'number') continue;
      const key = normalizeParentMaskKey(rawParentId);
      if (!key) continue;

      const maskChanged = parentMasks.get(key) !== mask;
      parentMasks.set(key, mask);
      if (maskChanged) {
        metadataSettled.delete(key);
      }

      const canList = hasEffectiveOp(mask, EFFECTIVE_OP.LIST_DIRECTORY);
      const canReadMeta = hasEffectiveOp(mask, EFFECTIVE_OP.READ_METADATA);

      if (key === ROOT_DIRECTORY_ID) {
        if (!canList) {
          if (resolutions[ROOT_DIRECTORY_ID]?.status !== 'inaccessible') {
            resolutions[ROOT_DIRECTORY_ID] = { status: 'inaccessible' };
          }
        } else if (resolutions[ROOT_DIRECTORY_ID]?.status === 'inaccessible') {
          delete resolutions[ROOT_DIRECTORY_ID];
        }
        continue;
      }

      const current = resolutions[key];
      const existingName =
        current?.status === 'resolved'
          ? current.name
          : current?.status === 'inaccessible'
            ? current.name
            : undefined;

      if (!canReadMeta) {
        clearDelayTimer(key);
        removeFromQueue(key);
      }

      if (!canList) {
        if (canReadMeta && existingName) {
          if (current?.status !== 'inaccessible' || current.name !== existingName) {
            resolutions[key] = { status: 'inaccessible', name: existingName };
          }
        } else if (current?.status !== 'inaccessible' || current.name !== undefined) {
          resolutions[key] = { status: 'inaccessible' };
        }
        if (canReadMeta && !existingName) {
          scheduleIfVisible(key);
        }
      } else if (!canReadMeta) {
        if (current !== undefined) {
          delete resolutions[key];
        }
      } else if (current?.status === 'inaccessible') {
        if (existingName) {
          resolutions[key] = {
            status: 'resolved',
            name: existingName,
            revealed: true,
          };
        } else {
          delete resolutions[key];
          scheduleIfVisible(key);
        }
      } else if (!current) {
        scheduleIfVisible(key);
      }
    }
  }

  function observe(rawParentId: string): () => void {
    if (rawParentId === ROOT_DIRECTORY_ID) return () => {};
    const id = normalizeDirectoryId(rawParentId);
    if (!id) return () => {};

    visibleCounts.set(id, (visibleCounts.get(id) ?? 0) + 1);
    scheduleIfVisible(id);

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
    parentMasks.clear();
    metadataSettled.clear();
    resolutions = {};
  }

  return {
    get resolutions(): Readonly<Record<string, ParentDirectoryResolution>> {
      return resolutions;
    },
    applyParentEffectiveMasks,
    observe,
    markRevealed,
    cancelPending,
    reset,
  };
}
