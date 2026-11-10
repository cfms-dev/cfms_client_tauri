import { describe, expect, it } from 'vitest';
import {
  directoryHistoryTarget, FileManagerNavigationStore, recordDirectoryVisit, resolveDirectoryVisit,
  type DirectoryNavigationSnapshot, type DirectoryNavigationTimeline,
} from '$lib/features/files/file-manager-navigation';

const nestedDirectory: DirectoryNavigationSnapshot = {
  folderId: 'child-id',
  navigationRootId: 'workspace-id',
  navigationRootLabel: 'Workspace',
  navHistory: [{ label: 'Child', id: 'child-id' }],
};

describe('FileManagerNavigationStore', () => {
  it('restores the last directory for the same server and user', () => {
    const store = new FileManagerNavigationStore();

    store.remember('files.example.test', 'alice', nestedDirectory);

    expect(store.restore('files.example.test', 'alice')).toEqual(nestedDirectory);
  });

  it('keeps navigation state isolated by server and user', () => {
    const store = new FileManagerNavigationStore();
    store.remember('files.example.test', 'alice', nestedDirectory);

    expect(store.restore('other.example.test', 'alice')).toBeNull();
    expect(store.restore('files.example.test', 'bob')).toBeNull();
    expect(store.restore(null, 'alice')).toBeNull();
    expect(store.restore('files.example.test', null)).toBeNull();
  });

  it('protects remembered state from later mutation', () => {
    const store = new FileManagerNavigationStore();
    store.remember('files.example.test', 'alice', nestedDirectory);

    const restored = store.restore('files.example.test', 'alice');
    restored?.navHistory.push({ label: 'Grandchild', id: 'grandchild-id' });

    expect(store.restore('files.example.test', 'alice')).toEqual(nestedDirectory);
  });
});

const root: DirectoryNavigationSnapshot = {
  folderId: null, navigationRootId: null, navigationRootLabel: null, navHistory: [],
};
const other: DirectoryNavigationSnapshot = {
  folderId: 'other', navigationRootId: 'other', navigationRootLabel: 'Search result', navHistory: [],
};

function visits(...snapshots: DirectoryNavigationSnapshot[]) {
  return snapshots.reduce(recordDirectoryVisit, { entries: [], cursor: -1 } as DirectoryNavigationTimeline);
}

describe('directory visit history', () => {
  it('opens an initial URL destination without inventing a visit to root', async () => {
    const empty = { entries: [], cursor: -1 };
    const failed = await resolveDirectoryVisit(empty, nestedDirectory, async () => 'failed', () => true);
    expect(failed).toBeNull();
    expect(empty.entries).toEqual([]);
    const opened = await resolveDirectoryVisit(empty, nestedDirectory, async () => 'loaded', () => true);
    expect(opened?.timeline.entries).toEqual([nestedDirectory]);
    expect(directoryHistoryTarget(opened!.timeline, -1)).toBeNull();
  });
  it('traverses visits independently of the directory breadcrumb without adding entries', async () => {
    const timeline = visits(root, nestedDirectory, other);
    const target = directoryHistoryTarget(timeline, -1)!;
    const back = await resolveDirectoryVisit(timeline, target.snapshot, async () => 'loaded', () => true, target.cursor);
    expect(back?.snapshot).toEqual(nestedDirectory);
    expect(back?.timeline.entries).toHaveLength(3);
    expect(directoryHistoryTarget(back!.timeline, 1)?.snapshot).toEqual(other);
    expect(directoryHistoryTarget(visits(root), -1)).toBeNull();
    expect(directoryHistoryTarget(timeline, 1)).toBeNull();
  });

  it('discards the forward branch only when opening a different directory', () => {
    const timeline = { ...visits(root, nestedDirectory, other), cursor: 1 };
    const renamed = { ...nestedDirectory, navigationRootLabel: 'Renamed' };
    const same = recordDirectoryVisit(timeline, renamed);
    expect(same.entries).toHaveLength(3);
    expect(same.cursor).toBe(1);
    expect(same.entries[1].navigationRootLabel).toBe('Renamed');
    const newBranch = recordDirectoryVisit(same, root);
    expect(newBranch.entries.map(entry => entry.folderId)).toEqual([null, 'child-id', null]);
    expect(directoryHistoryTarget(newBranch, 1)).toBeNull();
  });

  it('treats the server root identifier and null as the same location', () => {
    expect(recordDirectoryVisit(visits(root), { ...root, folderId: '/' }).entries).toHaveLength(1);
  });

  it('restores both branches and the current cursor after leaving the page, isolated by account', () => {
    const store = new FileManagerNavigationStore();
    const timeline = { ...visits(root, nestedDirectory, other), cursor: 1 };
    store.rememberTimeline('server', 'alice', timeline);
    timeline.entries[0].navHistory.push({ id: 'unwanted', label: 'Mutation' });
    const restored = store.restoreTimeline('server', 'alice')!;
    expect(restored.cursor).toBe(1);
    expect(restored.entries[0].navHistory).toEqual([]);
    expect(directoryHistoryTarget(restored, 1)?.snapshot).toEqual(other);
    restored.entries.pop();
    expect(store.restoreTimeline('server', 'alice')?.entries).toHaveLength(3);
    expect(store.restoreTimeline('server', 'bob')).toBeNull();
    expect(store.restoreTimeline('another-server', 'alice')).toBeNull();
  });

  it('records a resolved destination using its complete breadcrumb snapshot', async () => {
      const timeline = visits(root);
      const result = await resolveDirectoryVisit(timeline, nestedDirectory, async () => 'loaded', () => true);
      expect(result?.timeline.entries).toEqual([root, nestedDirectory]);
      expect(result?.loaded).toBe(true);
      expect(timeline.entries).toEqual([root]);
    });

  it('commits a denied destination so Back still returns from the displayed error page', async () => {
    const result = await resolveDirectoryVisit(visits(root), other, async () => 'denied', () => true);
    expect(result?.snapshot).toEqual(other);
    expect(result?.loaded).toBe(false);
    expect(directoryHistoryTarget(result!.timeline, -1)?.snapshot).toEqual(root);
  });

  it('preserves the location and cursor when loading a history destination fails', async () => {
    const timeline = visits(root, nestedDirectory);
    expect(await resolveDirectoryVisit(timeline, root, async () => 'failed', () => true, 0)).toBeNull();
    expect(timeline.cursor).toBe(1);
    expect(timeline.entries[1]).toEqual(nestedDirectory);
  });

  it('does not commit an obsolete request even if it succeeds', async () => {
    let complete!: (result: 'loaded') => void;
    let current = true;
    const result = resolveDirectoryVisit(visits(root), other, () => new Promise(resolve => { complete = resolve; }), () => current);
    current = false;
    complete('loaded');
    expect(await result).toBeNull();
  });
});
