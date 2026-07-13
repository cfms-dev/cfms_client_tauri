import { describe, expect, it, vi } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { createProgressiveDirectorySorter, type ProgressiveSortSnapshot } from './sort-worker-client';

function documents(count: number): ServerDocumentEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `document-${index}`,
    title: `Document ${index}`,
    size: index,
    last_modified: index,
  }));
}

describe('createProgressiveDirectorySorter fallback', () => {
  it('does not publish an empty in-flight generation and applies the latest sort revision', () => {
    const snapshots: ProgressiveSortSnapshot[] = [];
    const onError = vi.fn();
    const sorter = createProgressiveDirectorySorter((snapshot) => snapshots.push(snapshot), onError);

    sorter.reset(1, 1, 'name', 'asc');
    sorter.resort(1, 2, 'size', 'desc');
    expect(snapshots).toEqual([]);

    sorter.append(1, 2, [], documents(128), false);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ generation: 1, revision: 2, loadedCount: 128 });
    expect(snapshots[0].documents[0].size).toBe(127);
    expect(onError).not.toHaveBeenCalled();
    sorter.dispose();
  });
});
