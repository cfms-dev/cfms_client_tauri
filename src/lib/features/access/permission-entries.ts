import type { PermissionEntry } from '$lib/api';

/** Protocol 31 global permissions (matching `include/domains/access/permissions.py`). */
export const KNOWN_GLOBAL_PERMISSIONS: readonly string[] = [
  'purge',
  'delete_revision',
  'search',
  'bypass_dacl',
  'bypass_traverse_checking',
  'shutdown',
  'debugging',
  'view_settings',
  'manage_settings',
  'diagnostics',
  'view_schedules',
  'manage_schedules',
  'create_user',
  'delete_user',
  'set_nickname',
  'set_username',
  'manage_user_status',
  'get_user_info',
  'list_users',
  'configure_auth_methods',
  'super_configure_auth_methods',
  'super_list_user_auth_methods',
  'set_user_permissions',
  'set_user_avatar',
  'super_set_user_avatar',
  'super_set_nickname',
  'super_set_username',
  'create_group',
  'delete_group',
  'rename_group',
  'get_group_info',
  'list_groups',
  'change_user_groups',
  'set_group_permissions',
  'apply_lockdown',
  'bypass_lockdown',
  'bypass_document_creation_rate_limit',
  'bypass_document_download_rate_limit',
  'bypass_request_rate_limit',
  'list_banned_subnets',
  'manage_banned_subnets',
  'list_auth_lockouts',
  'unlock_auth_lockouts',
  'view_audit_logs',
  'manage_keyrings',
];

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
