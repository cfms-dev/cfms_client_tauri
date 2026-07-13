import { describe, expect, it } from 'vitest';
import { fileSelectionKey, parseFileSelectionKey, selectFileRange } from './file-selection';

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
});
