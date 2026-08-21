import type { PermissionEntry } from '$lib/api';

export type PermissionEntryState = 'active' | 'scheduled' | 'expired';

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
