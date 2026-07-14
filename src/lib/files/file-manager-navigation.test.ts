import { describe, expect, it } from 'vitest';
import { FileManagerNavigationStore, type DirectoryNavigationSnapshot } from './file-manager-navigation';

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
