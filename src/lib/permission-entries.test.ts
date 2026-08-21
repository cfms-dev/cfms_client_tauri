import { describe, expect, it } from 'vitest';
import {
  createImmediatePermissionEntry,
  parseLocalDateTimeInput,
  permissionEntryState,
  toLocalDateTimeInput,
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
});
