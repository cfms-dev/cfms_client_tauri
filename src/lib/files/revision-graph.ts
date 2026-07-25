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

function sortRevisions(entries: RevisionEntry[]): RevisionEntry[] {
  return [...entries].sort((a, b) => {
    const at = a.created_time ?? 0;
    const bt = b.created_time ?? 0;
    if (bt !== at) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });
}

function findCurrentLineage(sorted: RevisionEntry[]): {
  currentRevisionId: string | null;
  revisionIds: Set<string>;
} {
  const current = sorted.find((revision) => revision.is_current);
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
  const childCount = new Map<string, number>();
  for (const entry of sorted) {
    if (entry.parent_id !== null && entry.parent_id !== undefined) {
      const parentKey = String(entry.parent_id);
      childCount.set(parentKey, (childCount.get(parentKey) ?? 0) + 1);
    }
  }

  let lanes: Array<RevisionGraphLane | null> = [];
  const rows: RevisionGraphRow[] = [];

  for (const revision of sorted) {
    const revisionId = String(revision.id);
    let lane = lanes.findIndex((candidate) => candidate?.revisionId === revisionId);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push({ revisionId, isCurrentLineage: false });
    }

    const before = lanes.map(cloneLane);
    const after = lanes.map(cloneLane);
    let parentLane: number | null = null;
    let parentPathInCurrentLineage = false;
    let parentLaneContinuation: RevisionGraphContinuation | null = null;
    const parentId = revision.parent_id === null || revision.parent_id === undefined
      ? null
      : String(revision.parent_id);

    if (parentId !== null) {
      parentPathInCurrentLineage = currentLineage.revisionIds.has(revisionId)
        && currentLineage.revisionIds.has(parentId);
      const existingParentLane = after.findIndex(
        (candidate, index) => index !== lane && candidate?.revisionId === parentId,
      );
      if (existingParentLane >= 0) {
        const existingParentPath = after[existingParentLane];
        after.splice(lane, 1);
        parentLane = existingParentLane > lane ? existingParentLane - 1 : existingParentLane;
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
      after.splice(lane, 1);
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
      parentPathInCurrentLineage,
      parentLaneContinuation,
      isCurrentRevision: currentLineage.currentRevisionId === revisionId,
      isCurrentLineage: currentLineage.revisionIds.has(revisionId),
      hasChildren: children > 0,
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
