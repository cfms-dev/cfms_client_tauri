import type { PermissionEntry } from '$lib/api';

export type PermissionEntryState = 'active' | 'scheduled' | 'expired';
export type PermissionEntryFilter = 'all' | PermissionEntryState | 'changed';
export type PermissionEntryChangeKind = 'unchanged' | 'added' | 'modified' | 'deleted';

export interface PermissionEntryValidation {
  valid: boolean;
  permission: 'required' | null;
  startTime: 'invalid' | null;
  endTime: 'invalid' | 'before-start' | null;
}

export interface PermissionEntryChangeCounts {
  added: number;
  modified: number;
  deleted: number;
  total: number;
}

export interface PermissionEntryOverview {
  direct: number;
  effective: number;
}

export interface PermissionEntriesEditorData {
  entries: PermissionEntry[];
  effectivePermissions: string[];
  inheritedPermissions?: string[];
}

export function permissionEntryState(
  entry: PermissionEntry,
  nowSeconds = Date.now() / 1000,
): PermissionEntryState {
  if (entry.start_time > nowSeconds) return 'scheduled';
  if (entry.end_time !== null && entry.end_time < nowSeconds) return 'expired';
  return 'active';
}

export function toLocalDateTimeInput(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseLocalDateTimeInput(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime() / 1000;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createImmediatePermissionEntry(
  permission = '',
  nowSeconds = Date.now() / 1000,
): PermissionEntry {
  return {
    permission,
    granted: true,
    start_time: Math.floor(nowSeconds),
    end_time: null,
  };
}

export function permissionEntriesEqual(a: PermissionEntry, b: PermissionEntry): boolean {
  return a.permission === b.permission
    && a.granted === b.granted
    && a.start_time === b.start_time
    && a.end_time === b.end_time;
}

export function validatePermissionEntry(entry: PermissionEntry): PermissionEntryValidation {
  const permission = entry.permission.trim() ? null : 'required';
  const startTime = Number.isFinite(entry.start_time) ? null : 'invalid';
  let endTime: PermissionEntryValidation['endTime'] = null;
  if (entry.end_time !== null) {
    if (!Number.isFinite(entry.end_time)) {
      endTime = 'invalid';
    } else if (startTime === null && entry.end_time < entry.start_time) {
      endTime = 'before-start';
    }
  }

  return {
    valid: permission === null && startTime === null && endTime === null,
    permission,
    startTime,
    endTime,
  };
}

export function permissionEntryChangeKind(
  entry: PermissionEntry,
  initial: PermissionEntry | null,
  deleted = false,
): PermissionEntryChangeKind {
  if (deleted) return 'deleted';
  if (initial === null) return 'added';
  return permissionEntriesEqual(entry, initial) ? 'unchanged' : 'modified';
}

export function countPermissionEntryChanges(
  changes: readonly PermissionEntryChangeKind[],
): PermissionEntryChangeCounts {
  const counts = { added: 0, modified: 0, deleted: 0, total: 0 };
  for (const change of changes) {
    if (change === 'unchanged') continue;
    counts[change] += 1;
    counts.total += 1;
  }
  return counts;
}

export function permissionEntryMatchesFilter(
  state: PermissionEntryState,
  change: PermissionEntryChangeKind,
  filter: PermissionEntryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'changed') return change !== 'unchanged';
  return change !== 'deleted' && state === filter;
}

export function permissionEntrySuggestions(
  ...collections: ReadonlyArray<readonly (PermissionEntry | string)[] | undefined>
): string[] {
  const suggestions = new Map<string, string>();
  for (const collection of collections) {
    for (const value of collection ?? []) {
      const permission = (typeof value === 'string' ? value : value.permission).trim();
      if (!permission) continue;
      const normalized = permission.toLocaleLowerCase();
      if (!suggestions.has(normalized)) suggestions.set(normalized, permission);
    }
  }
  return [...suggestions.values()].sort((a, b) => a.localeCompare(b));
}

export function permissionEntryOverview(
  entries: readonly PermissionEntry[] | undefined,
  effectivePermissions: readonly string[] | undefined,
): PermissionEntryOverview {
  return {
    direct: entries?.length ?? 0,
    effective: effectivePermissions?.length ?? 0,
  };
}
