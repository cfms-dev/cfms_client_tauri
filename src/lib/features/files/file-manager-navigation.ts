import { sameDirectoryId } from '$lib/features/files/file-browser';

export type DirectoryNavigationSnapshot = {
  folderId: string | null;
  navigationRootId: string | null;
  navigationRootLabel: string | null;
  navHistory: Array<{ label: string; id: string }>;
};

export type DirectoryNavigationTimeline = {
  entries: DirectoryNavigationSnapshot[];
  cursor: number;
};

export function recordDirectoryVisit(
  timeline: DirectoryNavigationTimeline,
  snapshot: DirectoryNavigationSnapshot,
): DirectoryNavigationTimeline {
  const current = timeline.entries[timeline.cursor];
  // Updating a label or locating a document in the current directory is not a
  // new visit and must not discard the forward branch.
  if (current && sameDirectoryId(current.folderId, snapshot.folderId)) {
    const entries = [...timeline.entries];
    entries[timeline.cursor] = cloneSnapshot(snapshot);
    return { entries, cursor: timeline.cursor };
  }
  const entries = [...timeline.entries.slice(0, timeline.cursor + 1), cloneSnapshot(snapshot)];
  return { entries, cursor: entries.length - 1 };
}

export function directoryHistoryTarget(timeline: DirectoryNavigationTimeline, direction: -1 | 1) {
  const cursor = timeline.cursor + direction;
  const snapshot = timeline.entries[cursor];
  return snapshot ? { cursor, snapshot: cloneSnapshot(snapshot) } : null;
}

/** Resolve a visit before committing either its location or its history cursor. */
export async function resolveDirectoryVisit(
  timeline: DirectoryNavigationTimeline,
  snapshot: DirectoryNavigationSnapshot,
  load: () => Promise<'loaded' | 'denied' | 'failed'>,
  isCurrent: () => boolean,
  historyCursor?: number,
) {
  const outcome = await load();
  if (!isCurrent() || outcome === 'failed') return null;
  return {
    snapshot: cloneSnapshot(snapshot),
    timeline: historyCursor === undefined
      ? recordDirectoryVisit(timeline, snapshot)
      : { ...timeline, cursor: historyCursor },
    loaded: outcome === 'loaded',
  };
}

function cloneTimeline(timeline: DirectoryNavigationTimeline): DirectoryNavigationTimeline {
  return { entries: timeline.entries.map(cloneSnapshot), cursor: timeline.cursor };
}

function cloneSnapshot(snapshot: DirectoryNavigationSnapshot): DirectoryNavigationSnapshot {
  return {
    ...snapshot,
    navHistory: snapshot.navHistory.map((entry) => ({ ...entry })),
  };
}

function scopeKey(remoteAddress: string | null, username: string | null): string | null {
  if (!remoteAddress || !username) return null;
  return JSON.stringify([remoteAddress, username]);
}

export class FileManagerNavigationStore {
  private timelines = new Map<string, DirectoryNavigationTimeline>();

  remember(
    remoteAddress: string | null,
    username: string | null,
    snapshot: DirectoryNavigationSnapshot,
  ) {
    const key = scopeKey(remoteAddress, username);
    if (!key) return;
    this.timelines.set(key, recordDirectoryVisit(this.timelines.get(key) ?? { entries: [], cursor: -1 }, snapshot));
  }

  restore(
    remoteAddress: string | null,
    username: string | null,
  ): DirectoryNavigationSnapshot | null {
    const key = scopeKey(remoteAddress, username);
    if (!key) return null;
    const timeline = this.timelines.get(key);
    const snapshot = timeline?.entries[timeline.cursor];
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  rememberTimeline(remoteAddress: string | null, username: string | null, timeline: DirectoryNavigationTimeline) {
    const key = scopeKey(remoteAddress, username);
    if (key) this.timelines.set(key, cloneTimeline(timeline));
  }

  restoreTimeline(remoteAddress: string | null, username: string | null): DirectoryNavigationTimeline | null {
    const key = scopeKey(remoteAddress, username);
    const timeline = key ? this.timelines.get(key) : null;
    return timeline ? cloneTimeline(timeline) : null;
  }
}

export const fileManagerNavigationStore = new FileManagerNavigationStore();
