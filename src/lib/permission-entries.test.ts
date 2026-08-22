import { describe, expect, it } from 'vitest';
import {
  countPermissionEntryChanges,
  createImmediatePermissionEntry,
  parseLocalDateTimeInput,
  permissionEntryChangeKind,
  permissionEntryMatchesFilter,
  permissionEntrySuggestions,
  permissionEntryState,
  toLocalDateTimeInput,
  validatePermissionEntry,
} from './permission-entries';

describe('permission entries', () => {
  it('uses inclusive protocol v24 time-window boundaries', () => {
    const entry = {
      permission: 'list_users',
      granted: true,
      start_time: 100,
      end_time: 200,
    };

    expect(permissionEntryState(entry, 99)).toBe('scheduled');
    expect(permissionEntryState(entry, 100)).toBe('active');
    expect(permissionEntryState(entry, 200)).toBe('active');
    expect(permissionEntryState(entry, 201)).toBe('expired');
  });

  it('creates an immediately active grant without expiry', () => {
    expect(createImmediatePermissionEntry('search', 123.9)).toEqual({
      permission: 'search',
      granted: true,
      start_time: 123,
      end_time: null,
    });
  });

  it('round-trips local date-time inputs at second precision', () => {
    const timestamp = 1_787_200_000;
    expect(parseLocalDateTimeInput(toLocalDateTimeInput(timestamp))).toBe(timestamp);
    expect(parseLocalDateTimeInput('')).toBeNull();
  });

  it('validates required names and inclusive validity windows', () => {
    expect(validatePermissionEntry({
      permission: ' ',
      granted: true,
      start_time: Number.NaN,
      end_time: Number.NaN,
    })).toEqual({
      valid: false,
      permission: 'required',
      startTime: 'invalid',
      endTime: 'invalid',
    });

    expect(validatePermissionEntry({
      permission: 'search',
      granted: true,
      start_time: 200,
      end_time: 200,
    }).valid).toBe(true);
    expect(validatePermissionEntry({
      permission: 'search',
      granted: true,
      start_time: 200,
      end_time: 199,
    }).endTime).toBe('before-start');
  });

  it('tracks staged changes without conflating duplicate names', () => {
    const first = { permission: 'search', granted: true, start_time: 100, end_time: null };
    const duplicate = { ...first, granted: false };
    const changes = [
      permissionEntryChangeKind(first, first),
      permissionEntryChangeKind(duplicate, first),
      permissionEntryChangeKind(first, null),
      permissionEntryChangeKind(first, first, true),
    ];

    expect(changes).toEqual(['unchanged', 'modified', 'added', 'deleted']);
    expect(countPermissionEntryChanges(changes)).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
      total: 3,
    });
    expect(permissionEntryMatchesFilter('active', 'modified', 'changed')).toBe(true);
    expect(permissionEntryMatchesFilter('expired', 'deleted', 'expired')).toBe(false);
  });

  it('builds case-insensitive suggestions from local and server snapshots', () => {
    expect(permissionEntrySuggestions(
      [{ permission: 'Search', granted: true, start_time: 1, end_time: null }],
      ['search', 'list_users'],
      ['view_audit_logs'],
    )).toEqual(['list_users', 'Search', 'view_audit_logs']);
  });
});
