export type DirectoryNavigationSnapshot = {
  folderId: string | null;
  navigationRootId: string | null;
  navigationRootLabel: string | null;
  navHistory: Array<{ label: string; id: string }>;
};

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
  private snapshots = new Map<string, DirectoryNavigationSnapshot>();

  remember(
    remoteAddress: string | null,
    username: string | null,
    snapshot: DirectoryNavigationSnapshot,
  ) {
    const key = scopeKey(remoteAddress, username);
    if (!key) return;
    this.snapshots.set(key, cloneSnapshot(snapshot));
  }

  restore(
    remoteAddress: string | null,
    username: string | null,
  ): DirectoryNavigationSnapshot | null {
    const key = scopeKey(remoteAddress, username);
    if (!key) return null;
    const snapshot = this.snapshots.get(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }
}

export const fileManagerNavigationStore = new FileManagerNavigationStore();
