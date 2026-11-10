import { describe, expect, it } from 'vitest';
import type { RevisionEntry } from '$lib/api';
import { buildRevisionRows } from '$lib/features/files/revision-graph';

function revision(
  id: string,
  parentId: string | null,
  createdTime: number,
  isCurrent = false,
): RevisionEntry {
  return {
    id,
    parent_id: parentId,
    created_time: createdTime,
    is_current: isCurrent,
  };
}

describe('revision graph current lineage', () => {
  it('highlights the complete ancestry of a linear current revision', () => {
    const rows = buildRevisionRows([
      revision('root', null, 1),
      revision('middle', 'root', 2),
      revision('head', 'middle', 3, true),
    ]);

    expect(rows.map((row) => row.revision.id)).toEqual(['head', 'middle', 'root']);
    expect(rows.map((row) => row.isCurrentLineage)).toEqual([true, true, true]);
    expect(rows.map((row) => row.parentPathInCurrentLineage)).toEqual([true, true, false]);
    expect(rows[0].after[0]?.isCurrentLineage).toBe(true);
  });

  it('keeps an inactive branch neutral until it joins the highlighted lineage', () => {
    const rows = buildRevisionRows([
      revision('root', null, 1),
      revision('current', 'root', 2, true),
      revision('alternative', 'root', 3),
    ]);
    const alternative = rows.find((row) => row.revision.id === 'alternative');
    const current = rows.find((row) => row.revision.id === 'current');
    const root = rows.find((row) => row.revision.id === 'root');

    expect(alternative?.isCurrentLineage).toBe(false);
    expect(alternative?.parentPathInCurrentLineage).toBe(false);
    expect(current?.parentPathInCurrentLineage).toBe(true);
    expect(current?.parentLaneContinuation?.isCurrentLineage).toBe(false);
    expect(current?.after[current.parentLane ?? -1]?.isCurrentLineage).toBe(true);
    expect(root?.before[root.lane]?.isCurrentLineage).toBe(true);
  });

  it('does not highlight newer descendants after the current revision is rolled back', () => {
    const rows = buildRevisionRows([
      revision('root', null, 1, true),
      revision('newer', 'root', 2),
      revision('newest', 'newer', 3),
    ]);

    expect(rows.map((row) => [row.revision.id, row.isCurrentLineage])).toEqual([
      ['newest', false],
      ['newer', false],
      ['root', true],
    ]);
    expect(rows.filter((row) => row.parentPathInCurrentLineage)).toHaveLength(0);
  });

  it('highlights only the current root when it has no parent', () => {
    const [row] = buildRevisionRows([revision('root', null, 1, true)]);

    expect(row.isCurrentLineage).toBe(true);
    expect(row.parentLane).toBeNull();
    expect(row.parentPathInCurrentLineage).toBe(false);
  });

  it('stops the current lineage at a missing parent', () => {
    const [row] = buildRevisionRows([revision('current', 'missing', 1, true)]);

    expect(row.isCurrentLineage).toBe(true);
    expect(row.parentPathInCurrentLineage).toBe(false);
    expect(row.parentLane).toBeNull();
    expect(row.after).toEqual([]);
  });

  it('terminates safely when parent links contain a cycle', () => {
    const rows = buildRevisionRows([
      revision('a', 'b', 2, true),
      revision('b', 'a', 1),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isCurrentLineage)).toBe(true);
    expect(rows.map((row) => row.parentPathInCurrentLineage)).toEqual([true, false]);
    expect(rows[1].parentLane).toBeNull();
    expect(rows[1].after).toEqual([]);
  });

  it('uses the newest current marker when malformed data contains more than one', () => {
    const rows = buildRevisionRows([
      revision('root', null, 1),
      revision('older-current', 'root', 2, true),
      revision('newer-current', 'root', 3, true),
    ]);
    const older = rows.find((row) => row.revision.id === 'older-current');
    const newer = rows.find((row) => row.revision.id === 'newer-current');

    expect(older?.isCurrentLineage).toBe(false);
    expect(older?.isCurrentRevision).toBe(false);
    expect(newer?.isCurrentLineage).toBe(true);
    expect(newer?.isCurrentRevision).toBe(true);
    expect(newer?.parentPathInCurrentLineage).toBe(true);
  });

  it('updates highlighted ancestors when the current branch changes', () => {
    const entries = [
      revision('root', null, 1),
      revision('left', 'root', 2, true),
      revision('right', 'root', 3),
      revision('right-head', 'right', 4),
    ];
    const highlighted = (values: RevisionEntry[]) => buildRevisionRows(values)
      .filter((row) => row.isCurrentLineage).map((row) => row.revision.id);

    expect(highlighted(entries)).toEqual(['left', 'root']);
    expect(highlighted(entries.map((entry) => ({
      ...entry, is_current: entry.id === 'right-head',
    })))).toEqual(['right-head', 'right', 'root']);
  });
});

describe('revision graph topology and lanes', () => {
  it('renders an empty history without rows', () => {
    expect(buildRevisionRows([])).toEqual([]);
  });

  it('orders the screenshot ancestry before timestamps and keeps it in one lane', () => {
    const entries = [
      revision('1fe8647', 'c19098b', 4, true),
      revision('50cf9ae', 'b4b2807', 3),
      revision('b4b2807', null, 2),
      revision('c19098b', '50cf9ae', 1),
    ];
    const rows = buildRevisionRows(entries);

    expect(rows.map((row) => row.revision.id)).toEqual([
      '1fe8647', 'c19098b', '50cf9ae', 'b4b2807',
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 0]);
    expect(rows.map((row) => row.hasChildren)).toEqual([false, true, true, true]);
    expect(rows.map((row) => row.parentLane)).toEqual([0, 0, 0, null]);
    expect(rows.every((row) => row.isCurrentLineage)).toBe(true);
    expect(entries.map((entry) => entry.id)).toEqual([
      '1fe8647', '50cf9ae', 'b4b2807', 'c19098b',
    ]);
  });

  it('orders available nodes by timestamp and then ID, independent of input order', () => {
    const entries = [
      revision('a', 'z', 1),
      revision('b', 'z', 1),
      revision('z', null, 5),
      revision('c', null, 2),
      revision('d', null, 0),
    ];
    const expected = ['c', 'b', 'a', 'z', 'd'];

    expect(buildRevisionRows(entries).map((row) => row.revision.id)).toEqual(expected);
    expect(buildRevisionRows([...entries].reverse()).map((row) => row.revision.id)).toEqual(expected);
  });

  it('does not move other lanes when a branch joins a parent to its right', () => {
    const rows = buildRevisionRows([
      revision('head', 'middle', 10, true),
      revision('alternative', 'shared', 9),
      revision('other-head', 'other-root', 8),
      revision('middle', 'shared', 7),
      revision('shared', null, 2),
      revision('other-root', null, 1),
    ]);
    const join = rows.find((row) => row.revision.id === 'middle')!;

    expect(join.lane).toBe(0);
    expect(join.parentLane).toBe(1);
    expect(join.parentLaneContinuation).toEqual({
      fromLane: 1, toLane: 1, isCurrentLineage: false,
    });
    expect(join.after).toEqual([
      null,
      { revisionId: 'shared', isCurrentLineage: true },
      { revisionId: 'other-root', isCurrentLineage: false },
    ]);
    expect(rows.find((row) => row.revision.id === 'other-root')?.lane).toBe(2);

    for (let index = 1; index < rows.length; index += 1) {
      rows[index - 1].after.forEach((lane, laneIndex) => {
        if (lane) expect(rows[index].before[laneIndex]).toEqual(lane);
      });
    }
  });

  it('reuses a finished root slot without moving an active branch', () => {
    const rows = buildRevisionRows([
      revision('head-a', 'root-a', 10),
      revision('head-b', 'root-b', 9),
      revision('root-a', null, 8),
      revision('head-c', 'root-c', 7),
      revision('root-c', null, 6),
      revision('root-b', null, 1),
    ]);
    const finished = rows.find((row) => row.revision.id === 'root-a')!;
    const reused = rows.find((row) => row.revision.id === 'head-c')!;

    expect(finished.after).toEqual([
      null, { revisionId: 'root-b', isCurrentLineage: false },
    ]);
    expect(reused.lane).toBe(0);
    expect(reused.hasChildren).toBe(false);
    expect(reused.before[1]).toEqual(finished.after[1]);
    expect(rows.find((row) => row.revision.id === 'root-b')?.lane).toBe(1);
    expect(rows.at(-1)?.after).toEqual([]);
  });

  it('ends self-parent links without an outgoing path', () => {
    const [row] = buildRevisionRows([revision('self', 'self', 1, true)]);

    expect(row.isCurrentLineage).toBe(true);
    expect(row.hasChildren).toBe(false);
    expect(row.parentLane).toBeNull();
    expect(row.after).toEqual([]);
  });
});
