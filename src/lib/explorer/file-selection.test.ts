import { describe, expect, it } from 'vitest';
import {
  fileSelectionKey,
  isAllVisibleSelected,
  parseFileSelectionKey,
  selectedDocumentSize,
  selectFileRange,
  selectFileRangeByIndex,
} from './file-selection';

const keys = [
  fileSelectionKey('folder', 'alpha'),
  fileSelectionKey('folder', 'beta'),
  fileSelectionKey('document', 'one'),
  fileSelectionKey('document', 'two'),
];

describe('file selection helpers', () => {
  it('preserves identifiers containing colons', () => {
    expect(parseFileSelectionKey('document:server:document:42')).toEqual({
      kind: 'document',
      id: 'server:document:42',
    });
  });

  it('selects an inclusive forward range across object types', () => {
    const selection = selectFileRange(keys, 'folder:beta', 'document:two');
    expect([...selection.folders]).toEqual(['beta']);
    expect([...selection.documents]).toEqual(['one', 'two']);
  });

  it('selects a reverse range with the same result', () => {
    const selection = selectFileRange(keys, 'document:two', 'folder:beta');
    expect([...selection.folders]).toEqual(['beta']);
    expect([...selection.documents]).toEqual(['one', 'two']);
  });

  it('preserves an existing disjoint selection for Ctrl+Shift selection', () => {
    const selection = selectFileRange(
      keys,
      'folder:beta',
      'document:one',
      { folders: new Set(['alpha']), documents: new Set(['two']) },
      true,
    );
    expect([...selection.folders]).toEqual(['alpha', 'beta']);
    expect([...selection.documents]).toEqual(['two', 'one']);
  });

  it('does not destroy selection when an anchor is stale', () => {
    const selection = selectFileRange(
      keys,
      'folder:missing',
      'document:one',
      { folders: new Set(['alpha']), documents: new Set() },
    );
    expect([...selection.folders]).toEqual(['alpha']);
  });

  it('selects only the indexed interval without rebuilding the full key list', () => {
    const folderIds = Array.from({ length: 10_000 }, (_, index) => `folder-${index}`);
    const documentIds = Array.from({ length: 40_000 }, (_, index) => `document-${index}`);
    const keyToIndex = new Map<string, number>();
    folderIds.forEach((id, index) => keyToIndex.set(fileSelectionKey('folder', id), index));
    documentIds.forEach((id, index) => keyToIndex.set(fileSelectionKey('document', id), folderIds.length + index));

    const selection = selectFileRangeByIndex(
      folderIds,
      documentIds,
      keyToIndex,
      'folder:folder-9998',
      'document:document-2',
    );

    expect([...selection.folders]).toEqual(['folder-9998', 'folder-9999']);
    expect([...selection.documents]).toEqual(['document-0', 'document-1', 'document-2']);
  });

  it('computes all-selected and selected-size summaries from cached indexes', () => {
    const selection = { folders: new Set(['folder']), documents: new Set(['one', 'two']) };
    const sizes = new Map([['one', 12], ['two', 30], ['unselected', 1000]]);

    expect(isAllVisibleSelected(1, 2, selection)).toBe(true);
    expect(isAllVisibleSelected(2, 2, selection)).toBe(false);
    expect(selectedDocumentSize(selection.documents, sizes)).toBe(42);
  });
});
