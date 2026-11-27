import { describe, expect, it } from 'vitest';
import type { SearchFilesResponse } from '#lib/api.ts';
import {
  buildGroupedSearchDisplayRows,
  mergeSearchResponses,
  normalizeSearchParentId,
  toSearchResultRows,
} from './search-grouping';

describe('search-grouping', () => {
  it('normalizes root, empty, and missing parent IDs to "/"', () => {
    expect(normalizeSearchParentId(null)).toBe('/');
    expect(normalizeSearchParentId(undefined)).toBe('/');
    expect(normalizeSearchParentId('')).toBe('/');
    expect(normalizeSearchParentId('   ')).toBe('/');
    expect(normalizeSearchParentId('/')).toBe('/');
    expect(normalizeSearchParentId('  d44bf0d2  ')).toBe('d44bf0d2');
  });

  it('merges consecutive results with the same parent_id under a single heading', () => {
    const response: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'Hello World', parent_id: 'dir-a', size: 100 },
        { type: 'document', id: 'doc-2', title: 'Who am I', parent_id: 'dir-a', size: 200 },
        { type: 'directory', id: 'dir-child', name: 'Subfolder', parent_id: 'dir-a', created_time: 10 },
        { type: 'document', id: 'doc-3', title: 'main.c', parent_id: 'dir-b', size: 50 },
      ],
      total_count: 4,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    };

    const grouped = buildGroupedSearchDisplayRows(toSearchResultRows(response));

    expect(grouped.map((row) => (row.kind === 'group-header' ? `H:${row.parentId}` : `${row.kind}:${row.kind === 'document' ? row.document.id : row.directory.id}`))).toEqual([
      'H:dir-a',
      'document:doc-1',
      'document:doc-2',
      'directory:dir-child',
      'H:dir-b',
      'document:doc-3',
    ]);
    expect(grouped[0]).toMatchObject({ kind: 'group-header', parentId: 'dir-a', firstGroup: true, runIndex: 0 });
    expect(grouped[4]).toMatchObject({ kind: 'group-header', parentId: 'dir-b', firstGroup: false, runIndex: 1 });
  });

  it('does not reorder non-adjacent items sharing the same parent_id', () => {
    const response: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'A', parent_id: 'dir-a' },
        { type: 'document', id: 'doc-2', title: 'B', parent_id: 'dir-a' },
        { type: 'document', id: 'doc-3', title: 'C', parent_id: 'dir-b' },
        { type: 'document', id: 'doc-4', title: 'D', parent_id: 'dir-a' },
      ],
      total_count: 4,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    };

    const grouped = buildGroupedSearchDisplayRows(toSearchResultRows(response));

    expect(grouped.map((row) => (row.kind === 'group-header' ? `H:${row.parentId}` : row.kind === 'document' ? row.document.id : row.directory.id))).toEqual([
      'H:dir-a',
      'doc-1',
      'doc-2',
      'H:dir-b',
      'doc-3',
      'H:dir-a',
      'doc-4',
    ]);

    const orderedItemIds = grouped
      .filter((row) => row.kind !== 'group-header')
      .map((row) => (row.kind === 'document' ? row.document.id : row.directory.id));
    expect(orderedItemIds).toEqual(['doc-1', 'doc-2', 'doc-3', 'doc-4']);
  });

  it('merges consecutive root items across null, empty, and "/" parent_id values', () => {
    const response: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'Root 1', parent_id: null },
        { type: 'directory', id: 'dir-1', name: 'Root Dir', parent_id: '/', created_time: null },
        { type: 'document', id: 'doc-2', title: 'Root 2' },
      ],
      total_count: 3,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    };

    const grouped = buildGroupedSearchDisplayRows(toSearchResultRows(response));
    expect(grouped.filter((row) => row.kind === 'group-header')).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: 'group-header', parentId: '/' });
  });

  it('seamlessly merges matching parent_id items across incremental batch pages', () => {
    const page1: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'A', parent_id: 'dir-a' },
      ],
      parent_effective_masks: {
        'dir-a': 3,
      },
      total_count: 1,
      page_size: 1,
      next_cursor: 'cursor-2',
      has_more: true,
    };
    const page2: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-2', title: 'B', parent_id: 'dir-a' },
        { type: 'document', id: 'doc-3', title: 'C', parent_id: 'dir-b' },
      ],
      parent_effective_masks: {
        'dir-a': 1027,
        'dir-b': 1,
      },
      total_count: 2,
      page_size: 2,
      next_cursor: null,
      has_more: false,
    };

    const merged = mergeSearchResponses(page1, page2);
    expect(merged.total_count).toBe(3);
    expect(merged.parent_effective_masks).toEqual({
      'dir-a': 1027,
      'dir-b': 1,
    });

    const grouped = buildGroupedSearchDisplayRows(toSearchResultRows(merged));
    expect(grouped.map((row) => (row.kind === 'group-header' ? `H:${row.parentId}` : row.kind === 'document' ? row.document.id : row.directory.id))).toEqual([
      'H:dir-a',
      'doc-1',
      'doc-2',
      'H:dir-b',
      'doc-3',
    ]);
  });
});
