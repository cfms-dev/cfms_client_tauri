import { describe, expect, it } from 'vitest';
import { formatLocalDateTimeWithUtcOffset, formatUtcOffset } from './date-time';

describe('local date-time formatting with UTC offset', () => {
  it('uses local wall time and an explicit offset for the represented instant', () => {
    const date = new Date(2026, 6, 14, 13, 45, 6, 789);

    expect(formatLocalDateTimeWithUtcOffset(date)).toBe(
      `2026-07-14 13:45:06 UTC${formatUtcOffset(-date.getTimezoneOffset())}`,
    );
  });

  it('uses ISO-style signed offsets with two-digit hours and minutes', () => {
    expect(formatUtcOffset(480)).toBe('+08:00');
    expect(formatUtcOffset(-210)).toBe('-03:30');
    expect(formatUtcOffset(0)).toBe('+00:00');
  });

  it('returns an empty value for an invalid timestamp', () => {
    expect(formatLocalDateTimeWithUtcOffset(Number.NaN)).toBe('');
  });
});
