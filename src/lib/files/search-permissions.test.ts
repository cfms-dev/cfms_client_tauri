import { describe, expect, it } from 'vitest';
import { canSearchFiles } from './search-permissions';

describe('file search permissions', () => {
  it('accepts search granted directly in the effective permission snapshot', () => {
    expect(canSearchFiles(['list_directory', 'search'])).toBe(true);
  });

  it('accepts inherited search because inherited permissions are included in the snapshot', () => {
    const effectiveGroupPermissions = ['get_directory', 'search'];
    expect(canSearchFiles(effectiveGroupPermissions)).toBe(true);
  });

  it('rejects a snapshot without search permission', () => {
    expect(canSearchFiles(['list_directory'])).toBe(false);
  });
});
