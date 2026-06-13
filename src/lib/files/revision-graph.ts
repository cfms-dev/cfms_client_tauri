import type { RevisionEntry } from '$lib/api';

export interface RevisionGraphRow {
  revision: RevisionEntry;
  lane: number;
  laneCount: number;
  before: Array<string | null>;
  after: Array<string | null>;
  parentLane: number | null;
  hasChildren: boolean;
  hasBranch: boolean;
  hasMerge: boolean;
}

export function buildRevisionRows(entries: RevisionEntry[]): RevisionGraphRow[] {
  const sorted = [...entries].sort((a, b) => {
    const at = a.created_time ?? 0;
    const bt = b.created_time ?? 0;
    if (bt !== at) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });
  const childCount = new Map<string, number>();
  for (const entry of sorted) {
    if (entry.parent_id !== null && entry.parent_id !== undefined) {
      const parentKey = String(entry.parent_id);
      childCount.set(parentKey, (childCount.get(parentKey) ?? 0) + 1);
    }
  }

  let lanes: Array<string | null> = [];
  const rows: RevisionGraphRow[] = [];

  for (const revision of sorted) {
    const revisionId = String(revision.id);
    let lane = lanes.findIndex((id) => id === revisionId);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(revisionId);
    }

    const before = [...lanes];
    let after = [...lanes];
    let parentLane: number | null = null;
    const parentId = revision.parent_id === null || revision.parent_id === undefined
      ? null
      : String(revision.parent_id);

    if (parentId !== null) {
      const existingParentLane = after.findIndex((id, index) => index !== lane && id === parentId);
      if (existingParentLane >= 0) {
        after.splice(lane, 1);
        parentLane = existingParentLane > lane ? existingParentLane - 1 : existingParentLane;
      } else {
        after[lane] = parentId;
        parentLane = lane;
      }
    } else {
      after.splice(lane, 1);
      parentLane = null;
    }

    const laneCount = Math.max(before.length, after.length, lane + 1, 1);
    const children = childCount.get(revisionId) ?? 0;
    rows.push({
      revision,
      lane,
      laneCount,
      before,
      after,
      parentLane,
      hasChildren: children > 0,
      hasBranch: children > 1,
      hasMerge: parentLane !== null && parentLane !== lane,
    });
    lanes = after;
  }

  return rows;
}

export function graphWidth(row: RevisionGraphRow): number {
  return row.laneCount * 24 + 16;
}

export function laneX(lane: number): number {
  return lane * 24 + 12;
}

export function graphLineColor(id: string | null | undefined): string {
  if (id === null || id === undefined) return 'var(--color-md3-outline)';
  const colors = ['#4ea1ff', '#c084fc', '#34d399', '#f59e0b', '#fb7185'];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}
