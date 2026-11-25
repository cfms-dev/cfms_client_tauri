import { describe, expect, it } from 'vitest';
import { parseCaclToModel } from './cacl-model';
import { CACL_FORMAT_MAX_LINE_LENGTH, formatCaclSource } from './cacl-formatter';

const ALICE_UUID = 'aabbccdd-0000-4000-8000-000000000001';
const BOB_UUID = 'aabbccdd-0000-4000-8000-000000000002';

describe('cacl-formatter', () => {
  it('keeps short statements on a single line within 88 characters', () => {
    const input = '  inherit   on ;\nallow [ PRESET_READ ] to any ;\n';
    const result = formatCaclSource(input);
    expect(result).toEqual({
      ok: true,
      text: 'inherit on;\nallow [PRESET_READ] to any;\n',
    });
  });

  it('wraps rules exceeding 88 chars at keywords with 2-space indent and preserves comments and blank lines', () => {
    const input = [
      'inherit   off;',
      '',
      '# All employees may drop new documents here, but cannot list others\' files',
      '# or read any child documents',
      'allow [TRAVERSE, CREATE_DOCUMENT] on self to group("all_employees") remark "Blind dropbox submission entry point";',
      '',
      '# Only the review board may list the directory and read submitted documents',
      'allow [LIST_DIRECTORY] on self',
      '  to group("review_board");',
      '',
      'allow [READ_CONTENT, READ_METADATA] on docs to group("review_board") remark "Read-only inspection by the review board";',
    ].join('\n');

    const result = formatCaclSource(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.text).toBe([
      'inherit off;',
      '',
      '# All employees may drop new documents here, but cannot list others\' files',
      '# or read any child documents',
      'allow [TRAVERSE, CREATE_DOCUMENT] on self',
      '  to group("all_employees")',
      '  remark "Blind dropbox submission entry point";',
      '',
      '# Only the review board may list the directory and read submitted documents',
      'allow [LIST_DIRECTORY] on self to group("review_board");',
      '',
      'allow [READ_CONTENT, READ_METADATA] on docs',
      '  to group("review_board")',
      '  remark "Read-only inspection by the review board";',
      '',
    ].join('\n'));

    for (const line of result.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(CACL_FORMAT_MAX_LINE_LENGTH);
    }
    expect(formatCaclSource(result.text)).toEqual(result);
  });

  it('wraps long operation lists without trailing commas so every line stays <= 88 chars', () => {
    const input = [
      'inherit off;',
      'allow [TRAVERSE, LIST_DIRECTORY, READ_CONTENT, READ_METADATA] to any remark "Default read access for authenticated users";',
      'allow [TRAVERSE, LIST_DIRECTORY, CREATE_DOCUMENT, CREATE_DIRECTORY, READ_CONTENT, WRITE_CONTENT, LIST_REVISIONS, READ_REVISION, SET_CURRENT_REVISION, DELETE_REVISION, READ_METADATA, WRITE_METADATA, RENAME, REPARENT, DELETE, DIRECTORY_DELETE_CHILD, LIST_DELETED, RESTORE, PURGE, READ_DACL, WRITE_DACL] to group("sysop") remark "Default administrator full access";',
    ].join('\n');

    const result = formatCaclSource(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const line of result.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(CACL_FORMAT_MAX_LINE_LENGTH);
    }
    expect(result.text).not.toContain(',\n]');
    expect(result.text).toContain('\n  to group("sysop")\n');
    expect(result.text).toContain('\n  remark "Default administrator full access";\n');
    expect(parseCaclToModel(result.text).ok).toBe(true);
    expect(formatCaclSource(result.text)).toEqual(result);
  });

  it('wraps long `to` principal lists and `when` boolean expressions at keywords', () => {
    const input = [
      `allow [READ_CONTENT] to user("${ALICE_UUID}"), user("${BOB_UUID}"), group("engineering_leads") remark "Multi principal";`,
      `deny [DELETE] when user("${ALICE_UUID}") and not perm("bypass_dacl") or group("contractors") and perm("restricted_access");`,
    ].join('\n');

    const result = formatCaclSource(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const line of result.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(CACL_FORMAT_MAX_LINE_LENGTH);
    }
    expect(result.text).toContain('\n  to user(');
    expect(result.text).toContain('\n  when user(');
    expect(result.text).toContain('\n    or group("contractors")');
    expect(parseCaclToModel(result.text).ok).toBe(true);
    expect(formatCaclSource(result.text)).toEqual(result);
  });

  it('preserves 0, 1, and 2 blank lines and collapses 3+ blank lines to 2 per PEP 8', () => {
    const input = [
      '',
      '',
      'inherit on;',
      'allow [TRAVERSE] to any;',
      '',
      'allow [READ_CONTENT] to any;',
      '',
      '',
      'allow [READ_METADATA] to any;',
      '',
      '',
      '',
      '',
      'allow [LIST_DIRECTORY] to any;',
      '',
      '',
      '',
    ].join('\n');

    const result = formatCaclSource(input);
    expect(result).toEqual({
      ok: true,
      text: [
        'inherit on;',
        'allow [TRAVERSE] to any;',
        '',
        'allow [READ_CONTENT] to any;',
        '',
        '',
        'allow [READ_METADATA] to any;',
        '',
        '',
        'allow [LIST_DIRECTORY] to any;',
        '',
      ].join('\n'),
    });
  });

  it('preserves trailing inline comments, comments inside op lists, and comment-only policies', () => {
    const withInline = [
      'inherit on; # keep inheritance',
      `allow [`,
      '  TRAVERSE, # traverse dir',
      '  # allow listing too',
      '  LIST_DIRECTORY',
      `] to user("${ALICE_UUID}"); # @alice`,
    ].join('\n');

    const res = formatCaclSource(withInline);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain('inherit on; # keep inheritance');
    expect(res.text).toContain('  TRAVERSE, # traverse dir');
    expect(res.text).toContain('  # allow listing too');
    expect(res.text).toContain('  LIST_DIRECTORY\n');
    expect(res.text).toContain(`  to user("${ALICE_UUID}"); # @alice`);
    expect(parseCaclToModel(res.text).ok).toBe(true);
    expect(formatCaclSource(res.text)).toEqual(res);

    expect(formatCaclSource('  # header only\n\n\n\n# footer\n')).toEqual({
      ok: true,
      text: '# header only\n\n\n# footer\n',
    });
    expect(formatCaclSource('   \n\t\n')).toEqual({ ok: true, text: '' });
  });

  it('rejects invalid CACL syntax without mutating source', () => {
    const res = formatCaclSource('allow [PRESET_READ to any');
    expect(res.ok).toBe(false);
  });
});
