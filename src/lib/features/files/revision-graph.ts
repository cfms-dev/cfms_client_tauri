import type { RevisionEntry } from '$lib/api';

export interface RevisionGraphLane {
  revisionId: string;
  isCurrentLineage: boolean;
}

export interface RevisionGraphContinuation {
  fromLane: number;
  toLane: number;
  isCurrentLineage: boolean;
}

export interface RevisionGraphRow {
  revision: RevisionEntry;
  lane: number;
  laneCount: number;
  before: Array<RevisionGraphLane | null>;
  after: Array<RevisionGraphLane | null>;
  parentLane: number | null;
  parentPathInCurrentLineage: boolean;
  parentLaneContinuation: RevisionGraphContinuation | null;
  isCurrentRevision: boolean;
  isCurrentLineage: boolean;
  hasChildren: boolean;
}

function compareRevisions(a: RevisionEntry, b: RevisionEntry): number {
  const at = a.created_time ?? 0;
  const bt = b.created_time ?? 0;
  if (bt !== at) return bt - at;
  return String(b.id).localeCompare(String(a.id));
}

function sortRevisions(entries: RevisionEntry[]): RevisionEntry[] {
  const byTime = [...entries].sort(compareRevisions);
  const pending = new Map(byTime.map((revision) => [String(revision.id), revision]));
  const childCount = new Map<string, number>();
  for (const revision of byTime) {
    if (revision.parent_id !== null && revision.parent_id !== undefined) {
      const parentId = String(revision.parent_id);
      childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
    }
  }

  const ready = byTime.filter((revision) => !childCount.get(String(revision.id)));
  const sorted: RevisionEntry[] = [];
  while (pending.size > 0) {
    // A cycle has no leaf. Break it in timestamp order so malformed data still renders.
    const revision = ready.shift() ?? pending.values().next().value!;
    pending.delete(String(revision.id));
    sorted.push(revision);

    if (revision.parent_id === null || revision.parent_id === undefined) continue;
    const parentId = String(revision.parent_id);
    const parent = pending.get(parentId);
    if (!parent) continue;
    const remainingChildren = (childCount.get(parentId) ?? 0) - 1;
    childCount.set(parentId, remainingChildren);
    if (remainingChildren === 0) {
      const next = ready.findIndex((candidate) => compareRevisions(parent, candidate) < 0);
      ready.splice(next < 0 ? ready.length : next, 0, parent);
    }
  }
  return sorted;
}

function findCurrentLineage(sorted: RevisionEntry[]): {
  currentRevisionId: string | null;
  revisionIds: Set<string>;
} {
  const current = sorted.filter((revision) => revision.is_current).sort(compareRevisions)[0];
  if (!current) return { currentRevisionId: null, revisionIds: new Set() };

  const revisionsById = new Map(
    sorted.map((revision) => [String(revision.id), revision] as const),
  );
  const lineage = new Set<string>();
  let revision: RevisionEntry | undefined = current;

  while (revision) {
    const revisionId = String(revision.id);
    if (lineage.has(revisionId)) break;
    lineage.add(revisionId);

    if (revision.parent_id === null || revision.parent_id === undefined) break;
    revision = revisionsById.get(String(revision.parent_id));
  }

  return { currentRevisionId: String(current.id), revisionIds: lineage };
}

function cloneLane(lane: RevisionGraphLane | null): RevisionGraphLane | null {
  return lane ? { ...lane } : null;
}

export function buildRevisionRows(entries: RevisionEntry[]): RevisionGraphRow[] {
  const sorted = sortRevisions(entries);
  const currentLineage = findCurrentLineage(sorted);
  const remainingIds = new Set(sorted.map((revision) => String(revision.id)));

  let lanes: Array<RevisionGraphLane | null> = [];
  const rows: RevisionGraphRow[] = [];

  for (const revision of sorted) {
    const revisionId = String(revision.id);
    remainingIds.delete(revisionId);
    let lane = lanes.findIndex((candidate) => candidate?.revisionId === revisionId);
    const hasChildren = lane >= 0;
    if (lane === -1) {
      lane = lanes.findIndex((candidate) => candidate === null);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = { revisionId, isCurrentLineage: false };
    }

    const before = lanes.map(cloneLane);
    const after = lanes.map(cloneLane);
    let parentLane: number | null = null;
    let parentPathInCurrentLineage = false;
    let parentLaneContinuation: RevisionGraphContinuation | null = null;
    const parentId = revision.parent_id === null || revision.parent_id === undefined
      ? null
      : String(revision.parent_id);

    // Missing parents and cycle-closing edges have no later node to connect to.
    if (parentId !== null && remainingIds.has(parentId)) {
      parentPathInCurrentLineage = currentLineage.revisionIds.has(revisionId)
        && currentLineage.revisionIds.has(parentId);
      const existingParentLane = after.findIndex(
        (candidate, index) => index !== lane && candidate?.revisionId === parentId,
      );
      if (existingParentLane >= 0) {
        const existingParentPath = after[existingParentLane];
        after[lane] = null;
        parentLane = existingParentLane;
        parentLaneContinuation = {
          fromLane: existingParentLane,
          toLane: parentLane,
          isCurrentLineage: existingParentPath?.isCurrentLineage ?? false,
        };
        const joinedParentPath = after[parentLane];
        if (joinedParentPath) {
          joinedParentPath.isCurrentLineage = joinedParentPath.isCurrentLineage
            || parentPathInCurrentLineage;
        }
      } else {
        after[lane] = {
          revisionId: parentId,
          isCurrentLineage: parentPathInCurrentLineage,
        };
        parentLane = lane;
      }
    } else {
      after[lane] = null;
    }

    while (after.length > 0 && after[after.length - 1] === null) after.pop();

    const laneCount = Math.max(before.length, after.length, lane + 1, 1);
    rows.push({
      revision,
      lane,
      laneCount,
      before,
      after,
      parentLane,
      parentPathInCurrentLineage,
      parentLaneContinuation,
      isCurrentRevision: currentLineage.currentRevisionId === revisionId,
      isCurrentLineage: currentLineage.revisionIds.has(revisionId),
      hasChildren,
    });
    lanes = after.map(cloneLane);
  }

  return rows;
}

export function graphWidth(row: RevisionGraphRow): number {
  return row.laneCount * 24 + 16;
}

export function laneX(lane: number): number {
  return lane * 24 + 12;
}
