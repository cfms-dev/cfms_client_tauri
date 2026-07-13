import { describe, expect, it } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { DIRECTORY_PAGE_SIZE, ProgressiveListingAccumulator } from './progressive-listing';

function documents(start: number, count: number): ServerDocumentEntry[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      id: `document-${index}`,
      title: `File ${String(100_000 - index).padStart(6, '0')}`,
      size: index,
      last_modified: index,
    };
  });
}

function collectSnapshots(total: number) {
  const accumulator = new ProgressiveListingAccumulator();
  const snapshots: Array<{ loadedCount: number; complete: boolean; firstTitle?: string }> = [];
  for (let start = 0; start < total; start += DIRECTORY_PAGE_SIZE) {
    const count = Math.min(DIRECTORY_PAGE_SIZE, total - start);
    const complete = start + count === total;
    const snapshot = accumulator.append([], documents(start, count), complete, 'name', 'asc');
    if (snapshot) {
      snapshots.push({
        loadedCount: snapshot.loadedCount,
        complete: snapshot.complete,
        firstTitle: snapshot.documents[0]?.title,
      });
    }
  }
  return snapshots;
}

describe('ProgressiveListingAccumulator', () => {
  it('publishes a short first page immediately even when more pages follow', () => {
    const accumulator = new ProgressiveListingAccumulator();
    const snapshot = accumulator.append([], documents(0, 12), false, 'name', 'asc');

    expect(snapshot).toMatchObject({ loadedCount: 12, complete: false });
  });

  it('publishes the first page, geometric milestones, and a final sorted snapshot', () => {
    const snapshots = collectSnapshots(1_000);
    expect(snapshots.map((snapshot) => snapshot.loadedCount)).toEqual([128, 256, 512, 1_000]);
    expect(snapshots.at(-1)).toMatchObject({ complete: true, firstTitle: 'File 099001' });
  });

  it.each([10_000, 50_000])(
    'keeps snapshot count logarithmic and cumulative transfer below 3n for %i entries',
    (total) => {
      const snapshots = collectSnapshots(total);
      const cumulativeItems = snapshots.reduce((sum, snapshot) => sum + snapshot.loadedCount, 0);
      expect(snapshots.length).toBeLessThanOrEqual(Math.ceil(Math.log2(total / DIRECTORY_PAGE_SIZE)) + 2);
      expect(cumulativeItems).toBeLessThan(total * 3);
      expect(snapshots.at(-1)).toMatchObject({ loadedCount: total, complete: true });
    },
  );

  it('retains completion metadata when the current sort is changed', () => {
    const accumulator = new ProgressiveListingAccumulator();
    accumulator.append([], documents(0, 2), true, 'name', 'asc');
    expect(accumulator.snapshot('size', 'desc')).toMatchObject({ loadedCount: 2, complete: true });
  });
});
