import { describe, expect, it } from 'vitest';
import { filterAccountPermissions, formatAccountTimestamp } from '$lib/features/authentication/account-profile';

describe('account profile presentation', () => {
  it.each([undefined, null, 0, -1, NaN, Infinity, Number.MAX_VALUE])('does not invent a date for %s', (value) => {
    expect(formatAccountTimestamp(value, 'en', 'Not provided')).toBe('Not provided');
  });

  it.each(['en', 'zh-CN'])('uses the chosen language and local time zone for %s', (locale) => {
    const value = 1_790_000_000;
    const expected = new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    }).format(new Date(value * 1000));
    expect(formatAccountTimestamp(value, locale, 'Unavailable')).toBe(expected);
  });

  it('searches identifiers without changing the server permission set', () => {
    const permissions = ['set_user_avatar', 'read_document', 'list_users', 'read_document'];
    expect(filterAccountPermissions(permissions, ' READ_ ')).toEqual(['read_document']);
    expect(filterAccountPermissions(permissions, '')).toEqual(['list_users', 'read_document', 'set_user_avatar']);
    expect(permissions).toHaveLength(4);
    expect(filterAccountPermissions(permissions, 'missing')).toEqual([]);
  });
});
