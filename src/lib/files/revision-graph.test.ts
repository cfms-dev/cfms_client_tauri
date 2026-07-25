import { describe, expect, it } from 'vitest';
import type { RevisionEntry } from '$lib/api';
import { buildRevisionRows } from './revision-graph';

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
    expect(row.after[row.parentLane ?? -1]?.isCurrentLineage).toBe(false);
  });

  it('terminates safely when parent links contain a cycle', () => {
    const rows = buildRevisionRows([
      revision('a', 'b', 2, true),
      revision('b', 'a', 1),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isCurrentLineage)).toBe(true);
    expect(rows.every((row) => row.parentPathInCurrentLineage)).toBe(true);
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
});
